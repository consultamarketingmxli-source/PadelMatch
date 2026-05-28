/**
 * Formulario crear / editar reta — Fase B "Club Pro Clean".
 *
 * Cambios respecto a versión legacy:
 *   • Capacidad elástica: 4, 8, 12, 16, 20, 24, 28, 32 (chips)
 *     con auto-sugerencia si el organizador escribe un impar.
 *   • Formato de juego elástico (FormatoScore):
 *       PUNTOS+juegos (clásico) / PUNTOS+sets / TIEMPO+minutos.
 *   • Acceso al panel "Compartir" (QR, WhatsApp, copiar link).
 *   • Hint UX permanente: "El pádel se juega en parejas (múltiplos de 4)".
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  BarChart2,
  Clock,
  Download,
  FileText,
  Image as ImageIcon,
  Share2,
  Shuffle,
  Trophy,
  Users,
} from "lucide-react-native";

import { FormatoScore, api } from "@/src/api";
import { Button } from "@/src/components/Button";
import { Input } from "@/src/components/Input";
import { colors, radii, spacing, typography } from "@/src/theme";

type Modo = "PUNTOS" | "TIEMPO";
type Rondas = 5 | 6 | 7;
type Unidad = FormatoScore["unidad"];

// Múltiplos de 4 permitidos (4..32). Visible como chips.
const CAPACIDADES = [4, 8, 12, 16, 20, 24, 28, 32];

// Valores rápidos por unidad para el FormatoScore.
const VALORES_POR_UNIDAD: Record<Unidad, number[]> = {
  juegos: [6, 9, 11, 15],
  sets: [1, 3, 5],
  minutos: [15, 20, 30, 45, 60],
};

function snapMultiplo4(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 4;
  if (n < 4) return 4;
  if (n > 32) return 32;
  return Math.round(n / 4) * 4 || 4;
}

export default function RetaForm() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";

  const [loading, setLoading] = useState(!isNew);
  const [submitting, setSubmitting] = useState(false);

  // Identidad
  const [nombre, setNombre] = useState("");
  const [club, setClub] = useState("");
  const [fechaStr, setFechaStr] = useState("");
  const [horaStr, setHoraStr] = useState("");

  // Capacidad elástica
  const [maxJugadores, setMaxJugadores] = useState<number>(8);
  const [costo, setCosto] = useState("250");
  const [modo, setModo] = useState<Modo>("PUNTOS");
  const [rondas, setRondas] = useState<Rondas>(7);

  // FormatoScore
  const [fsTipo, setFsTipo] = useState<"PUNTOS" | "TIEMPO">("PUNTOS");
  const [fsUnidad, setFsUnidad] = useState<Unidad>("juegos");
  const [fsValor, setFsValor] = useState<number>(9);

  // Branding
  const [logoUrl, setLogoUrl] = useState("");
  const [obs, setObs] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [retaIdReal, setRetaIdReal] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      const yyyy = t.getFullYear();
      const mm = String(t.getMonth() + 1).padStart(2, "0");
      const dd = String(t.getDate()).padStart(2, "0");
      setFechaStr(`${yyyy}-${mm}-${dd}`);
      setHoraStr("19:00");
      return;
    }
    (async () => {
      try {
        const r = await api.getRetaAdmin(id as string);
        setRetaIdReal(r.id);
        setNombre(r.nombre);
        setClub(r.club);
        const d = new Date(r.fecha_evento);
        setFechaStr(
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        );
        setHoraStr(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
        setMaxJugadores(r.max_jugadores);
        setCosto(String(r.costo_inscripcion));
        setModo(r.modalidad_juego);
        setRondas(r.num_rondas);
        if (r.formato_score) {
          setFsTipo(r.formato_score.tipo);
          setFsUnidad(r.formato_score.unidad);
          setFsValor(r.formato_score.valor);
        }
        setLogoUrl(r.organizador_logo_url ?? "");
        setObs(r.observaciones_publicas);
        setLat(r.latitud != null ? String(r.latitud) : "");
        setLng(r.longitud != null ? String(r.longitud) : "");
      } catch (e: any) {
        Alert.alert("Error", e.message ?? "No se pudo cargar");
        router.back();
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isNew, router]);

  // Cuando cambia tipo (PUNTOS/TIEMPO), ajusta unidad coherente.
  useEffect(() => {
    if (fsTipo === "TIEMPO") {
      setFsUnidad("minutos");
      if (![15, 20, 30, 45, 60].includes(fsValor)) setFsValor(20);
    } else if (fsTipo === "PUNTOS") {
      if (fsUnidad === "minutos") {
        setFsUnidad("juegos");
        setFsValor(9);
      }
    }
    // Mantener `modo` sincronizado con tipo (compat con scoreboard).
    setModo(fsTipo);
  }, [fsTipo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Canchas estimadas según capacidad (visual feedback al organizador)
  const canchasEstimadas = useMemo(() => Math.ceil(maxJugadores / 8), [maxJugadores]);

  const save = async () => {
    if (!nombre.trim() || !club.trim() || !fechaStr || !horaStr) {
      Alert.alert("Faltan datos", "Nombre, club, fecha y hora son obligatorios");
      return;
    }
    if (maxJugadores % 4 !== 0) {
      const sugerido = snapMultiplo4(maxJugadores);
      Alert.alert(
        "Capacidad inválida",
        `El pádel se juega en parejas (múltiplos de 4). ¿Cambiamos a ${sugerido} jugadores?`,
        [
          { text: "Cancelar", style: "cancel" },
          { text: `Usar ${sugerido}`, onPress: () => setMaxJugadores(sugerido) },
        ],
      );
      return;
    }
    setSubmitting(true);
    const tzOffsetMin = -new Date().getTimezoneOffset();
    const body = {
      nombre: nombre.trim(),
      club: club.trim(),
      fecha_str: fechaStr,
      hora_str: horaStr,
      tz_offset_minutes: tzOffsetMin,
      canchas_disponibles: canchasEstimadas,
      max_jugadores: maxJugadores,
      costo_inscripcion: parseFloat(costo) || 0,
      modalidad_juego: fsTipo, // espejo del FormatoScore.tipo
      num_rondas: rondas,
      formato_score: { tipo: fsTipo, valor: fsValor, unidad: fsUnidad },
      organizador_logo_url: logoUrl || null,
      observaciones_publicas: obs.slice(0, 140),
      latitud: lat ? parseFloat(lat) : null,
      longitud: lng ? parseFloat(lng) : null,
    };
    try {
      if (isNew) {
        const r = await api.createReta(body);
        Alert.alert(
          "✓ Reta creada",
          `Slug: ${r.url_slug}\n¿Quieres compartirla ya?`,
          [
            {
              text: "Después",
              style: "cancel",
              onPress: () => router.replace(`/admin/reta/${r.id}` as any),
            },
            {
              text: "Compartir",
              onPress: () => router.replace(`/admin/reta/compartir/${r.id}` as any),
            },
          ],
        );
      } else {
        await api.updateReta(id as string, body);
        Alert.alert("✓ Reta actualizada");
      }
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo guardar");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteReta = async () => {
    Alert.alert("Eliminar reta", "Esto eliminará la reta y todas sus inscripciones. ¿Continuar?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          await api.deleteReta(id as string);
          router.replace("/admin");
        },
      },
    ]);
  };

  const downloadPdf = async () => {
    if (isNew || !retaIdReal) {
      Alert.alert("Guarda primero", "Crea la reta antes de generar el PDF");
      return;
    }
    try {
      const url = await api.generatePdfUrl(retaIdReal, [], rondas);
      if (Platform.OS === "web") {
        const a = document.createElement("a");
        a.href = url;
        a.download = `rol-${nombre.replace(/\s+/g, "-")}.pdf`;
        a.target = "_blank";
        a.click();
      } else {
        Alert.alert("PDF generado", "Abre el PDF desde el navegador para descargarlo.");
      }
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo generar el PDF");
    }
  };

  /**
   * Descarga genérica de blobs (CSV / PDF clasificación / CSV rol).
   * En web abre directo la descarga; en mobile muestra alerta + abre URL.
   */
  const triggerBlobDownload = async (
    fetcher: () => Promise<string>,
    filename: string,
    successMsg = "Archivo generado",
  ) => {
    if (isNew || !retaIdReal) {
      Alert.alert("Guarda primero", "Crea la reta antes de exportar");
      return;
    }
    try {
      const url = await fetcher();
      if (Platform.OS === "web") {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.target = "_blank";
        a.click();
      } else {
        Alert.alert(successMsg, "Abre el archivo desde el navegador para descargarlo.");
      }
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo descargar");
    }
  };

  const slug = nombre.replace(/\s+/g, "-").toLowerCase() || "reta";

  const downloadRolCsv = () =>
    triggerBlobDownload(
      () => api.exportRolCsvUrl(retaIdReal!),
      `rol-${slug}.csv`,
      "CSV del rol generado",
    );

  const downloadClasificacionCsv = () =>
    triggerBlobDownload(
      () => api.exportClasificacionCsvUrl(retaIdReal!),
      `clasificacion-${slug}.csv`,
      "CSV de clasificación generado",
    );

  const downloadClasificacionPdf = () =>
    triggerBlobDownload(
      () => api.exportClasificacionPdfUrl(retaIdReal!),
      `clasificacion-${slug}.pdf`,
      "PDF de clasificación generado",
    );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={{ color: colors.text.secondary }}>Cargando…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const valoresActuales = VALORES_POR_UNIDAD[fsUnidad];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
              <ArrowLeft size={18} color={colors.text.primary} />
            </TouchableOpacity>
            <Text style={styles.title}>{isNew ? "Nueva Reta" : "Editar Reta"}</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* IDENTIDAD */}
          <Input label="Nombre de la reta" value={nombre} onChangeText={setNombre} testID="form-nombre" placeholder="Ej. Torneo Verano" />
          <Input label="Club" value={club} onChangeText={setClub} testID="form-club" placeholder="Ej. Padel Club CDMX" />

          <View style={styles.row}>
            <Input label="Fecha (YYYY-MM-DD)" value={fechaStr} onChangeText={setFechaStr} testID="form-fecha" placeholder="2026-06-15" />
            <Input label="Hora (HH:mm)" value={horaStr} onChangeText={setHoraStr} testID="form-hora" placeholder="19:00" />
          </View>

          {/* CAPACIDAD ELÁSTICA */}
          <Text style={styles.sectionLabel}>CAPACIDAD DE JUGADORES</Text>
          <Text style={styles.hintText}>
            <Users size={11} color={colors.text.secondary} />
            {"  "}El pádel se juega en parejas: usa múltiplos de 4 (4, 8, 12… hasta 32).
          </Text>
          <View style={styles.chipsRow}>
            {CAPACIDADES.map((n) => {
              const active = maxJugadores === n;
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => setMaxJugadores(n)}
                  style={[styles.chip, active && styles.chipActive]}
                  activeOpacity={0.7}
                  testID={`form-cap-${n}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.estimText} testID="form-canchas-estim">
            Canchas estimadas: <Text style={{ fontWeight: "800", color: colors.text.primary }}>{canchasEstimadas}</Text>
            {"  ·  "}Cada cancha = 8 jugadores · remanente de 4 = 1 cancha mini.
          </Text>

          <Input label="Costo de inscripción $" value={costo} onChangeText={setCosto} keyboardType="decimal-pad" testID="form-costo" />

          {/* FORMATO DE JUEGO (elástico) */}
          <Text style={styles.sectionLabel}>FORMATO DE JUEGO</Text>
          <View style={styles.segGroup}>
            {(["PUNTOS", "TIEMPO"] as const).map((t) => {
              const active = fsTipo === t;
              return (
                <TouchableOpacity
                  key={t}
                  testID={`form-fs-tipo-${t.toLowerCase()}`}
                  onPress={() => setFsTipo(t)}
                  activeOpacity={0.7}
                  style={[styles.seg, active && styles.segActive]}
                >
                  {t === "PUNTOS" ? (
                    <Trophy size={14} color={active ? colors.text.inverse : colors.text.primary} />
                  ) : (
                    <Clock size={14} color={active ? colors.text.inverse : colors.text.primary} />
                  )}
                  <Text style={[styles.segText, active && styles.segTextActive]}>
                    {t === "PUNTOS" ? "Por Puntos" : "Por Tiempo"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Unidad — sólo cuando PUNTOS */}
          {fsTipo === "PUNTOS" ? (
            <View style={styles.segGroup}>
              {(["juegos", "sets"] as Unidad[]).map((u) => {
                const active = fsUnidad === u;
                return (
                  <TouchableOpacity
                    key={u}
                    testID={`form-fs-unidad-${u}`}
                    onPress={() => {
                      setFsUnidad(u);
                      const def = VALORES_POR_UNIDAD[u][1] ?? VALORES_POR_UNIDAD[u][0];
                      setFsValor(def);
                    }}
                    style={[styles.seg, active && styles.segActive]}
                  >
                    <Text style={[styles.segText, active && styles.segTextActive]}>
                      {u === "juegos" ? "A juegos" : "A sets"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          <Text style={styles.subLabel}>
            {fsUnidad === "minutos"
              ? "Duración por partido (min)"
              : fsUnidad === "sets"
                ? "Al mejor de N sets"
                : "Primer equipo en llegar a N juegos gana"}
          </Text>
          <View style={styles.chipsRow}>
            {valoresActuales.map((v) => {
              const active = fsValor === v;
              return (
                <TouchableOpacity
                  key={v}
                  onPress={() => setFsValor(v)}
                  style={[styles.chipSmall, active && styles.chipActive]}
                  activeOpacity={0.7}
                  testID={`form-fs-valor-${v}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{v}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* EXTENSIÓN */}
          <Text style={styles.sectionLabel}>EXTENSIÓN DEL TORNEO</Text>
          <View style={styles.segGroup}>
            {([5, 6, 7] as Rondas[]).map((n) => {
              const active = rondas === n;
              const ideal = n === 7;
              return (
                <TouchableOpacity
                  key={n}
                  testID={`form-rondas-${n}`}
                  onPress={() => setRondas(n)}
                  activeOpacity={0.7}
                  style={[styles.seg, active && styles.segActive, ideal && !active && styles.segRecommended]}
                >
                  <Text style={[styles.segText, active && styles.segTextActive]}>
                    {n} Rondas{ideal ? "  ★ Ideal" : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* BRANDING */}
          <Text style={styles.sectionLabel}>IDENTIDAD VISUAL</Text>
          <Input
            label="Logo URL (opcional, base64 data:image o https) — se comprime a WebP"
            value={logoUrl}
            onChangeText={setLogoUrl}
            testID="form-logo"
            placeholder="https://…"
            autoCapitalize="none"
          />
          <Input
            label={`Observaciones públicas (${obs.length}/140)`}
            value={obs}
            onChangeText={(v) => setObs(v.slice(0, 140))}
            multiline
            testID="form-obs"
            placeholder="Trae tu mejor energía y…"
            style={{ minHeight: 80, textAlignVertical: "top" }}
          />

          <Text style={styles.sectionLabel}>GEOLOCALIZACIÓN (opcional)</Text>
          <View style={styles.row}>
            <Input label="Latitud" value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation" testID="form-lat" placeholder="19.4326" />
            <Input label="Longitud" value={lng} onChangeText={setLng} keyboardType="numbers-and-punctuation" testID="form-lng" placeholder="-99.1332" />
          </View>

          <Button
            title={isNew ? "Crear reta" : "Guardar cambios"}
            onPress={save}
            loading={submitting}
            testID="form-save-btn"
          />

          {!isNew ? (
            <>
              <View style={{ height: spacing.md }} />
              <Button
                title="Compartir reta (QR + WhatsApp)"
                onPress={() => router.push(`/admin/reta/compartir/${retaIdReal}` as any)}
                variant="secondary"
                icon={<Share2 size={14} color={colors.brand.primary} />}
                testID="form-share-btn"
              />
              <View style={{ height: spacing.md }} />
              <Button
                title="Distribuir jugadores por cancha"
                onPress={() => router.push(`/admin/reta/jugadores/${retaIdReal}` as any)}
                variant="secondary"
                icon={<Shuffle size={14} color={colors.brand.primary} />}
                testID="form-jugadores-btn"
              />
              <View style={{ height: spacing.md }} />
              <Button
                title="Capturar resultados de partidos"
                onPress={() => router.push(`/admin/reta/resultados/${retaIdReal}` as any)}
                variant="secondary"
                icon={<BarChart2 size={14} color={colors.brand.primary} />}
                testID="form-resultados-btn"
              />
              <View style={{ height: spacing.md }} />
              <Button
                title="Generar Rol & Descargar PDF A4"
                onPress={downloadPdf}
                variant="secondary"
                icon={<ImageIcon size={14} color={colors.brand.primary} />}
                testID="form-pdf-btn"
              />
              <View style={{ height: spacing.md }} />
              <Button
                title="Descargar Rol (CSV)"
                onPress={downloadRolCsv}
                variant="secondary"
                icon={<Download size={14} color={colors.brand.primary} />}
                testID="form-rol-csv-btn"
              />
              <View style={{ height: spacing.md }} />
              <Button
                title="Descargar Clasificación (CSV)"
                onPress={downloadClasificacionCsv}
                variant="secondary"
                icon={<Download size={14} color={colors.brand.primary} />}
                testID="form-clasif-csv-btn"
              />
              <View style={{ height: spacing.md }} />
              <Button
                title="Descargar Clasificación (PDF A4)"
                onPress={downloadClasificacionPdf}
                variant="secondary"
                icon={<FileText size={14} color={colors.brand.primary} />}
                testID="form-clasif-pdf-btn"
              />
              <View style={{ height: spacing.md }} />
              <Button title="Eliminar reta" onPress={deleteReta} variant="danger" testID="form-delete-btn" />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  iconBtn: {
    width: 40, height: 40, borderRadius: radii.md,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    alignItems: "center", justifyContent: "center",
  },
  title: { ...typography.h2, color: colors.text.primary },
  row: { flexDirection: "row", gap: spacing.sm },
  sectionLabel: { ...typography.label, color: colors.text.secondary, marginTop: spacing.md, marginBottom: spacing.sm, fontSize: 11 },
  subLabel: { color: colors.text.secondary, fontSize: 11, marginBottom: spacing.sm, marginTop: spacing.xs },
  hintText: { color: colors.text.secondary, fontSize: 11, lineHeight: 16, marginBottom: spacing.sm },
  estimText: { color: colors.text.secondary, fontSize: 11, marginBottom: spacing.md, marginTop: 6 },
  chipsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: spacing.sm },
  chip: {
    minWidth: 52, paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md, alignItems: "center",
  },
  chipSmall: {
    minWidth: 40, paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md, alignItems: "center",
  },
  chipActive: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  chipText: { color: colors.text.primary, fontWeight: "700", fontSize: 13 },
  chipTextActive: { color: colors.text.inverse },
  segGroup: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm, flexWrap: "wrap" },
  seg: {
    flex: 1, minWidth: 100,
    flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
    paddingVertical: 12, paddingHorizontal: 12,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md,
  },
  segActive: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  segRecommended: { borderColor: colors.brand.primaryBorder, borderStyle: "dashed" },
  segText: { color: colors.text.primary, fontWeight: "700", fontSize: 13 },
  segTextActive: { color: colors.text.inverse },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
