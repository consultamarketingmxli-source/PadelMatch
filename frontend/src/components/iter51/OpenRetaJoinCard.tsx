/**
 * Iter51 · OpenRetaJoinCard + MpPreAuthWebViewSheet
 * ─────────────────────────────────────────────────────────────────────────
 * Componentes del lado JUGADOR para el flujo "Open Reta" con pre-autorización.
 *
 *   <OpenRetaJoinCard />        — Tarjeta con disclaimer + CTA "Solicitar unirme".
 *   <MpPreAuthWebViewSheet />   — Modal fullscreen con WebView que renderiza
 *                                el formulario MP.js (backend endpoint
 *                                `/public/retas/{slug}/preauth-form`). Recibe
 *                                el token via postMessage y ejecuta el POST
 *                                `/api/retas/join-request`.
 *
 * Filosofía de seguridad:
 *   • Los datos de la tarjeta NUNCA salen del WebView (MP.js tokeniza on-device).
 *   • RN sólo recibe el `card_token` (efímero, single-use).
 *   • El disclaimer explica retención vs cargo real.
 *
 * Compatibilidad:
 *   • iOS / Android: react-native-webview.
 *   • Web: fallback → mensaje "Solicita desde la app móvil" (WebView no soportado
 *     en web para postMessage bi-direccional confiable con MP.js).
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router as expoRouter } from "expo-router";
import { WebView } from "react-native-webview";
import { CheckCircle2, Info, Shield, X } from "lucide-react-native";

import { api } from "@/src/api";
import { colors, radii, shadows, spacing, typography } from "@/src/theme";

// ═══════════════════════════════ Types ═══════════════════════════════════
type PreAuthMessage =
  | { event: "ready" }
  | { event: "error"; reason?: string }
  | {
      event: "submit";
      card_token: string;
      payment_method_id: string;
      installments: number;
      issuer_id?: string | null;
      payer_email?: string;
    };

type Props = {
  retaId: string;
  retaSlug: string;
  retaNombre: string;
  amount: number;
  /** ID del jugador ya autenticado (OTP flow). Si null, se solicita login antes. */
  playerId: string | null;
  /** Email del pagador (opcional — MP Brick lo pide en el form si viene vacío). */
  playerEmail?: string | null;
  onSuccess?: (payment_id: string) => void;
};

// ═══════════════════════════ OpenRetaJoinCard ═══════════════════════════
export function OpenRetaJoinCard({
  retaId,
  retaSlug,
  retaNombre,
  amount,
  playerId,
  playerEmail,
  onSuccess,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleTap = useCallback(() => {
    if (!playerId) {
      Alert.alert(
        "Inicia sesión primero",
        "Necesitas verificar tu teléfono para solicitar unirte a la reta.",
      );
      return;
    }
    // playerEmail es opcional — el brick de MP lo pide si no lo tenemos.
    setSheetOpen(true);
  }, [playerId]);

  return (
    <>
      <View style={s.cta}>
        <View style={s.ctaHeader}>
          <View style={s.ctaIcon}>
            <Shield size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.ctaTitle}>¿Quieres unirte a esta reta?</Text>
            <Text style={s.ctaSub}>Modo Open Reta · el organizador decide</Text>
          </View>
        </View>

        <View style={s.disclaimerRow}>
          <Info size={14} color={colors.brand.primary} />
          <Text style={s.disclaimerText}>
            Tu tarjeta será <Text style={s.bold}>retenida</Text> por ${amount.toFixed(2)} MXN.
            <Text style={s.bold}> No se cobra</Text> hasta que el organizador te apruebe.
          </Text>
        </View>

        <View style={s.pointsList}>
          <PointRow icon={<CheckCircle2 size={14} color={colors.status.green} />} text="Si te aprueba: se cobra y ocupas tu cupo." />
          <PointRow icon={<CheckCircle2 size={14} color={colors.status.green} />} text="Si te rechaza: se libera al 100% (0% comisión)." />
          <PointRow icon={<CheckCircle2 size={14} color={colors.status.green} />} text="Si no decide en 2 h antes del partido: se libera automático." />
        </View>

        <TouchableOpacity style={s.ctaBtn} onPress={handleTap} testID="open-reta-solicitar-btn">
          <Text style={s.ctaBtnText}>Solicitar unirme · ${amount.toFixed(2)} MXN</Text>
        </TouchableOpacity>
      </View>

      <MpPreAuthWebViewSheet
        visible={sheetOpen}
        retaId={retaId}
        retaSlug={retaSlug}
        retaNombre={retaNombre}
        amount={amount}
        playerId={playerId!}
        playerEmail={playerEmail || ""}
        onClose={() => setSheetOpen(false)}
        onSuccess={(pid) => {
          setSheetOpen(false);
          onSuccess?.(pid);
        }}
      />
    </>
  );
}

function PointRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={s.pointRow}>
      {icon}
      <Text style={s.pointText}>{text}</Text>
    </View>
  );
}

// ══════════════════════════ MpPreAuthWebViewSheet ══════════════════════════
export function MpPreAuthWebViewSheet({
  visible,
  retaId,
  retaSlug,
  retaNombre,
  amount,
  playerId,
  playerEmail,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  retaId: string;
  retaSlug: string;
  retaNombre: string;
  amount: number;
  playerId: string;
  playerEmail: string;
  onClose: () => void;
  onSuccess: (payment_id: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [webReady, setWebReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittedRef = useRef(false);

  const formUrl = useMemo(() => api.getPreauthFormUrl(retaSlug, amount), [retaSlug, amount]);

  const handleMessage = useCallback(
    async (raw: string) => {
      let msg: PreAuthMessage | null = null;
      try {
        msg = JSON.parse(raw) as PreAuthMessage;
      } catch {
        return;
      }
      if (!msg) return;

      if (msg.event === "ready") {
        setWebReady(true);
        return;
      }
      if (msg.event === "error") {
        setError(msg.reason || "Error inesperado en Mercado Pago.");
        return;
      }
      if (msg.event === "submit") {
        if (submittedRef.current) return; // guard doble-submit
        submittedRef.current = true;
        setSubmitting(true);
        try {
          const res = await api.crearJoinRequest({
            match_id: retaId,
            player_id: playerId,
            amount,
            card_token: msg.card_token,
            payer_email: msg.payer_email || playerEmail || "",
            installments: msg.installments || 1,
            payment_method_id: msg.payment_method_id || null,
          });
          Alert.alert(
            "¡Solicitud enviada!",
            `Retuvimos $${amount.toFixed(2)} MXN en tu tarjeta. El organizador de ${retaNombre} decidirá pronto. Te avisamos por email y push.`,
            [
              { text: "Ver mis solicitudes", onPress: () => { try { expoRouter.push("/player/solicitudes" as any); } catch { /* ignore */ } } },
              { text: "OK", style: "cancel" },
            ],
          );
          onSuccess(res.payment_id);
        } catch (e: any) {
          submittedRef.current = false; // permite retry si el error fue de red
          const msgErr = e?.message || "";
          if (msgErr.includes("409")) {
            Alert.alert("Ya tienes una solicitud", "Espera la decisión del organizador antes de solicitar de nuevo.");
            onClose();
          } else if (msgErr.includes("402")) {
            Alert.alert(
              "Tarjeta rechazada",
              "Tu banco no autorizó la retención. Intenta con otra tarjeta.",
            );
          } else if (msgErr.includes("424")) {
            Alert.alert(
              "Organizador sin Mercado Pago",
              "El organizador aún no conectó su cuenta de MP. Contáctalo por WhatsApp.",
            );
            onClose();
          } else {
            Alert.alert("No se pudo procesar", msgErr || "Intenta de nuevo.");
          }
        } finally {
          setSubmitting(false);
        }
      }
    },
    [retaId, retaNombre, amount, playerId, playerEmail, onClose, onSuccess],
  );

  const handleClose = useCallback(() => {
    if (submitting) {
      Alert.alert(
        "Solicitud en proceso",
        "Espera unos segundos, estamos procesando tu solicitud con Mercado Pago.",
      );
      return;
    }
    onClose();
  }, [submitting, onClose]);

  // Web fallback — RN WebView no soporta postMessage confiable con MP.js.
  if (Platform.OS === "web") {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={s.backdrop} onPress={onClose}>
          <Pressable style={s.webFallback} onPress={(e) => e.stopPropagation()}>
            <Text style={s.webFallbackTitle}>Continúa desde la app móvil</Text>
            <Text style={s.webFallbackSub}>
              El pago con pre-autorización requiere tokenizar tu tarjeta de forma segura,
              lo cual sólo funciona en la app iOS/Android de PadelAppRetas.
            </Text>
            <TouchableOpacity
              style={s.webFallbackBtn}
              onPress={() => Linking.openURL(formUrl)}
            >
              <Text style={s.webFallbackBtnText}>Abrir formulario web (avanzado)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.webFallbackClose} onPress={onClose}>
              <Text style={s.webFallbackCloseText}>Cerrar</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <SafeAreaView style={s.sheet} edges={["top", "bottom"]}>
        <View style={s.sheetHeader}>
          <TouchableOpacity onPress={handleClose} style={s.closeBtn} testID="preauth-close">
            <X size={22} color={colors.text.primary} />
          </TouchableOpacity>
          <Text style={s.sheetTitle} numberOfLines={1}>
            {retaNombre}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        {error ? (
          <View style={s.errorState}>
            <Text style={s.errorTitle}>No pudimos cargar el pago</Text>
            <Text style={s.errorSub}>{error}</Text>
            <TouchableOpacity style={s.errorRetry} onPress={() => { setError(null); submittedRef.current = false; }}>
              <Text style={s.errorRetryText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {!webReady && (
              <View style={s.loadingOverlay}>
                <ActivityIndicator size="large" color={colors.brand.primary} />
                <Text style={s.loadingText}>Cargando Mercado Pago…</Text>
              </View>
            )}
            <WebView
              source={{ uri: formUrl }}
              onMessage={(evt) => handleMessage(evt.nativeEvent.data)}
              startInLoadingState
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={["*"]}
              style={{ flex: 1, opacity: webReady ? 1 : 0 }}
              testID="preauth-webview"
            />
            {submitting && (
              <View style={s.submitOverlay}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={s.submitText}>Procesando tu solicitud…</Text>
              </View>
            )}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ═══════════════════════════════ Styles ═══════════════════════════════════
const s = StyleSheet.create({
  // Card
  cta: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
    ...shadows.card,
  },
  ctaHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  ctaIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brand.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  ctaTitle: { ...typography.body, fontWeight: "800", color: colors.text.primary, letterSpacing: -0.2 },
  ctaSub: { ...typography.caption, color: colors.text.secondary, marginTop: 2 },
  disclaimerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: colors.brand.primaryMuted,
    padding: 10,
    borderRadius: 8,
    marginBottom: spacing.sm,
  },
  disclaimerText: {
    flex: 1,
    ...typography.caption,
    color: colors.text.body,
    lineHeight: 17,
  },
  bold: { fontWeight: "800", color: colors.text.primary },
  pointsList: { gap: 6, marginBottom: spacing.md },
  pointRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pointText: { ...typography.caption, color: colors.text.body, flex: 1, lineHeight: 17 },
  ctaBtn: {
    backgroundColor: colors.brand.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  ctaBtnText: { color: "#fff", fontWeight: "800", fontSize: 15, letterSpacing: -0.2 },
  // WebView sheet
  sheet: { flex: 1, backgroundColor: colors.bg.app },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    backgroundColor: "#fff",
  },
  sheetTitle: {
    flex: 1,
    textAlign: "center",
    ...typography.body,
    fontWeight: "800",
    color: colors.text.primary,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.bg.app,
    zIndex: 10,
  },
  loadingText: {
    marginTop: 12,
    ...typography.caption,
    color: colors.text.secondary,
  },
  submitOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.75)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 20,
  },
  submitText: { color: "#fff", marginTop: 12, fontSize: 14, fontWeight: "700" },
  errorState: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.lg },
  errorTitle: { ...typography.h3, fontWeight: "800", color: colors.status.red, marginBottom: 6 },
  errorSub: { ...typography.body, color: colors.text.secondary, textAlign: "center", marginBottom: spacing.md },
  errorRetry: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  errorRetryText: { color: "#fff", fontWeight: "700" },
  // Web fallback
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  webFallback: {
    backgroundColor: "#fff",
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  webFallbackTitle: {
    ...typography.h3,
    fontWeight: "800",
    color: colors.text.primary,
    marginBottom: 6,
  },
  webFallbackSub: {
    ...typography.caption,
    color: colors.text.secondary,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  webFallbackBtn: {
    backgroundColor: colors.brand.primary,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 10,
  },
  webFallbackBtnText: { color: "#fff", fontWeight: "700" },
  webFallbackClose: { alignItems: "center", padding: 10 },
  webFallbackCloseText: { color: colors.text.secondary, fontWeight: "700" },
});
