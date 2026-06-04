/**
 * LifeBuoySupport — Botón flotante de soporte para la vista pública de Reta.
 *
 * UX:
 *   • FAB redondo abajo-derecha con icono LifeBuoy.
 *   • Tap → modal bottom-sheet con 3 acciones:
 *       1. 💬 WhatsApp Soporte → abre wa.me con número de soporte fijo
 *       2. 🔔 Alertar al organizador → form simple (nombre, tel, motivo)
 *       3. 🚫 Reportar ausencia → form simple (nombre, tel, motivo opcional)
 *
 * Estados:
 *   • idle | submitting | success | error
 *   • Después de success, autoclose en 2.5s.
 *   • Rate-limit (429) del backend se muestra como hint amigable.
 *
 * Accesibilidad:
 *   • Touch target 56x56 (FAB).
 *   • Inputs con labels accesibles.
 *   • Modal cerrable tocando overlay o botón X.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
  Platform,
  Linking,
  ActivityIndicator,
} from "react-native";
import { LifeBuoy, X, MessageCircle, Bell, UserX, Check, AlertTriangle } from "lucide-react-native";
import { api } from "@/src/api";
import { colors, radii, spacing, typography } from "@/src/theme";

// Número fijo de soporte general (admins humanos). Configurable vía env si se quiere.
const SUPPORT_WHATSAPP_NUMBER =
  process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP || "+5215512345678";

type Action = "menu" | "alert" | "ausencia" | "support_whatsapp" | "submitting" | "success" | "error";

type Props = {
  slug: string;
  retaNombre: string;
};

export function LifeBuoySupport({ slug, retaNombre }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Action>("menu");

  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [motivo, setMotivo] = useState("");
  const [resultMsg, setResultMsg] = useState<string>("");

  const reset = () => {
    setView("menu");
    setNombre("");
    setTelefono("");
    setMotivo("");
    setResultMsg("");
  };

  const close = () => {
    setOpen(false);
    setTimeout(reset, 250);
  };

  const openSupportWhatsApp = () => {
    const text = encodeURIComponent(`Hola, necesito ayuda con la reta "${retaNombre}".`);
    const url = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER.replace(/\D/g, "")}?text=${text}`;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      Linking.openURL(url).catch(() => {});
    }
    close();
  };

  const validate = (): string | null => {
    if (nombre.trim().length < 2) return "Tu nombre debe tener al menos 2 letras.";
    if (!/^\+\d{8,15}$/.test(telefono.replace(/\s/g, ""))) {
      return "Teléfono inválido. Usa formato internacional, ej: +5215512345678";
    }
    return null;
  };

  const submitAlert = async () => {
    if (view === "alert" && motivo.trim().length < 2) {
      setResultMsg("Por favor cuéntanos brevemente qué necesitas.");
      return;
    }
    const v = validate();
    if (v) {
      setResultMsg(v);
      return;
    }
    setView("submitting");
    try {
      const res = await api.alertarOrganizador(slug, {
        nombre: nombre.trim(),
        telefono: telefono.trim(),
        motivo: motivo.trim(),
      });
      setResultMsg(res.mensaje);
      setView("success");
      setTimeout(close, 2500);
    } catch (e: any) {
      const msg = e?.body?.detail || e?.message || "No pudimos enviar tu alerta. Intenta de nuevo.";
      setResultMsg(typeof msg === "string" ? msg : "Error desconocido");
      setView("error");
    }
  };

  const submitAusencia = async () => {
    const v = validate();
    if (v) {
      setResultMsg(v);
      return;
    }
    setView("submitting");
    try {
      const res = await api.reportarAusencia(slug, {
        nombre: nombre.trim(),
        telefono: telefono.trim(),
        motivo: motivo.trim() || undefined,
      });
      setResultMsg(res.mensaje);
      setView("success");
      setTimeout(close, 2500);
    } catch (e: any) {
      const msg = e?.body?.detail || e?.message || "No pudimos registrar tu ausencia. Intenta de nuevo.";
      setResultMsg(typeof msg === "string" ? msg : "Error desconocido");
      setView("error");
    }
  };

  return (
    <>
      {/* FAB flotante */}
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={styles.fab}
        accessibilityLabel="Abrir soporte"
        accessibilityRole="button"
        activeOpacity={0.85}
        testID="lifebuoy-fab"
      >
        <LifeBuoy size={24} color="#FFFFFF" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={close}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={(e) => e.stopPropagation?.()}>
            {/* Header */}
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderInfo}>
                <LifeBuoy size={20} color={colors.brand.primary} />
                <Text style={styles.sheetTitle}>
                  {view === "menu" && "¿Necesitas ayuda?"}
                  {view === "alert" && "Alertar al organizador"}
                  {view === "ausencia" && "Reportar ausencia"}
                  {view === "submitting" && "Enviando..."}
                  {view === "success" && "¡Listo!"}
                  {view === "error" && "Algo salió mal"}
                </Text>
              </View>
              <TouchableOpacity onPress={close} style={styles.iconBtn} testID="lifebuoy-close">
                <X size={20} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              {view === "menu" && (
                <>
                  <Text style={styles.helperText}>
                    Estamos para ayudarte con tu reta &quot;{retaNombre}&quot;. ¿Qué necesitas?
                  </Text>

                  <ActionButton
                    icon={<MessageCircle size={20} color="#10B981" />}
                    title="WhatsApp Soporte"
                    subtitle="Habla con un humano del equipo PadelappRetas"
                    onPress={openSupportWhatsApp}
                    testID="lifebuoy-action-support-whatsapp"
                  />

                  <ActionButton
                    icon={<Bell size={20} color={colors.brand.primary} />}
                    title="Alertar al organizador"
                    subtitle="Avisa al organizador de un problema con la reta"
                    onPress={() => setView("alert")}
                    testID="lifebuoy-action-alertar"
                  />

                  <ActionButton
                    icon={<UserX size={20} color="#DC2626" />}
                    title="Reportar ausencia"
                    subtitle="Avisa que no podrás asistir para que liberen tu lugar"
                    onPress={() => setView("ausencia")}
                    testID="lifebuoy-action-ausencia"
                  />
                </>
              )}

              {(view === "alert" || view === "ausencia") && (
                <>
                  <Text style={styles.helperText}>
                    {view === "alert"
                      ? "El organizador recibirá tu mensaje y se pondrá en contacto contigo."
                      : "Solo cuéntanos si quieres dar contexto (opcional). Tu lugar quedará marcado como ausencia."}
                  </Text>

                  <FieldLabel>Tu nombre</FieldLabel>
                  <TextInput
                    value={nombre}
                    onChangeText={setNombre}
                    placeholder="Ej. Andrés Sánchez"
                    placeholderTextColor={colors.text.muted}
                    style={styles.input}
                    autoCapitalize="words"
                    testID="lifebuoy-input-nombre"
                  />

                  <FieldLabel>Tu WhatsApp</FieldLabel>
                  <TextInput
                    value={telefono}
                    onChangeText={setTelefono}
                    placeholder="+5215512345678"
                    placeholderTextColor={colors.text.muted}
                    style={styles.input}
                    keyboardType="phone-pad"
                    testID="lifebuoy-input-telefono"
                  />

                  <FieldLabel>
                    {view === "alert" ? "¿Qué necesitas?" : "Motivo (opcional)"}
                  </FieldLabel>
                  <TextInput
                    value={motivo}
                    onChangeText={setMotivo}
                    placeholder={
                      view === "alert"
                        ? "Ej. No me llegó el link de pago"
                        : "Ej. Me lesioné jugando ayer"
                    }
                    placeholderTextColor={colors.text.muted}
                    style={[styles.input, styles.inputMulti]}
                    multiline
                    numberOfLines={3}
                    maxLength={240}
                    testID="lifebuoy-input-motivo"
                  />

                  {resultMsg ? (
                    <View style={styles.errorBox}>
                      <AlertTriangle size={14} color="#DC2626" />
                      <Text style={styles.errorText}>{resultMsg}</Text>
                    </View>
                  ) : null}

                  <View style={styles.btnRow}>
                    <TouchableOpacity
                      style={styles.btnSecondary}
                      onPress={() => setView("menu")}
                      testID="lifebuoy-back"
                    >
                      <Text style={styles.btnSecondaryText}>Atrás</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.btnPrimary}
                      onPress={view === "alert" ? submitAlert : submitAusencia}
                      testID="lifebuoy-submit"
                    >
                      <Text style={styles.btnPrimaryText}>Enviar</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {view === "submitting" && (
                <View style={styles.centerBox}>
                  <ActivityIndicator size="large" color={colors.brand.primary} />
                  <Text style={styles.centerText}>Enviando tu mensaje...</Text>
                </View>
              )}

              {view === "success" && (
                <View style={styles.centerBox}>
                  <View style={styles.successCircle}>
                    <Check size={32} color="#FFFFFF" />
                  </View>
                  <Text style={styles.centerText}>{resultMsg}</Text>
                </View>
              )}

              {view === "error" && (
                <View style={styles.centerBox}>
                  <AlertTriangle size={36} color="#DC2626" />
                  <Text style={styles.centerText}>{resultMsg}</Text>
                  <TouchableOpacity style={styles.btnPrimary} onPress={() => setView("menu")}>
                    <Text style={styles.btnPrimaryText}>Reintentar</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ============================================================================
// Subcomponentes
// ============================================================================
function ActionButton({
  icon, title, subtitle, onPress, testID,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress} activeOpacity={0.7} testID={testID}>
      <View style={styles.actionIconWrap}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSub}>{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

// ============================================================================
// Styles
// ============================================================================
const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brand.primary,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0px 4px 8px rgba(0,0,0,0.2)",
    elevation: 6,
    zIndex: 1000,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
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
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  sheetHeaderInfo: { flexDirection: "row", alignItems: "center", gap: 8 },
  sheetTitle: { ...typography.h3, color: colors.text.primary, fontSize: 16, fontWeight: "800" },
  iconBtn: { padding: 6 },
  sheetContent: { paddingHorizontal: spacing.lg, paddingVertical: 16, gap: 12 },
  helperText: { ...typography.body, color: colors.text.secondary, fontSize: 13, marginBottom: 4 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.app,
  },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg.card,
  },
  actionTitle: { ...typography.body, color: colors.text.primary, fontWeight: "700", fontSize: 14 },
  actionSub: { color: colors.text.secondary, fontSize: 12, marginTop: 2 },
  label: {
    ...typography.label,
    color: colors.text.secondary,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 4,
    marginTop: 6,
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
  inputMulti: { minHeight: 70, textAlignVertical: "top" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: radii.sm,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    marginTop: 8,
  },
  errorText: { color: "#991B1B", fontSize: 12, flex: 1 },
  btnRow: { flexDirection: "row", gap: 12, marginTop: 12 },
  btnPrimary: {
    flex: 1,
    backgroundColor: colors.brand.primary,
    paddingVertical: 14,
    borderRadius: radii.md,
    alignItems: "center",
  },
  btnPrimaryText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
  btnSecondary: {
    flex: 1,
    backgroundColor: colors.bg.app,
    borderWidth: 1,
    borderColor: colors.border.default,
    paddingVertical: 14,
    borderRadius: radii.md,
    alignItems: "center",
  },
  btnSecondaryText: { color: colors.text.primary, fontWeight: "700", fontSize: 14 },
  centerBox: { alignItems: "center", justifyContent: "center", paddingVertical: 24, gap: 12 },
  centerText: { color: colors.text.primary, fontSize: 14, textAlign: "center", paddingHorizontal: 24 },
  successCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#10B981",
    alignItems: "center",
    justifyContent: "center",
  },
});
