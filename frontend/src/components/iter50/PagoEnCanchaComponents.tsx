/**
 * Iter50 — Componentes para Pago en Cancha + Inscripción Manual
 *
 * Tres componentes auto-contenidos para inyectar en pantallas existentes:
 *
 *   - <AgregarManualModal />     Modal del admin con nombre+teléfono inputs.
 *   - <MarcarPagadoButton />      Botón check-in en cada inscripción manual.
 *   - <AvisosManualesBanner />    Banner con lista + deeplinks WhatsApp para
 *                                cuando se cancela/reagenda una reta.
 *
 *   - <CashPaymentOption />       Toggle público "Pagar en cancha" para el
 *                                checkout cuando `permitir_pago_cancha=true`.
 *
 *   - <PermitirPagoCanchaToggle /> Toggle en el form de creación de reta.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { BellRing, Check, MessageCircle, Plus, Wallet } from "lucide-react-native";

import { api } from "@/src/api";
import { colors, radii, shadows, spacing, typography } from "@/src/theme";

// ────────────────────── AgregarManualModal ────────────────────────────────
export function AgregarManualModal({
  visible, retaId, onClose, onCreated,
}: {
  visible: boolean;
  retaId: string;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [metodo, setMetodo] = useState<"efectivo_cancha" | "transferencia_manual">("efectivo_cancha");
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) {
      setNombre(""); setTelefono(""); setMetodo("efectivo_cancha"); setNota("");
    }
  }, [visible]);

  const submit = async () => {
    if (!nombre.trim()) {
      Alert.alert("Falta el nombre", "Captura el nombre del jugador (mínimo 2 caracteres).");
      return;
    }
    setBusy(true);
    try {
      await api.agregarInscripcionManual(retaId, {
        nombre_temporal: nombre.trim(),
        telefono: telefono.trim() || undefined,
        metodo_pago: metodo,
        nota: nota.trim() || undefined,
      });
      onCreated?.();
      onClose();
    } catch (e: any) {
      const msg = e?.message || "No se pudo agregar.";
      if (msg.toLowerCase().includes("llena") || msg.includes("409")) {
        Alert.alert("Reta llena", "No hay cupos disponibles. Libera uno o usa la lista de espera.");
      } else {
        Alert.alert("Error", msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.modalCard} onPress={(e) => e.stopPropagation()}>
          <View style={s.modalHeader}>
            <View style={s.modalIconWrap}><Plus size={22} color="#fff" /></View>
            <Text style={s.modalTitle}>Agregar jugador manual</Text>
            <Text style={s.modalSub}>Para jugadores contactados por WhatsApp sin cuenta en la app.</Text>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
            <Text style={s.label}>Nombre *</Text>
            <TextInput
              style={s.input} placeholder="Carlos R. (WhatsApp)" placeholderTextColor={colors.text.tertiary}
              value={nombre} onChangeText={setNombre} autoFocus testID="input-nombre-manual"
            />
            <Text style={s.label}>Teléfono (opcional)</Text>
            <TextInput
              style={s.input} placeholder="+52 1 55 1234 5678" placeholderTextColor={colors.text.tertiary}
              value={telefono} onChangeText={setTelefono} keyboardType="phone-pad" testID="input-tel-manual"
            />
            <Text style={s.label}>Método de pago</Text>
            <View style={s.row}>
              <ChoiceChip label="💵 Efectivo" active={metodo === "efectivo_cancha"} onPress={() => setMetodo("efectivo_cancha")} />
              <ChoiceChip label="🏦 Transferencia" active={metodo === "transferencia_manual"} onPress={() => setMetodo("transferencia_manual")} />
            </View>
            <Text style={s.label}>Nota (opcional)</Text>
            <TextInput
              style={[s.input, { height: 64 }]} placeholder="Ej. confirma 1 hora antes"
              placeholderTextColor={colors.text.tertiary}
              value={nota} onChangeText={setNota} multiline numberOfLines={3} maxLength={240}
            />
          </ScrollView>
          <View style={s.modalFooter}>
            <TouchableOpacity style={s.btnSecondary} onPress={onClose} disabled={busy}>
              <Text style={s.btnSecondaryText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btnPrimary, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}
              testID="btn-agregar-manual-confirmar"
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryText}>Agregar</Text>}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ChoiceChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, active && s.chipActive]}>
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ────────────────────── MarcarPagadoButton ────────────────────────────────
export function MarcarPagadoButton({
  retaId, inscripcionId, onMarked,
}: { retaId: string; inscripcionId: string; onMarked?: () => void }) {
  const [busy, setBusy] = useState(false);
  const onPress = useCallback(() => {
    Alert.alert(
      "Marcar como pagado",
      "¿Confirmas que el jugador ya pagó en cancha?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Sí, marcar pagado",
          onPress: async () => {
            setBusy(true);
            try {
              await api.marcarInscripcionPagada(retaId, inscripcionId);
              onMarked?.();
            } catch (e: any) {
              Alert.alert("Error", e?.message || "No se pudo marcar.");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [retaId, inscripcionId, onMarked]);
  return (
    <TouchableOpacity
      style={[s.checkinBtn, busy && { opacity: 0.6 }]} onPress={onPress} disabled={busy}
      testID="btn-marcar-pagado"
    >
      {busy ? <ActivityIndicator size="small" color="#fff" /> : <Check size={14} color="#fff" />}
      <Text style={s.checkinBtnText}>Check-in</Text>
    </TouchableOpacity>
  );
}

// ───────────────────── AvisosManualesBanner ──────────────────────────────
export function AvisosManualesBanner({ retaId }: { retaId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getAvisosManuales>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.getAvisosManuales(retaId);
      setData(r);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [retaId]);

  useEffect(() => { void load(); }, [load]);

  if (loading || !data || data.total === 0) return null;

  const copyBulk = async () => {
    try {
      await Share.share({ message: data.bulk_whatsapp_payload });
    } catch {
      // fallback: copy to clipboard via Clipboard API si está disponible
      try {
        // Lazy import — no agregamos dependencia.
        const { setStringAsync } = await import("expo-clipboard");
        await setStringAsync(data.bulk_whatsapp_payload);
        Alert.alert("Copiado", "El mensaje está en tu portapapeles.");
      } catch {
        Alert.alert("Mensaje", data.bulk_whatsapp_payload);
      }
    }
  };

  return (
    <View style={s.banner}>
      <View style={s.bannerHeader}>
        <BellRing size={18} color="#92400E" />
        <Text style={s.bannerTitle}>
          {data.total} jugador{data.total === 1 ? "" : "es"} para avisar manualmente
        </Text>
      </View>
      <Text style={s.bannerSub}>
        Estos jugadores fueron agregados por ti y no tienen la app. Si cancelas o cambias la fecha, avísales por WhatsApp directamente.
      </Text>
      <TouchableOpacity style={s.bannerCta} onPress={() => setExpanded((v) => !v)}>
        <Text style={s.bannerCtaText}>{expanded ? "Ocultar lista" : "Ver lista y mensajes"}</Text>
      </TouchableOpacity>
      {expanded && (
        <View style={{ marginTop: 8 }}>
          {data.lista_jugadores.map((j) => (
            <View key={j.inscripcion_id} style={s.bannerRow}>
              <Text style={s.bannerRowName}>{j.nombre_temporal}</Text>
              {j.wa_link ? (
                <TouchableOpacity onPress={() => Linking.openURL(j.wa_link as string)}>
                  <View style={s.waBtn}>
                    <MessageCircle size={12} color="#fff" />
                    <Text style={s.waBtnText}>WhatsApp</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <Text style={s.bannerRowMeta}>(sin tel)</Text>
              )}
            </View>
          ))}
          <TouchableOpacity style={s.bulkBtn} onPress={copyBulk}>
            <Text style={s.bulkBtnText}>📋 Copiar mensaje bulk</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ────────────────────── PermitirPagoCanchaToggle ─────────────────────────────
export function PermitirPagoCanchaToggle({
  value, onChange,
}: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={s.toggleCard}>
      <View style={s.toggleRow}>
        <View style={{ flex: 1, paddingRight: spacing.md }}>
          <View style={s.toggleHeader}>
            <Wallet size={16} color={colors.brand.primary} />
            <Text style={s.toggleLabel}>Permitir pago en cancha</Text>
          </View>
          <Text style={s.toggleHint}>
            Los jugadores podrán elegir "Pagar en efectivo" o "Transferencia" como alternativa al pago en línea. Tú cierras el cobro el día del evento.
          </Text>
        </View>
        <Switch
          value={value} onValueChange={onChange}
          trackColor={{ false: "#CBD5E1", true: colors.brand.primary }}
          thumbColor="#fff" ios_backgroundColor="#CBD5E1"
          testID="switch-permitir-pago-cancha"
        />
      </View>
    </View>
  );
}

// ─────────────────────────── CashPaymentOption ───────────────────────────────
export function CashPaymentOption({
  enabled, selected, onChange,
}: { enabled: boolean; selected: "online" | "efectivo_cancha"; onChange: (v: "online" | "efectivo_cancha") => void }) {
  if (!enabled) return null;
  return (
    <View style={s.cashCard}>
      <Text style={s.cashTitle}>¿Cómo prefieres pagar?</Text>
      <View style={s.cashRow}>
        <CashChoice
          label="En línea" emoji="💳"
          desc="Confirmación inmediata"
          active={selected === "online"} onPress={() => onChange("online")}
        />
        <CashChoice
          label="En cancha" emoji="💵"
          desc="Paga al organizador"
          active={selected === "efectivo_cancha"} onPress={() => onChange("efectivo_cancha")}
        />
      </View>
      {selected === "efectivo_cancha" && (
        <Text style={s.cashWarn}>
          📝 El organizador confirmará tu pago el día del evento. Tu cupo queda bloqueado en "Pendiente" hasta entonces.
        </Text>
      )}
    </View>
  );
}

function CashChoice({ label, emoji, desc, active, onPress }: { label: string; emoji: string; desc: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.cashChoice, active && s.cashChoiceActive]}>
      <Text style={{ fontSize: 22 }}>{emoji}</Text>
      <Text style={[s.cashChoiceLabel, active && s.cashChoiceLabelActive]}>{label}</Text>
      <Text style={s.cashChoiceDesc}>{desc}</Text>
    </TouchableOpacity>
  );
}

// ──────────────────────────────────────── Styles ────────────────────────────────────────
const s = StyleSheet.create({
  // Modal
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, maxHeight: "85%",
  },
  modalHeader: { marginBottom: spacing.md, alignItems: "center" },
  modalIconWrap: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand.primary,
    justifyContent: "center", alignItems: "center", marginBottom: 8,
  },
  modalTitle: { ...typography.h3, fontWeight: "800", color: colors.text.primary, marginBottom: 4 },
  modalSub: { ...typography.caption, color: colors.text.secondary, textAlign: "center" },
  modalFooter: { flexDirection: "row", gap: 10, marginTop: spacing.md },
  label: { ...typography.caption, fontWeight: "700", color: colors.text.secondary, marginBottom: 6, marginTop: 8 },
  input: {
    borderWidth: 1, borderColor: "#E2E8F0", borderRadius: radii.md, paddingHorizontal: 12,
    paddingVertical: 11, fontSize: 15, color: colors.text.primary, backgroundColor: "#F8FAFC",
  },
  row: { flexDirection: "row", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 100, borderWidth: 1, borderColor: "#E2E8F0", backgroundColor: "#F8FAFC" },
  chipActive: { borderColor: colors.brand.primary, backgroundColor: "rgba(37,99,235,0.10)" },
  chipText: { ...typography.caption, color: colors.text.secondary, fontWeight: "600" },
  chipTextActive: { color: colors.brand.primary, fontWeight: "700" },
  btnPrimary: {
    flex: 1, backgroundColor: colors.brand.primary, paddingVertical: 13, borderRadius: 12,
    alignItems: "center", justifyContent: "center", minHeight: 48,
  },
  btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  btnSecondary: {
    flex: 1, backgroundColor: "#F1F5F9", paddingVertical: 13, borderRadius: 12,
    alignItems: "center", justifyContent: "center", minHeight: 48,
  },
  btnSecondaryText: { color: colors.text.secondary, fontWeight: "700", fontSize: 15 },
  // Check-in btn
  checkinBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.status.green, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, minHeight: 28,
  },
  checkinBtnText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  // Banner
  banner: {
    backgroundColor: "#FEF3C7", borderRadius: radii.md, padding: spacing.md,
    borderWidth: 1, borderColor: "#FDE68A", marginBottom: spacing.md,
  },
  bannerHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  bannerTitle: { ...typography.body, fontWeight: "700", color: "#92400E" },
  bannerSub: { ...typography.caption, color: "#78350F", lineHeight: 18 },
  bannerCta: {
    marginTop: spacing.sm, backgroundColor: "#B45309", paddingVertical: 9, borderRadius: 10,
    alignItems: "center",
  },
  bannerCtaText: { color: "#fff", fontWeight: "700" },
  bannerRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#FDE68A",
  },
  bannerRowName: { ...typography.body, color: "#78350F", flex: 1 },
  bannerRowMeta: { ...typography.caption, color: "#A16207" },
  waBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#25D366",
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
  },
  waBtnText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  bulkBtn: {
    marginTop: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: "#B45309",
    paddingVertical: 10, borderRadius: 10, alignItems: "center",
  },
  bulkBtnText: { color: "#B45309", fontWeight: "700" },
  // Toggle
  toggleCard: {
    backgroundColor: "#fff", borderRadius: radii.md, padding: spacing.md,
    marginVertical: spacing.sm, ...shadows.card,
  },
  toggleRow: { flexDirection: "row", alignItems: "center" },
  toggleHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  toggleLabel: { ...typography.body, fontWeight: "700", color: colors.text.primary },
  toggleHint: { ...typography.caption, color: colors.text.secondary, lineHeight: 17 },
  // Cash option
  cashCard: {
    backgroundColor: "#F8FAFC", borderRadius: radii.md, padding: spacing.md,
    marginVertical: spacing.sm, borderWidth: 1, borderColor: "#E2E8F0",
  },
  cashTitle: { ...typography.body, fontWeight: "700", color: colors.text.primary, marginBottom: 10 },
  cashRow: { flexDirection: "row", gap: 10 },
  cashChoice: {
    flex: 1, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: "#E2E8F0",
    backgroundColor: "#fff", alignItems: "center",
  },
  cashChoiceActive: { borderColor: colors.brand.primary, backgroundColor: "rgba(37,99,235,0.05)" },
  cashChoiceLabel: { ...typography.body, fontWeight: "700", color: colors.text.primary, marginTop: 4 },
  cashChoiceLabelActive: { color: colors.brand.primary },
  cashChoiceDesc: { ...typography.caption, color: colors.text.tertiary, fontSize: 11, marginTop: 2 },
  cashWarn: {
    marginTop: 10, ...typography.caption, color: "#92400E", backgroundColor: "#FEF3C7",
    padding: 8, borderRadius: 8, lineHeight: 18,
  },
});
