/** Vista detalle pública de una reta + Pago (individual / dúo / free-agent). */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
  ArrowLeft, Calendar, MapPin, Trophy, DollarSign, Users, Clock, BarChart2,
  UserPlus, Search,
} from "lucide-react-native";

import { api, Reta } from "@/src/api";
import { TrafficLight } from "@/src/components/TrafficLight";
import { Button } from "@/src/components/Button";
import { Input } from "@/src/components/Input";
import { buildPagoReturnUrl } from "@/src/utils/deepLink";
import { colors, radii, spacing, typography } from "@/src/theme";

export default function RetaDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug: string; pago?: string; session_id?: string; inscripcion?: string; provider?: string }>();
  const { slug } = params;
  const [reta, setReta] = useState<Reta | null>(null);
  const [loading, setLoading] = useState(true);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [parejaNombre, setParejaNombre] = useState("");
  const [parejaTelefono, setParejaTelefono] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verifyingPago, setVerifyingPago] = useState(false);
  const [regMode, setRegMode] = useState("solo"); // "solo" | "duo" | "free_agent"

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const r = await api.getRetaBySlug(slug);
      setReta(r);
      // Auto-seleccionar modo "duo" si la reta es de parejas (UX por defecto).
      const m = r.modalidad_registro ?? "individual";
      if (m === "parejas_libres" || m === "parejas_mixtas") {
        setRegMode("duo");
      } else {
        setRegMode("solo");
      }
    } catch (e) {
      Alert.alert("Error", "No se pudo cargar la reta");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Manejo de retorno desde Mercado Pago / Stripe: poll del status hasta confirmación.
  useEffect(() => {
    if (params.pago === "cancelado") {
      Alert.alert("Pago cancelado", "No se realizó el cobro. Tu lugar quedó liberado.");
      return;
    }
    if (params.pago !== "ok" || !params.inscripcion) return;
    let cancelled = false;
    let intentos = 0;
    setVerifyingPago(true);
    const isMp = params.provider === "mp";
    const poll = async () => {
      try {
        while (!cancelled && intentos < 15) {
          intentos++;
          const s = isMp
            ? await api.mpPaymentStatus(params.inscripcion as string)
            : await api.paymentStatus(params.inscripcion as string);
          if (s.estatus_pago === "Aprobado") {
            if (!cancelled) {
              Alert.alert("¡Inscripción confirmada!", "Tu pago se procesó correctamente. Nos vemos en cancha.");
              await load();
            }
            return;
          }
          if (s.estatus_pago === "Cancelado" || s.estatus_pago === "Expirado") {
            if (!cancelled) {
              Alert.alert("Pago no confirmado", "No pudimos validar tu pago. Inténtalo de nuevo.");
            }
            return;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch {
        // silencioso
      } finally {
        if (!cancelled) setVerifyingPago(false);
      }
    };
    void poll();
    return () => { cancelled = true; };
  }, [params.pago, params.inscripcion, params.provider, load]);

  // Modalidad de la reta (memoizada para condicionales UI).
  const modalidad = reta?.modalidad_registro ?? "individual";
  const esRetaParejas = modalidad !== "individual";
  const permiteIndiv = !!reta?.permitir_individual_en_parejas;

  // Costo total estimado a mostrar en el CTA según modo.
  const costoTotal = useMemo(() => {
    if (!reta) return 0;
    return regMode === "duo" ? reta.costo_inscripcion * 2 : reta.costo_inscripcion;
  }, [reta, regMode]);

  // Cupos requeridos según modo — informativo (no se usa en validación directa).
  // const cuposRequeridos = regMode === "duo" ? 2 : 1;

  const handleAction = async () => {
    if (!reta) return;
    if (!nombre.trim() || !telefono.trim()) {
      Alert.alert("Datos incompletos", "Ingresa tu nombre y teléfono");
      return;
    }
    // Validaciones específicas para dúo.
    if (regMode === "duo") {
      if (!parejaNombre.trim() || !parejaTelefono.trim()) {
        Alert.alert("Falta tu pareja", "Ingresa el nombre y teléfono de tu pareja.");
        return;
      }
      if (telefono.trim() === parejaTelefono.trim()) {
        Alert.alert("Teléfonos iguales", "Tu teléfono y el de tu pareja no pueden ser iguales.");
        return;
      }
    }
    setSubmitting(true);
    try {
      if (reta.semaforo === "ROJO") {
        // En lista de espera no soportamos dúo atómico (sumamos solo al jugador principal).
        const wl = await api.joinWaitlist(reta.id, {
          reta_id: reta.id,
          nombre: nombre.trim(),
          telefono: telefono.trim(),
        });
        Alert.alert(
          "Listo",
          `Estás en la lista de espera en posición #${wl.posicion_fila}. Te notificaremos por WhatsApp en cuanto se libere un cupo.`,
        );
      } else {
        const successUrl = buildPagoReturnUrl("exito", { provider: "mp", reta_slug: slug });
        const cancelUrl = buildPagoReturnUrl("fallo", { provider: "mp", reta_slug: slug });

        // Construcción del body con los campos pareja-aware (solo si aplica).
        const checkoutBody: any = {
          nombre: nombre.trim(),
          telefono: telefono.trim(),
          success_url: `${successUrl}${successUrl.includes("?") ? "&" : "?"}inscripcion_id=`,
          cancel_url: cancelUrl,
        };
        if (regMode === "duo") {
          checkoutBody.pareja_nombre = parejaNombre.trim();
          checkoutBody.pareja_telefono = parejaTelefono.trim();
        } else if (regMode === "free_agent") {
          checkoutBody.es_free_agent = true;
        }

        const mpSession = await api.checkoutMercadoPago(reta.id, checkoutBody);
        const url = mpSession.init_point;
        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.location.href = url;
          return;
        } else {
          const Linking = require("expo-linking");
          await Linking.openURL(url);
          Alert.alert(
            "Pago en proceso",
            regMode === "duo"
              ? "Termina el pago en Mercado Pago. Al volver, los DOS lugares quedarán confirmados automáticamente."
              : "Termina el pago en Mercado Pago. Al volver, tu lugar quedará confirmado automáticamente.",
          );
          let intentos = 0;
          const tick = async () => {
            intentos++;
            try {
              const s = await api.mpPaymentStatus(mpSession.inscripcion_id);
              if (s.estatus_pago === "Aprobado") {
                Alert.alert("¡Inscripción confirmada!", "Tu pago se procesó correctamente.");
                await load();
                return;
              }
              if (s.estatus_pago === "Cancelado") return;
              if (intentos < 30) setTimeout(tick, 3000);
            } catch { /* silencioso */ }
          };
          setTimeout(tick, 5000);
        }
      }
      setNombre("");
      setTelefono("");
      setParejaNombre("");
      setParejaTelefono("");
      await load();
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo procesar");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !reta) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const fecha = new Date(reta.fecha_evento);
  const fechaStr = fecha.toLocaleDateString("es-MX", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const horaStr = fecha.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  const lleno = reta.semaforo === "ROJO";

  // Texto del CTA (botón de pago) según modo.
  const ctaText = lleno
    ? "Unirse a Lista de Espera"
    : regMode === "duo"
      ? `Pagar $${costoTotal} (2 lugares) e Inscribir Pareja`
      : `Pagar $${costoTotal} e Inscribirme`;

  // Etiqueta de la modalidad de inscripción para chip informativo.
  const modalidadLabel = modalidad === "parejas_mixtas"
    ? "Parejas mixtas"
    : modalidad === "parejas_libres" ? "Parejas" : "Individual";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} testID="back-btn" style={styles.iconBtn}>
              <ArrowLeft size={18} color={colors.text.primary} />
            </TouchableOpacity>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <TouchableOpacity
                onPress={() => router.push(`/retas/tabla/${reta.id}` as any)}
                style={styles.iconBtn}
                testID="ver-tabla-btn"
              >
                <BarChart2 size={18} color={colors.brand.primary} />
              </TouchableOpacity>
              <TrafficLight status={reta.semaforo} capacidadPct={reta.capacidad_pct} />
            </View>
          </View>

          <View style={styles.heroRow}>
            <View style={styles.logoBox}>
              {reta.organizador_logo_url ? (
                <Image source={{ uri: reta.organizador_logo_url }} style={styles.logo} />
              ) : (
                <Text style={styles.logoFallback}>PR</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hero} numberOfLines={2}>{reta.nombre}</Text>
              <View style={styles.metaRow}>
                <MapPin size={12} color={colors.text.secondary} />
                <Text style={styles.clubText}>{reta.club}</Text>
              </View>
              {/* Chip de modalidad — visible solo si es reta de parejas. */}
              {esRetaParejas ? (
                <View style={styles.modalidadChip} testID="modalidad-chip">
                  <Users size={11} color={colors.brand.primary} />
                  <Text style={styles.modalidadChipText}>{modalidadLabel}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {reta.observaciones_publicas ? (
            <View style={styles.obsBox} testID="observaciones-box">
              <Text style={styles.obsLabel}>NOTA DEL ORGANIZADOR</Text>
              <Text style={styles.obsText}>{reta.observaciones_publicas}</Text>
            </View>
          ) : null}

          <View style={styles.statsGrid}>
            <StatBlock icon={<Calendar size={16} color={colors.brand.primary} />} label="Fecha" value={fechaStr} />
            <StatBlock icon={<Clock size={16} color={colors.brand.primary} />} label="Hora" value={horaStr} />
            <StatBlock icon={<Trophy size={16} color={colors.brand.primary} />} label="Modalidad" value={reta.modalidad_juego} />
            <StatBlock icon={<DollarSign size={16} color={colors.brand.primary} />} label="Costo" value={`$${reta.costo_inscripcion}`} />
            <StatBlock icon={<Users size={16} color={colors.brand.primary} />} label="Cupo" value={`${reta.inscritos_count}/${reta.max_jugadores}`} />
            <StatBlock icon={<Trophy size={16} color={colors.brand.primary} />} label="Rondas" value={String(reta.num_rondas)} />
          </View>

          <View style={styles.formCard}>
            <Text style={styles.formTitle}>
              {lleno ? "Únete a la lista de espera" : "Asegura tu lugar"}
            </Text>
            <Text style={styles.formSubtitle}>
              {lleno
                ? "Te notificaremos por WhatsApp cuando se libere un cupo (5 min para confirmar)."
                : regMode === "duo"
                  ? "Reservamos 2 lugares atómicamente. Tu pareja queda inscrita con el mismo pago."
                  : "Tu lugar se bloquea por 5 minutos mientras procesamos tu pago."}
            </Text>

            {/* Selector ¿Solo o con pareja? — visible solo si la reta es de parejas y no está llena. */}
            {esRetaParejas && !lleno ? (
              <View style={styles.modeSelector} testID="reg-mode-selector">
                <ModeChip
                  active={regMode === "duo"}
                  onPress={() => setRegMode("duo")}
                  icon={<UserPlus size={14} color={regMode === "duo" ? "#fff" : colors.text.primary} />}
                  label="Con mi pareja"
                  testID="mode-duo"
                />
                {permiteIndiv ? (
                  <ModeChip
                    active={regMode === "free_agent"}
                    onPress={() => setRegMode("free_agent")}
                    icon={<Search size={14} color={regMode === "free_agent" ? "#fff" : colors.text.primary} />}
                    label="Busco pareja"
                    testID="mode-free-agent"
                  />
                ) : null}
              </View>
            ) : null}

            {/* Info contextual para modo busco-pareja. */}
            {regMode === "free_agent" ? (
              <View style={styles.infoFreeAgent}>
                <Text style={styles.infoFreeAgentText}>
                  Te inscribirás como “free-agent”. El organizador te emparejará
                  manualmente con otro jugador antes de que arranque la reta.
                </Text>
              </View>
            ) : null}

            <Input
              label="Tu nombre completo"
              placeholder="Ej. Andrés Sánchez"
              value={nombre}
              onChangeText={setNombre}
              autoCapitalize="words"
              testID="checkout-nombre-input"
            />
            <Input
              label="Tu teléfono (WhatsApp)"
              placeholder="+5215512345678"
              value={telefono}
              onChangeText={setTelefono}
              keyboardType="phone-pad"
              testID="checkout-telefono-input"
            />

            {/* Inputs dinámicos solo si modo dúo. */}
            {regMode === "duo" && !lleno ? (
              <View style={styles.duoBox} testID="duo-fields">
                <View style={styles.duoHeader}>
                  <UserPlus size={14} color={colors.brand.primary} />
                  <Text style={styles.duoHeaderText}>Datos de tu pareja</Text>
                </View>
                <Input
                  label="Nombre completo de tu pareja"
                  placeholder="Ej. Sofía Ramírez"
                  value={parejaNombre}
                  onChangeText={setParejaNombre}
                  autoCapitalize="words"
                  testID="checkout-pareja-nombre-input"
                />
                <Input
                  label="Teléfono de tu pareja (WhatsApp)"
                  placeholder="+5215587654321"
                  value={parejaTelefono}
                  onChangeText={setParejaTelefono}
                  keyboardType="phone-pad"
                  testID="checkout-pareja-telefono-input"
                />
                <Text style={styles.duoHint}>
                  Reservamos 2 cupos y cobramos {`$${reta.costo_inscripcion} x 2 = $${reta.costo_inscripcion * 2}`} en un solo pago.
                </Text>
              </View>
            ) : null}

            <Button
              title={ctaText}
              onPress={handleAction}
              variant={lleno ? "danger" : "primary"}
              size="lg"
              brandIcon
              loading={submitting}
              testID={lleno ? "waitlist-btn" : "pay-button"}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StatBlock({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.statBlock}>
      <View style={styles.statHead}>{icon}<Text style={styles.statLabel}>{label}</Text></View>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function ModeChip({
  active, onPress, icon, label, testID,
}: { active: boolean; onPress: () => void; icon: React.ReactNode; label: string; testID?: string }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.modeChip, active && styles.modeChipActive]}
      testID={testID}
      activeOpacity={0.85}
    >
      {icon}
      <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
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
  heroRow: { flexDirection: "row", gap: spacing.md, alignItems: "center", marginBottom: spacing.lg },
  logoBox: {
    width: 64, height: 64, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.brand.primaryBorder,
    backgroundColor: colors.brand.primarySoft,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  logo: { width: 64, height: 64 },
  logoFallback: { color: colors.brand.primary, fontWeight: "900", fontSize: 16 },
  hero: { ...typography.h1, color: colors.text.primary, fontSize: 26 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  clubText: { color: colors.text.secondary, fontSize: 13 },
  modalidadChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
    backgroundColor: colors.brand.primarySoft,
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
    marginTop: 6,
  },
  modalidadChipText: {
    color: colors.brand.primary,
    fontWeight: "700",
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  obsBox: {
    borderWidth: 1, borderColor: colors.brand.primaryBorder,
    backgroundColor: colors.brand.primarySoft,
    borderRadius: radii.md, padding: spacing.md,
    borderStyle: "dashed", marginBottom: spacing.lg,
  },
  obsLabel: { ...typography.label, color: colors.brand.primary, fontSize: 10, marginBottom: 6 },
  obsText: { color: colors.text.primary, lineHeight: 20 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  statBlock: {
    flexBasis: "48%", flexGrow: 1,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md, padding: spacing.md,
  },
  statHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  statLabel: { ...typography.label, color: colors.text.secondary, fontSize: 10 },
  statValue: { color: colors.text.primary, fontWeight: "700", fontSize: 15 },
  formCard: {
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.lg, padding: spacing.lg,
  },
  formTitle: { ...typography.h3, color: colors.text.primary, marginBottom: 4 },
  formSubtitle: { color: colors.text.secondary, fontSize: 13, marginBottom: spacing.md, lineHeight: 18 },
  // Selector dúo / free-agent.
  modeSelector: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
    flexWrap: "wrap",
  },
  modeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.app,
    minHeight: 44,
  },
  modeChipActive: {
    backgroundColor: colors.brand.primary,
    borderColor: colors.brand.primary,
  },
  modeChipText: { color: colors.text.primary, fontWeight: "600", fontSize: 13 },
  modeChipTextActive: { color: "#fff" },
  // Free-agent informativo.
  infoFreeAgent: {
    borderWidth: 1,
    borderColor: colors.border.default,
    borderStyle: "dashed",
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.bg.app,
  },
  infoFreeAgentText: { color: colors.text.secondary, fontSize: 12, lineHeight: 17 },
  // Bloque de inputs de pareja.
  duoBox: {
    marginTop: 6,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
  },
  duoHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: spacing.sm,
  },
  duoHeaderText: {
    ...typography.label,
    color: colors.brand.primary,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  duoHint: {
    color: colors.text.secondary,
    fontSize: 12,
    fontStyle: "italic",
    marginTop: -4,
    marginBottom: spacing.sm,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
