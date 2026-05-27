/** Vista detalle pública de una reta + Pago / Lista de Espera. */
import React, { useCallback, useEffect, useState } from "react";
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
import { ArrowLeft, Calendar, MapPin, Trophy, DollarSign, Users, Clock, BarChart2 } from "lucide-react-native";

import { api, Reta } from "@/src/api";
import { TrafficLight } from "@/src/components/TrafficLight";
import { Button } from "@/src/components/Button";
import { Input } from "@/src/components/Input";
import { colors, radii, spacing, typography } from "@/src/theme";

export default function RetaDetailScreen() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [reta, setReta] = useState<Reta | null>(null);
  const [loading, setLoading] = useState(true);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const r = await api.getRetaBySlug(slug);
      setReta(r);
    } catch (e) {
      Alert.alert("Error", "No se pudo cargar la reta");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAction = async () => {
    if (!reta) return;
    if (!nombre.trim() || !telefono.trim()) {
      Alert.alert("Datos incompletos", "Ingresa tu nombre y teléfono");
      return;
    }
    setSubmitting(true);
    try {
      if (reta.semaforo === "ROJO") {
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
        const insc = await api.checkout(reta.id, {
          reta_id: reta.id,
          nombre: nombre.trim(),
          telefono: telefono.trim(),
        });
        // Simulamos confirmación de pago inmediata para demo (mock).
        await api.paymentWebhook(insc.id, "approved");
        Alert.alert("¡Inscripción confirmada!", "Tu lugar está asegurado. Nos vemos en cancha.");
      }
      setNombre("");
      setTelefono("");
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
                : "Tu lugar se bloquea por 5 minutos mientras procesamos tu pago."}
            </Text>

            <Input
              label="Nombre completo"
              placeholder="Ej. Andrés Sánchez"
              value={nombre}
              onChangeText={setNombre}
              autoCapitalize="words"
              testID="checkout-nombre-input"
            />
            <Input
              label="Teléfono (WhatsApp)"
              placeholder="+5215512345678"
              value={telefono}
              onChangeText={setTelefono}
              keyboardType="phone-pad"
              testID="checkout-telefono-input"
            />            <Button
              title={lleno ? "Unirse a Lista de Espera" : `Pagar $${reta.costo_inscripcion} e Inscribirme`}
              onPress={handleAction}
              variant={lleno ? "danger" : "primary"}
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
