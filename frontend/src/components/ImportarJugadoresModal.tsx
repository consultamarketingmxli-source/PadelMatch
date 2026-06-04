/**
 * Modal de Importación Masiva de Jugadores — Paste CSV.
 *
 * UX: el organizador pega el contenido del CSV (o tabla de Sheets/Excel)
 * directamente en un TextInput multilinea. Esto funciona idéntico en web,
 * iOS y Android sin depender de un DocumentPicker (que tiene diferencias
 * de comportamiento entre plataformas).
 *
 * Formato soportado:
 *   • Una línea por jugador.
 *   • Columnas separadas por: coma, tabulación o punto y coma.
 *   • Primera columna = nombre (obligatorio).
 *   • Segunda columna = teléfono (opcional).
 *   • Headers como "Nombre,Telefono" se ignoran si la primera fila es solo
 *     palabras genéricas.
 *
 * Vista de progreso:
 *   1. Empty: textarea + ejemplo.
 *   2. Parsed: tabla de N filas parseadas + botón "Importar X jugadores".
 *   3. Loading: spinner.
 *   4. Result: creadas + omitidos por razón (duplicado/cupo_lleno/vacio).
 */
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Upload,
  X,
} from "lucide-react-native";

import { api } from "@/src/api";
import { colors, radii, spacing, typography } from "@/src/theme";

type ParsedRow = { nombre: string; telefono?: string };
type ImportResult = {
  creadas: number;
  omitidos: { nombre: string; razon: "duplicado" | "cupo_lleno" | "vacio" }[];
  total_aprobados: number;
  max_jugadores: number;
};

const RAZON_LABEL: Record<string, string> = {
  duplicado: "Ya inscrito",
  cupo_lleno: "Cupo lleno",
  vacio: "Nombre inválido",
};

/** Detecta si la primera fila es un header (solo palabras genéricas). */
function looksLikeHeader(cells: string[]): boolean {
  if (cells.length === 0) return false;
  const generic = ["nombre", "name", "jugador", "player"];
  const first = cells[0].trim().toLowerCase();
  return generic.includes(first);
}

/** Parser CSV simple — soporta comas, tabs y punto y coma como delimitadores. */
function parseCSV(text: string): ParsedRow[] {
  if (!text.trim()) return [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const detectDelim = (line: string): string => {
    if (line.includes("\t")) return "\t";
    if (line.includes(";")) return ";";
    return ",";
  };

  const out: ParsedRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const delim = detectDelim(lines[i]);
    const cells = lines[i].split(delim).map((c) => c.trim());
    if (i === 0 && looksLikeHeader(cells)) continue;
    const nombre = cells[0] || "";
    const telefono = cells[1] || undefined;
    if (nombre) out.push({ nombre, telefono });
  }
  return out;
}

type Props = {
  retaId: string;
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void; // se llama tras una importación con creadas > 0
};

export function ImportarJugadoresModal({ retaId, visible, onClose, onSuccess }: Props) {
  const [csvText, setCsvText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseCSV(csvText), [csvText]);

  const reset = () => {
    setCsvText("");
    setResult(null);
    setError(null);
    setLoading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleImport = async () => {
    if (parsed.length === 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.importInscripciones(retaId, parsed);
      setResult(r);
      if (r.creadas > 0) {
        onSuccess?.();
      }
    } catch (e: any) {
      const msg = String(e.message ?? "");
      if (msg.includes("409") || msg.toLowerCase().includes("resultados capturados")) {
        setError(
          "Bloqueado: ya hay resultados capturados en esta reta. Elimínalos primero para importar.",
        );
      } else if (msg.toLowerCase().includes("máximo 1000")) {
        setError("Demasiados jugadores: máximo 1000 por importación.");
      } else {
        setError(msg || "No se pudo importar");
      }
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <View style={[styles.backdrop, { pointerEvents: "auto" }]}>
      <View style={styles.card}>
        {/* Header */}
        <View style={styles.header}>
          <FileText size={18} color={colors.brand.primary} />
          <Text style={styles.title}>Importar jugadores</Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn} testID="import-close">
            <X size={16} color={colors.text.primary} />
          </TouchableOpacity>
        </View>

        {/* Result view */}
        {result ? (
          <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
            <View style={styles.resultHeader}>
              <CheckCircle2 size={20} color={colors.status.green} />
              <Text style={styles.resultTitle}>{result.creadas} jugadores importados</Text>
            </View>
            <Text style={styles.resultMeta}>
              Total aprobados: {result.total_aprobados} / {result.max_jugadores}
            </Text>

            {result.omitidos.length > 0 ? (
              <>
                <View style={styles.omittedHeader}>
                  <AlertTriangle size={14} color={colors.status.amber} />
                  <Text style={styles.omittedTitle}>
                    {result.omitidos.length} omitidos
                  </Text>
                </View>
                {result.omitidos.map((o, idx) => (
                  <View key={`om-${idx}`} style={styles.omittedRow}>
                    <Text style={styles.omittedName} numberOfLines={1}>
                      {o.nombre || "(sin nombre)"}
                    </Text>
                    <View style={styles.omittedReasonBadge}>
                      <Text style={styles.omittedReasonTxt}>
                        {RAZON_LABEL[o.razon] || o.razon}
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            ) : null}

            <View style={{ height: spacing.lg }} />
            <TouchableOpacity onPress={handleClose} style={styles.primaryBtn} testID="import-done">
              <Text style={styles.primaryBtnTxt}>Listo</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
            <Text style={styles.helpText}>
              Pega tu CSV (o copia desde Excel/Sheets). Una línea por jugador,
              primera columna nombre, segunda opcional teléfono.
            </Text>

            <View style={styles.exampleBox}>
              <Text style={styles.exampleLabel}>Ejemplo:</Text>
              <Text style={styles.exampleCode}>
                Juan Pérez,+5215512345678{"\n"}
                Maria Gómez{"\n"}
                Carlos Díaz,+521555555555
              </Text>
            </View>

            <TextInput
              value={csvText}
              onChangeText={(v) => {
                setCsvText(v);
                setError(null);
              }}
              placeholder="Pega aquí tu CSV..."
              placeholderTextColor={colors.text.muted}
              multiline
              numberOfLines={6}
              style={styles.textarea}
              testID="import-textarea"
              autoCapitalize="none"
              autoCorrect={false}
            />

            {parsed.length > 0 ? (
              <View style={styles.parsedSummary}>
                <CheckCircle2 size={14} color={colors.status.green} />
                <Text style={styles.parsedTxt}>
                  {parsed.length} jugador{parsed.length === 1 ? "" : "es"} detectado
                  {parsed.length === 1 ? "" : "s"}
                </Text>
              </View>
            ) : null}

            {parsed.length > 0 && parsed.length <= 12 ? (
              <View style={styles.previewList}>
                {parsed.map((p, idx) => (
                  <View key={`p-${idx}`} style={styles.previewRow}>
                    <Text style={styles.previewIdx}>{idx + 1}.</Text>
                    <Text style={styles.previewName} numberOfLines={1}>
                      {p.nombre}
                    </Text>
                    {p.telefono ? (
                      <Text style={styles.previewTel} numberOfLines={1}>
                        {p.telefono}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorBox}>
                <AlertTriangle size={14} color={colors.status.amberText} />
                <Text style={styles.errorTxt}>{error}</Text>
              </View>
            ) : null}

            <View style={{ height: spacing.md }} />
            <TouchableOpacity
              onPress={handleImport}
              disabled={parsed.length === 0 || loading}
              style={[
                styles.primaryBtn,
                (parsed.length === 0 || loading) && { opacity: 0.4 },
              ]}
              testID="import-submit"
            >
              {loading ? (
                <ActivityIndicator color={colors.text.inverse} size="small" />
              ) : (
                <>
                  <Upload size={14} color={colors.text.inverse} />
                  <Text style={styles.primaryBtnTxt}>
                    {parsed.length > 0
                      ? `Importar ${parsed.length} jugador${parsed.length === 1 ? "" : "es"}`
                      : "Importar"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    zIndex: 2000,
  },
  card: {
    width: "100%",
    maxWidth: 500,
    backgroundColor: colors.bg.card,
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...Platform.select({
      web: { boxShadow: "0 20px 50px rgba(0,0,0,0.25)" as any },
      ios: {
        boxShadow: "0px 12px 24px rgba(0,0,0,0.25)",
      },
      android: { elevation: 12 },
    }),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  title: { ...typography.h3, flex: 1 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg.elevated,
  },
  helpText: {
    ...typography.caption,
    color: colors.text.secondary,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  exampleBox: {
    backgroundColor: colors.bg.elevated,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  exampleLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.text.secondary,
    marginBottom: 4,
  },
  exampleCode: {
    ...typography.mono,
    fontSize: 11,
    color: colors.text.primary,
    lineHeight: 16,
  },
  textarea: {
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.md,
    padding: spacing.sm,
    minHeight: 130,
    color: colors.text.primary,
    backgroundColor: colors.bg.app,
    ...typography.mono,
    fontSize: 12,
    textAlignVertical: "top",
  },
  parsedSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
  },
  parsedTxt: {
    ...typography.caption,
    color: colors.status.green,
    fontWeight: "700",
  },
  previewList: {
    marginTop: spacing.sm,
    backgroundColor: colors.bg.elevated,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: 4,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  previewIdx: {
    ...typography.caption,
    color: colors.text.muted,
    width: 22,
  },
  previewName: {
    ...typography.caption,
    color: colors.text.primary,
    fontWeight: "600",
    flex: 1,
  },
  previewTel: {
    ...typography.mono,
    fontSize: 11,
    color: colors.text.muted,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: colors.status.amberBg,
    borderColor: colors.status.amberBorder,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  errorTxt: {
    ...typography.caption,
    color: colors.status.amberText,
    flex: 1,
    lineHeight: 16,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.md,
    backgroundColor: colors.brand.primary,
  },
  primaryBtnTxt: {
    ...typography.button,
    color: colors.text.inverse,
    fontSize: 14,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: 4,
  },
  resultTitle: {
    ...typography.h3,
    fontSize: 16,
    color: colors.text.primary,
  },
  resultMeta: {
    ...typography.caption,
    color: colors.text.secondary,
    marginBottom: spacing.md,
  },
  omittedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  omittedTitle: {
    ...typography.label,
    color: colors.status.amber,
    fontSize: 11,
  },
  omittedRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  omittedName: {
    ...typography.caption,
    flex: 1,
    color: colors.text.primary,
  },
  omittedReasonBadge: {
    backgroundColor: colors.bg.elevated,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  omittedReasonTxt: {
    ...typography.label,
    fontSize: 9,
    color: colors.text.secondary,
  },
});
