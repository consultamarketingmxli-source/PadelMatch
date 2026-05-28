/**
 * Panel admin de NOTIFICACIONES (Action Item #2).
 *
 * Permite al organizador disparar 3 broadcasts WhatsApp manualmente:
 *   1. Recordatorio general (2h antes) — a TODOS los inscritos aprobados.
 *   2. Aviso de próximo partido — a los jugadores de una RONDA específica
 *      (con opcional cancha). Pareja-aware: para retas de parejas usa los dúos.
 *   3. Aviso a lista de espera — link público a la reta.
 *
 * Mensajes y disparo síncrono via Twilio (mockeado si no hay credenciales).
 * El bot Sandbox de Twilio requiere que el receptor envíe "join {code}" al
 * número de WhatsApp antes de recibir cualquier mensaje. En caso de fallo
 * 63015 (sandbox no joineado) lo reportamos en el detalle.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Hourglass,
  MessageCircle,
  Send,
  Users,
  XCircle,
} from "lucide-react-native";

import { Reta, api } from "@/src/api";
import { Button } from "@/src/components/Button";
import { colors, radii, spacing, typography } from "@/src/theme";

type NotifyResult = {
  sent: number;
  mocked: number;
  failed: number;
  skipped?: number;
  total_targets: number;
  configured: boolean;
  partidos_procesados?: number;
  items: {
    nombre?: string;
    telefono?: string;
    status: string;
    needs_sandbox_join?: boolean;
    cancha?: number;
    ronda?: number;
    partido?: number;
  }[];
};

export default function AdminNotificaciones() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const retaId = id ?? "";

  const [reta, setReta] = useState<Reta | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ronda, setRonda] = useState(1);
  const [cancha, setCancha] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<{
    label: string;
    payload: NotifyResult;
  } | null>(null);

  const load = useCallback(async () => {
    if (!retaId) return;
    try {
      const r = await api.getReta(retaId);
      setReta(r);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo cargar la reta");
    } finally {
      setLoading(false);
    }
  }, [retaId]);

  useEffect(() => { void load(); }, [load]);

  // Rondas/canchas elegibles desde la config de la reta.
  const totalRondas = reta?.num_rondas ?? 7;
  const totalCanchas = reta?.canchas_disponibles ?? 1;
  const rondaOptions = useMemo(
    () => Array.from({ length: totalRondas }, (_, i) => i + 1),
    [totalRondas],
  );
  const canchaOptions = useMemo(
    () => Array.from({ length: totalCanchas }, (_, i) => i + 1),
    [totalCanchas],
  );

  // Indicador sin necesidad de fetch: Twilio se considera "configured" cuando
  // el último broadcast lo reportó. Por defecto asumimos "desconocido" hasta
  // el primer dispatch.
  const twilioConfigured = lastResult?.payload.configured;

  const runBroadcast = async (
    label: string, fn: () => Promise<NotifyResult>,
    confirmMsg: string,
  ) => {
    if (!retaId || busy) return;
    if (Platform.OS === "web") {
      if (!window.confirm(confirmMsg)) return;
    } else {
      const ok = await new Promise<boolean>((resolve) => {
        Alert.alert("Confirmar broadcast", confirmMsg, [
          { text: "Cancelar", style: "cancel", onPress: () => resolve(false) },
          { text: "Enviar", style: "default", onPress: () => resolve(true) },
        ]);
      });
      if (!ok) return;
    }
    setBusy(true);
    setLastResult(null);
    try {
      const r = await fn();
      setLastResult({ label, payload: r });
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo enviar el broadcast");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !reta) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.brand.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="notify-back">
          <ArrowLeft size={18} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Notificaciones WhatsApp</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Indicador de Twilio configurado */}
        {twilioConfigured === false ? (
          <View style={styles.warnBox} testID="twilio-mock-banner">
            <AlertTriangle size={14} color={colors.status.amber} />
            <Text style={styles.warnText}>
              Twilio NO está configurado o WHATSAPP_FORCE_MOCK=true. Los mensajes
              se simulan (no salen a destinatarios reales).
            </Text>
          </View>
        ) : null}

        {/* === 1. Recordatorio general === */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Hourglass size={16} color={colors.brand.primary} />
            <Text style={styles.cardTitle}>Recordatorio 2h antes</Text>
          </View>
          <Text style={styles.cardHint}>
            Envía un mensaje genérico a TODOS los inscritos aprobados, con la
            hora del evento y notas del organizador.
          </Text>
          <Button
            title="Enviar recordatorio general"
            onPress={() => void runBroadcast(
              "Recordatorio general",
              () => api.notifyRecordatorioGeneral(retaId),
              "¿Mandar WhatsApp recordatorio a TODOS los inscritos aprobados?",
            )}
            variant="primary"
            icon={<Send size={14} color={"#fff"} />}
            loading={busy}
            testID="notify-recordatorio-btn"
          />
        </View>

        {/* === 2. Aviso por ronda === */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MessageCircle size={16} color={colors.brand.primary} />
            <Text style={styles.cardTitle}>&quot;Te toca AHORA&quot; por ronda</Text>
          </View>
          <Text style={styles.cardHint}>
            Selecciona la ronda y opcionalmente la cancha. Cada jugador
            recibirá su cancha, compañero y rivales.
          </Text>

          <Text style={styles.miniLabel}>Ronda</Text>
          <View style={styles.chipRow}>
            {rondaOptions.map((r) => (
              <Pressable
                key={r}
                onPress={() => setRonda(r)}
                style={({ pressed }) => [
                  styles.chip,
                  ronda === r && styles.chipActive,
                  pressed && { opacity: 0.85 },
                ]}
                testID={`ronda-chip-${r}`}
              >
                <Text style={[styles.chipText, ronda === r && styles.chipTextActive]}>R{r}</Text>
              </Pressable>
            ))}
          </View>

          {canchaOptions.length > 1 ? (
            <>
              <Text style={styles.miniLabel}>Cancha (opcional)</Text>
              <View style={styles.chipRow}>
                <Pressable
                  onPress={() => setCancha(null)}
                  style={({ pressed }) => [
                    styles.chip,
                    cancha === null && styles.chipActive,
                    pressed && { opacity: 0.85 },
                  ]}
                  testID="cancha-chip-all"
                >
                  <Text style={[styles.chipText, cancha === null && styles.chipTextActive]}>Todas</Text>
                </Pressable>
                {canchaOptions.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setCancha(c)}
                    style={({ pressed }) => [
                      styles.chip,
                      cancha === c && styles.chipActive,
                      pressed && { opacity: 0.85 },
                    ]}
                    testID={`cancha-chip-${c}`}
                  >
                    <Text style={[styles.chipText, cancha === c && styles.chipTextActive]}>C{c}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <Button
            title={`Enviar aviso ronda ${ronda}${cancha != null ? ` · cancha ${cancha}` : ""}`}
            onPress={() => void runBroadcast(
              `Próximo partido (R${ronda}${cancha != null ? `·C${cancha}` : ""})`,
              () => api.notifyProximoPartido(retaId, ronda, cancha ?? undefined),
              `¿Avisar a los jugadores de la ronda ${ronda}${cancha != null ? ` (cancha ${cancha})` : ""}?`,
            )}
            variant="primary"
            icon={<Send size={14} color={"#fff"} />}
            loading={busy}
            testID="notify-proximo-btn"
          />
        </View>

        {/* === 3. Lista de espera === */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Users size={16} color={colors.brand.primary} />
            <Text style={styles.cardTitle}>Avisar lista de espera</Text>
          </View>
          <Text style={styles.cardHint}>
            Manda link público de la reta a TODOS los inscritos en lista de
            espera (no aprobados todavía).
          </Text>
          <Button
            title="Enviar link a lista de espera"
            onPress={() => void runBroadcast(
              "Lista de espera",
              () => api.notifyListaEspera(retaId),
              "¿Mandar WhatsApp con el link público a la lista de espera?",
            )}
            variant="secondary"
            icon={<Send size={14} color={colors.brand.primary} />}
            loading={busy}
            testID="notify-waitlist-btn"
          />
        </View>

        {/* === Resultado del último broadcast === */}
        {lastResult ? (
          <View style={styles.resultCard} testID="notify-last-result">
            <Text style={styles.resultTitle}>{lastResult.label}</Text>
            <View style={styles.resultStats}>
              <StatPill
                color={colors.status.green}
                icon={<CheckCircle2 size={12} color={colors.status.green} />}
                label="Enviados"
                value={lastResult.payload.sent}
              />
              <StatPill
                color={colors.text.tertiary}
                icon={<MessageCircle size={12} color={colors.text.tertiary} />}
                label="Mock"
                value={lastResult.payload.mocked}
              />
              <StatPill
                color={colors.status.red}
                icon={<XCircle size={12} color={colors.status.red} />}
                label="Fallidos"
                value={lastResult.payload.failed}
              />
              {typeof lastResult.payload.skipped === "number" ? (
                <StatPill
                  color={colors.status.amber}
                  icon={<AlertTriangle size={12} color={colors.status.amber} />}
                  label="Sin tel."
                  value={lastResult.payload.skipped}
                />
              ) : null}
            </View>
            <Text style={styles.resultMeta}>
              {lastResult.payload.total_targets} destinatarios · Twilio{" "}
              {lastResult.payload.configured ? "configurado" : "MOCK"}
              {lastResult.payload.partidos_procesados != null
                ? ` · ${lastResult.payload.partidos_procesados} partidos`
                : ""}
            </Text>

            {/* Lista detalle (max 20). */}
            <FlatList
              data={lastResult.payload.items.slice(0, 20)}
              keyExtractor={(_, i) => String(i)}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
              renderItem={({ item }) => (
                <View style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{item.nombre ?? "—"}</Text>
                    <Text style={styles.itemMeta}>
                      {item.telefono ?? "(sin teléfono)"}
                      {item.cancha != null ? ` · C${item.cancha}·R${item.ronda}` : ""}
                    </Text>
                    {item.needs_sandbox_join ? (
                      <Text style={styles.itemHint}>Debe enviar &quot;join&quot; al sandbox de Twilio.</Text>
                    ) : null}
                  </View>
                  <StatusBadge status={item.status} />
                </View>
              )}
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatPill({ color, icon, label, value }: { color: string; icon: React.ReactNode; label: string; value: number }) {
  return (
    <View style={[styles.pill, { borderColor: color + "40", backgroundColor: color + "10" }]}>
      {icon}
      <Text style={[styles.pillLabel, { color }]}>
        {value} {label}
      </Text>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "sent") {
    return (
      <View style={[styles.badge, { backgroundColor: colors.status.green + "15", borderColor: colors.status.green + "40" }]}>
        <Text style={[styles.badgeTxt, { color: colors.status.green }]}>Enviado</Text>
      </View>
    );
  }
  if (status === "mocked") {
    return (
      <View style={[styles.badge, { backgroundColor: colors.bg.app, borderColor: colors.border.default }]}>
        <Text style={[styles.badgeTxt, { color: colors.text.secondary }]}>MOCK</Text>
      </View>
    );
  }
  if (status === "skipped_no_phone") {
    return (
      <View style={[styles.badge, { backgroundColor: colors.status.amber + "15", borderColor: colors.status.amber + "40" }]}>
        <Text style={[styles.badgeTxt, { color: colors.status.amber }]}>Sin tel.</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, { backgroundColor: colors.status.red + "15", borderColor: colors.status.red + "40" }]}>
      <Text style={[styles.badgeTxt, { color: colors.status.red }]}>Falló</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.default,
    alignItems: "center", justifyContent: "center",
  },
  title: { ...typography.h2, color: colors.text.primary, fontSize: 17 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },

  warnBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: spacing.sm + 2, borderRadius: radii.md,
    backgroundColor: colors.status.amber + "10",
    borderWidth: 1, borderColor: colors.status.amber + "40",
  },
  warnText: { color: colors.text.primary, fontSize: 12, flex: 1, lineHeight: 16 },

  card: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.border.default,
    padding: spacing.md,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  cardTitle: { ...typography.h3, color: colors.text.primary, fontSize: 15 },
  cardHint: { color: colors.text.secondary, fontSize: 12, marginBottom: spacing.md, lineHeight: 16 },

  miniLabel: { ...typography.label, color: colors.text.secondary, fontSize: 10, marginBottom: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radii.sm, borderWidth: 1,
    borderColor: colors.border.default, backgroundColor: colors.bg.app,
    minWidth: 44, alignItems: "center",
  },
  chipActive: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  chipText: { color: colors.text.primary, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#fff" },

  resultCard: {
    backgroundColor: colors.bg.card,
    borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.brand.primaryBorder,
    padding: spacing.md,
  },
  resultTitle: { ...typography.h3, color: colors.brand.primary, fontSize: 14, marginBottom: 8 },
  resultStats: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 6 },
  resultMeta: { color: colors.text.secondary, fontSize: 11, marginBottom: spacing.sm },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radii.sm, borderWidth: 1,
  },
  pillLabel: { fontSize: 11, fontWeight: "700" },
  sep: { height: 1, backgroundColor: colors.border.default, opacity: 0.4 },
  itemRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 8 },
  itemName: { color: colors.text.primary, fontSize: 13, fontWeight: "600" },
  itemMeta: { color: colors.text.secondary, fontSize: 11, marginTop: 1 },
  itemHint: { color: colors.status.amber, fontSize: 10, marginTop: 2, fontStyle: "italic" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.sm, borderWidth: 1 },
  badgeTxt: { fontSize: 10, fontWeight: "800" },
});
