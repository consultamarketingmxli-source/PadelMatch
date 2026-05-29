/**
 * AdminInscripcionSheet — Slide-Over (modal bottom-sheet) para editar una
 * inscripción in-line desde el panel admin.
 *
 * Acciones soportadas:
 *   • Editar nombre (typo correction).
 *   • Editar teléfono (con verificación de no-duplicado en el backend).
 *   • Asignar cancha (1..N donde N=canchas_disponibles de la reta).
 *   • Confirmar manualmente (sin pago/RSVP — útil para efectivo).
 *
 * UX:
 *   • Tap en una row de jugador en /admin/reta/inscripciones/[id] abre el sheet.
 *   • Inputs prellenados con los valores actuales.
 *   • Botón "Guardar" hace PATCH inline. Botón "Confirmar Manual" hace POST.
 *   • Botón "Cerrar" sin guardar.
 */
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { X, Save, CheckCircle2, AlertTriangle, MapPin } from "lucide-react-native";
import { api, Inscripcion } from "@/src/api";
import { colors, radii, spacing, typography } from "@/src/theme";

type Props = {
  visible: boolean;
  inscripcion: Inscripcion | null;
  canchasDisponibles: number;
  onClose: () => void;
  onSaved: (updated: Inscripcion) => void;
};

export function AdminInscripcionSheet({
  visible, inscripcion, canchasDisponibles, onClose, onSaved,
}: Props) {
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [cancha, setCancha] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [okMsg, setOkMsg] = useState<string>("");

  useEffect(() => {
    if (visible && inscripcion) {
      setNombre(inscripcion.nombre || "");
      setTelefono(inscripcion.telefono || "");
      setCancha((inscripcion as any).cancha_asignada ?? null);
      setErrorMsg("");
      setOkMsg("");
    }
  }, [visible, inscripcion]);

  if (!inscripcion) return null;

  const yaAprobada = inscripcion.estatus_pago === "Aprobado";
  // FIX: usar la prop directamente. Evita warning de variable no usada.
  const canchas = canchasDisponibles;
  const hasChanges =
    nombre.trim() !== (inscripcion.nombre || "") ||
    telefono.trim() !== (inscripcion.telefono || "") ||
    cancha !== ((inscripcion as any).cancha_asignada ?? null);

  const handleSave = async () => {
    setErrorMsg(""); setOkMsg("");
    if (nombre.trim().length < 2) {
      setErrorMsg("Nombre demasiado corto."); return;
    }
    if (!/^\+\d{8,15}$/.test(telefono.replace(/\s/g, ""))) {
      setErrorMsg("Teléfono inválido. Usa formato internacional."); return;
    }
    setSaving(true);
    try {
      const body: { nombre?: string; telefono?: string; cancha_asignada?: number } = {};
      if (nombre.trim() !== inscripcion.nombre) body.nombre = nombre.trim();
      if (telefono.trim() !== inscripcion.telefono) body.telefono = telefono.trim();
      if (cancha !== ((inscripcion as any).cancha_asignada ?? null) && cancha != null) {
        body.cancha_asignada = cancha;
      }
      if (Object.keys(body).length === 0) {
        setErrorMsg("No hay cambios para guardar."); setSaving(false); return;
      }
      const res = await api.patchInscripcionInline(inscripcion.id, body);
      setOkMsg("Cambios guardados.");
      onSaved(res.inscripcion);
      setTimeout(onClose, 800);
    } catch (e: any) {
      const msg = e?.body?.detail || e?.message || "No se pudo guardar.";
      setErrorMsg(typeof msg === "string" ? msg : "Error desconocido");
    } finally { setSaving(false); }
  };

  const handleConfirmarManual = async () => {
    setErrorMsg(""); setOkMsg("");
    setConfirming(true);
    try {
      await api.confirmarInscripcionManual(inscripcion.id, "Confirmación manual desde panel admin");
      setOkMsg("Inscripción confirmada manualmente. ✅");
      // Refrescamos via PATCH dummy para traer datos actualizados.
      const refreshed = { ...inscripcion, estatus_pago: "Aprobado" as const };
      onSaved(refreshed);
      setTimeout(onClose, 1000);
    } catch (e: any) {
      const msg = e?.body?.detail || e?.message || "No se pudo confirmar.";
      setErrorMsg(typeof msg === "string" ? msg : "Error desconocido");
    } finally { setConfirming(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={(e) => e.stopPropagation?.()}>
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>Editar jugador</Text>
              <Text style={styles.sheetSub} numberOfLines={1}>
                {inscripcion.nombre} · {yaAprobada ? "Aprobada ✓" : "Pendiente"}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} testID="admin-sheet-close" style={styles.iconBtn}>
              <X size={20} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Nombre</Text>
            <TextInput
              value={nombre}
              onChangeText={setNombre}
              style={styles.input}
              autoCapitalize="words"
              testID="admin-sheet-nombre"
            />

            <Text style={styles.label}>Teléfono</Text>
            <TextInput
              value={telefono}
              onChangeText={setTelefono}
              style={styles.input}
              keyboardType="phone-pad"
              testID="admin-sheet-telefono"
            />

            <Text style={styles.label}>
              Cancha asignada (1–{canchas})
            </Text>
            <View style={styles.canchasRow}>
              <TouchableOpacity
                style={[styles.canchaChip, cancha == null && styles.canchaChipActive]}
                onPress={() => setCancha(null)}
                testID="admin-sheet-cancha-clear"
              >
                <Text style={[styles.canchaChipTxt, cancha == null && styles.canchaChipTxtActive]}>—</Text>
              </TouchableOpacity>
              {Array.from({ length: canchas }, (_, i) => i + 1).map((n) => (
                <TouchableOpacity
                  key={n}
                  style={[styles.canchaChip, cancha === n && styles.canchaChipActive]}
                  onPress={() => setCancha(n)}
                  testID={`admin-sheet-cancha-${n}`}
                >
                  <MapPin size={11} color={cancha === n ? "#FFFFFF" : colors.brand.primary} />
                  <Text style={[styles.canchaChipTxt, cancha === n && styles.canchaChipTxtActive]}>
                    {n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {errorMsg ? (
              <View style={styles.errorBox}>
                <AlertTriangle size={14} color="#DC2626" />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}
            {okMsg ? (
              <View style={styles.okBox}>
                <CheckCircle2 size={14} color="#059669" />
                <Text style={styles.okText}>{okMsg}</Text>
              </View>
            ) : null}

            {/* Acciones */}
            <View style={styles.btnCol}>
              <TouchableOpacity
                style={[styles.btnPrimary, (!hasChanges || saving) && styles.btnDisabled]}
                onPress={handleSave}
                disabled={!hasChanges || saving}
                testID="admin-sheet-save"
              >
                {saving ? <ActivityIndicator color="#FFFFFF" /> : (
                  <>
                    <Save size={14} color="#FFFFFF" />
                    <Text style={styles.btnPrimaryText}>Guardar cambios</Text>
                  </>
                )}
              </TouchableOpacity>

              {!yaAprobada ? (
                <TouchableOpacity
                  style={[styles.btnSecondary, confirming && styles.btnDisabled]}
                  onPress={handleConfirmarManual}
                  disabled={confirming}
                  testID="admin-sheet-confirm-manual"
                >
                  {confirming ? <ActivityIndicator color={colors.text.primary} /> : (
                    <>
                      <CheckCircle2 size={14} color={colors.brand.primary} />
                      <Text style={styles.btnSecondaryText}>Confirmar pago manual (efectivo)</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.bg.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
    paddingBottom: Platform.OS === "ios" ? 24 : 16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    gap: 8,
  },
  sheetTitle: { ...typography.h3, color: colors.text.primary, fontSize: 16, fontWeight: "800" },
  sheetSub: { color: colors.text.secondary, fontSize: 12, marginTop: 2 },
  iconBtn: { padding: 6 },
  sheetContent: { paddingHorizontal: spacing.lg, paddingVertical: 16, gap: 6 },
  label: {
    ...typography.label,
    color: colors.text.secondary,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    color: colors.text.primary,
    fontSize: 15,
    outlineWidth: 0 as any,
  },
  canchasRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  canchaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.app,
    minWidth: 44,
    justifyContent: "center",
  },
  canchaChipActive: {
    backgroundColor: colors.brand.primary,
    borderColor: colors.brand.primary,
  },
  canchaChipTxt: { color: colors.text.primary, fontSize: 13, fontWeight: "700" },
  canchaChipTxtActive: { color: "#FFFFFF" },
  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8, padding: 10,
    borderRadius: radii.sm, backgroundColor: "#FEF2F2", borderWidth: 1,
    borderColor: "#FECACA", marginTop: 12,
  },
  errorText: { color: "#991B1B", fontSize: 12, flex: 1 },
  okBox: {
    flexDirection: "row", alignItems: "center", gap: 8, padding: 10,
    borderRadius: radii.sm, backgroundColor: "#ECFDF5", borderWidth: 1,
    borderColor: "#A7F3D0", marginTop: 12,
  },
  okText: { color: "#065F46", fontSize: 12, flex: 1 },
  btnCol: { gap: 8, marginTop: 16 },
  btnPrimary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.brand.primary, paddingVertical: 14,
    borderRadius: radii.md,
  },
  btnPrimaryText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
  btnSecondary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.bg.app, borderWidth: 1, borderColor: colors.border.default,
    paddingVertical: 14, borderRadius: radii.md,
  },
  btnSecondaryText: { color: colors.text.primary, fontWeight: "700", fontSize: 13 },
  btnDisabled: { opacity: 0.5 },
});
