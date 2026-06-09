/**
 * Pantalla Admin · Vinculación Mercado Pago (Marketplace).
 *
 * Reglas:
 * - Sin comisión por defecto: el organizador recibe 100% del cobro.
 * - Toggle "Aplicar comisión 10%" disponible para activar a futuro.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Wallet,
  Unplug,
  Lock,
} from "lucide-react-native";

import { api, MpStatus } from "@/src/api";
import { colors, radii, spacing, typography } from "@/src/theme";
import { HeroBanner } from "@/src/components/brand/HeroBanner";
import { Chip } from "@/src/components/brand/Chip";

const MP_DEVELOPERS_URL = "https://www.mercadopago.com.mx/developers/panel/app";

export default function MercadoPagoScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mp_oauth?: string; reason?: string }>();
  const [status, setStatus] = useState<MpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [token, setToken] = useState("");
  const [savingFee, setSavingFee] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.mpStatus();
      setStatus(s);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo cargar el estado");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Manejo del retorno del flujo OAuth — el backend redirige con ?mp_oauth=ok|error.
  useEffect(() => {
    const flag = params?.mp_oauth;
    if (!flag) return;
    if (flag === "ok") {
      Alert.alert(
        "¡Cuenta conectada!",
        "Tu cuenta de Mercado Pago se vinculó correctamente vía OAuth. Los pagos llegarán directamente a tu cuenta.",
      );
    } else if (flag === "error") {
      const reason = params?.reason ?? "desconocido";
      Alert.alert(
        "No se pudo conectar",
        `Mercado Pago rechazó la vinculación (${reason}). Intenta de nuevo o usa el modo avanzado (pegar Access Token).`,
      );
    }
    // Limpia los query params del URL para que el alert no se dispare otra vez al refrescar.
    if (Platform.OS === "web" && typeof window !== "undefined") {
      try {
        window.history.replaceState({}, "", "/admin/mercadopago");
      } catch {
        /* noop */
      }
    }
    // Re-cargamos status por si el callback acabó de guardar el token.
    void load();
  }, [params?.mp_oauth, params?.reason, load]);

  const handleConnectOAuth = async () => {
    setOauthBusy(true);
    try {
      const res = await api.mpOAuthStart();
      // En web abrimos en la misma pestaña para preservar el contexto de sesión.
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.href = res.authorize_url;
        return;
      }
      // En nativo abrimos el navegador externo del sistema operativo.
      await Linking.openURL(res.authorize_url);
    } catch (e: any) {
      Alert.alert(
        "OAuth no disponible",
        e?.message ??
          "No se pudo iniciar el flujo OAuth. Revisa que MP_CLIENT_ID/MP_CLIENT_SECRET estén configurados en el backend.",
      );
    } finally {
      setOauthBusy(false);
    }
  };

  const handleConnect = async () => {
    const t = token.trim();
    if (!t.startsWith("APP_USR-") && !t.startsWith("TEST-")) {
      Alert.alert(
        "Token inválido",
        "El Access Token debe comenzar con APP_USR- o TEST-. Cópialo desde el panel de Mercado Pago Developers.",
      );
      return;
    }
    setBusy(true);
    try {
      const s = await api.mpConnect(t);
      setStatus(s);
      setToken("");
      Alert.alert(
        "Cuenta vinculada",
        `Tu cuenta Mercado Pago (${s.nickname ?? s.mp_user_id}) está conectada. A partir de ahora los pagos llegarán a esta cuenta.`,
      );
    } catch (e: any) {
      Alert.alert("No se pudo vincular", e.message ?? "Token rechazado por Mercado Pago.");
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    Alert.alert(
      "Desvincular Mercado Pago",
      "Si desvinculas, ninguna reta podrá recibir pagos hasta que vuelvas a conectar una cuenta. ¿Continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Desvincular",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await api.mpDisconnect();
              await load();
            } catch (e: any) {
              Alert.alert("Error", e.message ?? "No se pudo desvincular");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const toggleApplyFee = async (next: boolean) => {
    setSavingFee(true);
    try {
      const s = await api.mpUpdateSettings(next);
      setStatus(s);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo actualizar");
    } finally {
      setSavingFee(false);
    }
  };

  if (loading || !status) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.iconBtn}
            testID="mp-back"
          >
            <ArrowLeft size={18} color={colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.title}>Mercado Pago</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <HeroBanner
            eyebrow="PADELAPPRETAS · PAGOS"
            title="Mercado Pago"
            subtitle={status.connected
              ? `Vinculado · ${status.nickname ?? status.mp_user_id ?? "cuenta lista"}`
              : "Vincula tu cuenta para recibir el 100% del cobro directo"}
            height={172}
            right={
              <Chip
                label={status.connected ? "Conectado" : "Sin vincular"}
                variant={status.connected ? "available" : "premium"}
                dot
                size="md"
              />
            }
            style={{ marginBottom: spacing.lg }}
          />
          {/* Estado de conexión */}
          <View
            style={[
              styles.statusCard,
              status.connected ? styles.cardOk : styles.cardWarn,
            ]}
          >
            <View style={styles.statusHead}>
              {status.connected ? (
                <CheckCircle2 size={22} color={colors.status.green} />
              ) : (
                <CircleAlert size={22} color={colors.status.amber} />
              )}
              <Text style={styles.statusTitle}>
                {status.connected ? "Cuenta vinculada" : "Sin vincular"}
              </Text>
            </View>
            {status.connected ? (
              <View style={{ gap: 4 }}>
                <Row label="Cuenta" value={status.nickname ?? "—"} />
                <Row label="MP User ID" value={status.mp_user_id ?? "—"} />
                <Row label="País" value={status.site_id ?? "—"} />
                {status.connected_at ? (
                  <Row
                    label="Conectada"
                    value={new Date(status.connected_at).toLocaleString("es-MX")}
                  />
                ) : null}
              </View>
            ) : (
              <Text style={styles.statusDesc}>
                Para que tus retas reciban pagos, vincula tu cuenta de Mercado
                Pago. El 100% del cobro irá directamente a tu cuenta.
              </Text>
            )}
          </View>

          {/* Connect form */}
          {!status.connected ? (
            <View style={styles.card}>
              <Text style={styles.section}>Vincular cuenta</Text>

              {/* ===== OAuth (recomendado) — Marketplace expansion ===== */}
              <Text style={styles.help}>
                Conexión recomendada en un solo paso: te lleva al login oficial de
                Mercado Pago, autorizas a PadelAppRetas, y volvemos aquí con la
                cuenta conectada. Todos los pagos llegan directo a tu cuenta MP.
              </Text>
              <TouchableOpacity
                onPress={handleConnectOAuth}
                disabled={oauthBusy}
                style={[styles.primaryBtn, oauthBusy && { opacity: 0.7 }]}
                testID="mp-oauth-btn"
                activeOpacity={0.85}
              >
                {oauthBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Wallet size={16} color="#fff" />
                    <Text style={styles.primaryText}>Conectar con Mercado Pago</Text>
                  </>
                )}
              </TouchableOpacity>
              <View style={styles.secureRow}>
                <Lock size={11} color={colors.text.muted} />
                <Text style={styles.secureText}>
                  {status?.encryption_available
                    ? "Conexión OAuth · token cifrado at-rest (Fernet)."
                    : "Conexión OAuth · encriptación at-rest no configurada (modo dev)."}
                </Text>
              </View>

              {/* Toggle "Avanzado" para el modo manual (token paste) */}
              <TouchableOpacity
                onPress={() => setShowAdvanced((v) => !v)}
                style={styles.advancedToggle}
                activeOpacity={0.7}
                testID="mp-advanced-toggle"
              >
                <Text style={styles.advancedToggleText}>
                  {showAdvanced ? "Ocultar opción avanzada ▲" : "¿Tienes ya un Access Token? Modo avanzado ▼"}
                </Text>
              </TouchableOpacity>

              {showAdvanced ? (
                <View style={styles.advancedPanel}>
                  <Text style={styles.help}>
                    Pega tu Access Token de Mercado Pago. Lo encuentras en:
                  </Text>
                  <TouchableOpacity
                    onPress={() => void Linking.openURL(MP_DEVELOPERS_URL)}
                    style={styles.linkBtn}
                  >
                    <ExternalLink size={14} color={colors.brand.primary} />
                    <Text style={styles.linkText}>
                      mercadopago.com.mx/developers/panel/app
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.steps}>
                    1. Crea (o abre) tu aplicación de Checkout Pro.{"\n"}
                    2. Ve a {"\u201C"}Credenciales de prueba{"\u201D"} o {"\u201C"}Productivas{"\u201D"}.{"\n"}
                    3. Copia el <Text style={{ fontWeight: "700" }}>Access Token</Text> (empieza con
                    APP_USR- o TEST-).{"\n"}
                    4. Pégalo abajo y presiona Vincular.
                  </Text>
                  <TextInput
                    value={token}
                    onChangeText={setToken}
                    placeholder="APP_USR-xxxxxxxx-xxxxxx-xxxxxxxxxxxxxxxx-xxxxxxxxx"
                    placeholderTextColor={colors.text.tertiary}
                    style={styles.input}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    testID="mp-token-input"
                  />
                  <TouchableOpacity
                    onPress={handleConnect}
                    disabled={busy || !token.trim()}
                    style={[
                      styles.secondaryBtn,
                      (busy || !token.trim()) && { opacity: 0.6 },
                    ]}
                    testID="mp-connect-btn"
                  >
                    {busy ? (
                      <ActivityIndicator color={colors.brand.primary} />
                    ) : (
                      <Text style={styles.secondaryText}>Vincular con Access Token</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Configuración comisión */}
          {status.connected ? (
            <View style={styles.card}>
              <Text style={styles.section}>Comisión de la plataforma</Text>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>
                    Aplicar comisión {status.fee_percent}%
                  </Text>
                  <Text style={styles.toggleDesc}>
                    {status.apply_fee
                      ? `De cada inscripción, ${status.fee_percent}% irá a la plataforma. El resto (${(100 - status.fee_percent).toFixed(0)}%) a tu cuenta.`
                      : "Está apagado: recibes el 100% del cobro en tu cuenta de Mercado Pago."}
                  </Text>
                </View>
                <Switch
                  value={status.apply_fee}
                  onValueChange={toggleApplyFee}
                  disabled={savingFee}
                  trackColor={{ false: colors.border.default, true: colors.brand.primary }}
                  thumbColor="#fff"
                  testID="mp-fee-toggle"
                />
              </View>
            </View>
          ) : null}

          {/* Disconnect */}
          {status.connected ? (
            <TouchableOpacity
              onPress={handleDisconnect}
              disabled={busy}
              style={[styles.dangerBtn, busy && { opacity: 0.6 }]}
              testID="mp-disconnect-btn"
            >
              <Unplug size={16} color={colors.status.red} />
              <Text style={styles.dangerText}>Desvincular cuenta</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...typography.h2, color: colors.text.primary, fontSize: 18 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

  statusCard: {
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  cardOk: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
  },
  cardWarn: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  statusHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  statusTitle: { ...typography.h2, fontSize: 16, color: colors.text.primary },
  statusDesc: { color: colors.text.secondary, fontSize: 13, lineHeight: 18 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowLabel: { color: colors.text.secondary, fontSize: 12, fontWeight: "600" },
  rowValue: {
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: "700",
    maxWidth: "60%",
    textAlign: "right",
  },

  card: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  section: {
    ...typography.h2,
    color: colors.text.primary,
    fontSize: 15,
  },
  help: { color: colors.text.secondary, fontSize: 13, lineHeight: 18 },
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
  },
  linkText: { color: colors.brand.primary, fontSize: 12, fontWeight: "600" },
  steps: { color: colors.text.secondary, fontSize: 12, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.md,
    padding: spacing.sm,
    color: colors.text.primary,
    fontSize: 12,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    minHeight: 80,
    textAlignVertical: "top",
  },
  primaryBtn: {
    backgroundColor: colors.brand.primary,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  toggleTitle: { color: colors.text.primary, fontWeight: "700", fontSize: 14 },
  toggleDesc: {
    color: colors.text.secondary,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },

  dangerBtn: {
    borderWidth: 1,
    borderColor: colors.status.red,
    backgroundColor: "transparent",
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  dangerText: { color: colors.status.red, fontWeight: "700", fontSize: 13 },
  // ===== OAuth marketplace UX =====
  secureRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 6,
  },
  secureText: { fontSize: 11, color: colors.text.muted },
  advancedToggle: {
    marginTop: spacing.md,
    paddingVertical: 6,
    alignItems: "center",
  },
  advancedToggleText: { color: colors.text.secondary, fontSize: 12, fontWeight: "600" },
  advancedPanel: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
  },
  secondaryBtn: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: colors.brand.primary,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  secondaryText: { color: colors.brand.primary, fontWeight: "800", fontSize: 13 },
});
