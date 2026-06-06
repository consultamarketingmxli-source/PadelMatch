/**
 * Admin → Marketing & Premios (Cupones).
 *
 * Permite al organizador emitir, listar y administrar cupones 100% gratis
 * para fidelizar a sus jugadores clave.
 *
 * Features:
 *   • Generador en 1 clic: input nombre (opcional) o "Generar Código Al Azar".
 *   • Selector opcional de reta exclusiva (default: libre).
 *   • Compartir por WhatsApp con deep link automatizado.
 *   • Lista de cupones emitidos (disponibles + usados).
 *   • Borrar (solo si no usado) o reactivar (recovery).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Dice5,
  Gift,
  RotateCcw,
  Tag,
  Trash2,
  XCircle,
} from "lucide-react-native";

import { Cupon, Reta, api } from "@/src/api";
import { Input } from "@/src/components/Input";
import { HeroBanner } from "@/src/components/brand/HeroBanner";
import { CTAButton } from "@/src/components/brand/CTAButton";
import { colors, radii, shadows, spacing, typography } from "@/src/theme";

export default function AdminMarketing() {
  const router = useRouter();
  const { reta_id: paramRetaId } = useLocalSearchParams<{ reta_id?: string }>();

  const [cupones, setCupones] = useState<Cupon[]>([]);
  const [retas, setRetas] = useState<Reta[]>([]);
  const [selectedRetaId, setSelectedRetaId] = useState<string | undefined>(
    paramRetaId || undefined,
  );

  const [codigoInput, setCodigoInput] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cs, rs] = await Promise.all([
        api.listarCupones(),
        api.listRetasAdmin(),
      ]);
      setCupones(cs);
      setRetas(rs);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo cargar el panel");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Cuenta cupones disponibles / usados (badges del header).
  const stats = useMemo(() => {
    const disponibles = cupones.filter((c) => !c.usado).length;
    const usados = cupones.filter((c) => c.usado).length;
    return { disponibles, usados, total: cupones.length };
  }, [cupones]);

  const handleCreate = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const body: any = {};
      if (codigoInput.trim()) body.codigo = codigoInput.trim().toUpperCase();
      if (descripcion.trim()) body.descripcion = descripcion.trim();
      if (selectedRetaId) body.reta_id_exclusivo = selectedRetaId;
      const cupon = await api.crearCupon(body);
      setCupones((prev) => [cupon, ...prev]);
      setCodigoInput("");
      setDescripcion("");
      Alert.alert("✅ Cupón creado", `Código: ${cupon.codigo}\n¡Comparte por WhatsApp desde la tarjeta!`);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo crear el cupón");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerateRandom = () => {
    setCodigoInput("");  // backend autogenera si vacío
    void handleCreate();
  };

  const buildShareText = (cupon: Cupon) => {
    const reta = cupon.reta_id_exclusivo
      ? retas.find((r) => r.id === cupon.reta_id_exclusivo)
      : null;
    const slug = reta?.url_slug;
    // Reconstruimos URL pública desde el origen actual cuando estamos en web.
    let baseUrl = "";
    if (Platform.OS === "web" && typeof window !== "undefined") {
      baseUrl = window.location.origin;
    }
    const link = slug ? `${baseUrl}/retas/${slug}` : `${baseUrl}/retas`;
    return `¡Felicidades! 🎾 Has sido premiado con una reta gratis.\n\nCanjea tu código *${cupon.codigo}* aquí: ${link}`;
  };

  const handleShareWhatsApp = async (cupon: Cupon) => {
    const text = buildShareText(cupon);
    const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
    try {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.open(wa, "_blank");
      } else {
        await Linking.openURL(wa);
      }
    } catch {
      Alert.alert("WhatsApp", "No se pudo abrir WhatsApp. Copia el texto manualmente.");
    }
  };

  const handleCopyCode = async (cupon: Cupon) => {
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(cupon.codigo);
        Alert.alert("Copiado", `Código ${cupon.codigo} copiado al portapapeles.`);
        return;
      }
      // Fallback nativo: lazy import.
      const Clipboard = await import("expo-clipboard").catch(() => null as any);
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(cupon.codigo);
        Alert.alert("Copiado", `Código ${cupon.codigo} copiado.`);
      }
    } catch {
      // silencioso
    }
  };

  const handleDelete = (cupon: Cupon) => {
    const fn = async () => {
      try {
        await api.borrarCupon(cupon.id);
        setCupones((prev) => prev.filter((c) => c.id !== cupon.id));
      } catch (e: any) {
        Alert.alert("Error", e.message ?? "No se pudo borrar");
      }
    };
    if (Platform.OS === "web") {
      if (window.confirm(`¿Borrar cupón ${cupon.codigo}? No se puede deshacer.`)) void fn();
    } else {
      Alert.alert("Borrar cupón", `¿Borrar ${cupon.codigo}? No se puede deshacer.`, [
        { text: "Cancelar", style: "cancel" },
        { text: "Borrar", style: "destructive", onPress: fn },
      ]);
    }
  };

  const handleReactivate = async (cupon: Cupon) => {
    try {
      const updated = await api.reactivarCupon(cupon.id);
      setCupones((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      Alert.alert("Reactivado", `${cupon.codigo} vuelve a estar disponible.`);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo reactivar");
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={colors.brand.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="marketing-back">
          <ArrowLeft size={18} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Marketing & Premios</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.primary} />}
      >
        <HeroBanner
          eyebrow="PADELAPPRETAS · ADMIN"
          title="Marketing & Premios"
          subtitle={`${stats.disponibles} disponibles · ${stats.usados} redimidos · ${stats.total} emitidos`}
          height={172}
          style={{ marginBottom: spacing.lg }}
        />
        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.brand.primarySoft, borderColor: colors.brand.primaryBorder }]}>
            <Text style={[styles.statValue, { color: colors.brand.sapphire }]}>{stats.disponibles}</Text>
            <Text style={styles.statLabel}>Disponibles</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.usados}</Text>
            <Text style={styles.statLabel}>Redimidos</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.total}</Text>
            <Text style={styles.statLabel}>Total emitidos</Text>
          </View>
        </View>

        {/* === Generador === */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Gift size={16} color={colors.brand.primary} />
            <Text style={styles.cardTitle}>Generar cupón</Text>
          </View>
          <Text style={styles.cardHint}>
            Crea un código de reta gratis para fidelizar a un jugador clave. Si
            dejas el código vacío, generamos uno automáticamente.
          </Text>

          <Input
            label="Código (opcional)"
            placeholder="Ej. PROPLAYER100"
            value={codigoInput}
            onChangeText={(t) => setCodigoInput(t.toUpperCase())}
            autoCapitalize="characters"
            testID="cupon-codigo-input"
          />
          <Input
            label="Descripción interna (opcional)"
            placeholder="Ej. Premio Top 1 de Mayo"
            value={descripcion}
            onChangeText={setDescripcion}
            testID="cupon-desc-input"
          />

          {/* Selector reta exclusiva */}
          <Text style={styles.miniLabel}>Reta exclusiva (opcional)</Text>
          <View style={styles.chipRow}>
            <Pressable
              onPress={() => setSelectedRetaId(undefined)}
              style={({ pressed }) => [
                styles.chip,
                !selectedRetaId && styles.chipActive,
                pressed && { opacity: 0.85 },
              ]}
              testID="reta-chip-libre"
            >
              <Text style={[styles.chipText, !selectedRetaId && styles.chipTextActive]}>Libre (cualquier reta)</Text>
            </Pressable>
            {retas.slice(0, 6).map((r) => (
              <Pressable
                key={r.id}
                onPress={() => setSelectedRetaId(r.id)}
                style={({ pressed }) => [
                  styles.chip,
                  selectedRetaId === r.id && styles.chipActive,
                  pressed && { opacity: 0.85 },
                ]}
                testID={`reta-chip-${r.id}`}
              >
                <Text style={[styles.chipText, selectedRetaId === r.id && styles.chipTextActive]} numberOfLines={1}>
                  {r.nombre.length > 22 ? r.nombre.slice(0, 22) + "…" : r.nombre}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.actionsRow}>
            <CTAButton
              label="Generar Código Al Azar"
              onPress={handleGenerateRandom}
              variant="secondary"
              leading={<Dice5 size={14} color={colors.brand.azure} />}
              disabled={submitting}
              testID="cupon-random-btn"
              style={{ flex: 1 }}
            />
            <CTAButton
              label={codigoInput.trim() ? "Crear con código" : "Crear automático"}
              onPress={handleCreate}
              variant="primary"
              leading={<Tag size={14} color="#fff" />}
              loading={submitting}
              testID="cupon-create-btn"
              style={{ flex: 1 }}
            />
          </View>
        </View>

        {/* === Lista de cupones === */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Tag size={16} color={colors.brand.primary} />
            <Text style={styles.cardTitle}>Cupones emitidos</Text>
          </View>
          {cupones.length === 0 ? (
            <View style={styles.emptyMini} testID="cupones-empty">
              <Text style={styles.emptyMiniTxt}>
                Aún no has emitido cupones. Crea el primero arriba para premiar a un jugador.
              </Text>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {cupones.map((c) => (
                <CuponRow
                  key={c.id}
                  cupon={c}
                  retaNombre={retas.find((r) => r.id === c.reta_id_exclusivo)?.nombre}
                  onShare={() => handleShareWhatsApp(c)}
                  onCopy={() => handleCopyCode(c)}
                  onDelete={() => handleDelete(c)}
                  onReactivate={() => handleReactivate(c)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function CuponRow({
  cupon, retaNombre, onShare, onCopy, onDelete, onReactivate,
}: {
  cupon: Cupon;
  retaNombre?: string;
  onShare: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onReactivate: () => void;
}) {
  return (
    <View style={[styles.cuponCard, cupon.usado && styles.cuponCardUsed]} testID={`cupon-row-${cupon.id}`}>
      <View style={styles.cuponHead}>
        <View style={{ flex: 1 }}>
          <View style={styles.cuponCodigoRow}>
            <Text style={styles.cuponCodigo}>{cupon.codigo}</Text>
            {cupon.usado ? (
              <View style={[styles.badge, { backgroundColor: colors.text.tertiary + "15", borderColor: colors.text.tertiary + "40" }]}>
                <XCircle size={10} color={colors.text.tertiary} />
                <Text style={[styles.badgeTxt, { color: colors.text.tertiary }]}>Redimido</Text>
              </View>
            ) : (
              <View style={[styles.badge, { backgroundColor: colors.status.green + "15", borderColor: colors.status.green + "40" }]}>
                <CheckCircle2 size={10} color={colors.status.green} />
                <Text style={[styles.badgeTxt, { color: colors.status.green }]}>Disponible</Text>
              </View>
            )}
          </View>
          {cupon.descripcion ? <Text style={styles.cuponDesc}>{cupon.descripcion}</Text> : null}
          <Text style={styles.cuponMeta}>
            {retaNombre ? `Exclusivo: ${retaNombre}` : "Libre (cualquier reta)"}
          </Text>
          {cupon.usado && cupon.jugador_nombre_uso ? (
            <Text style={styles.cuponMetaUsed}>Redimido por {cupon.jugador_nombre_uso}</Text>
          ) : null}
        </View>
      </View>

      {/* Acciones */}
      <View style={styles.cuponActions}>
        {!cupon.usado ? (
          <>
            <Pressable
              onPress={onShare}
              style={({ pressed }) => [styles.actionMini, styles.actionPrimary, pressed && { opacity: 0.8 }]}
              testID={`cupon-share-${cupon.id}`}
            >
              <Text style={styles.actionMiniTxt}>📲 WhatsApp</Text>
            </Pressable>
            <Pressable
              onPress={onCopy}
              style={({ pressed }) => [styles.actionMini, pressed && { opacity: 0.8 }]}
              testID={`cupon-copy-${cupon.id}`}
            >
              <Copy size={11} color={colors.text.primary} />
              <Text style={styles.actionMiniTxtSec}>Copiar</Text>
            </Pressable>
            <Pressable
              onPress={onDelete}
              style={({ pressed }) => [styles.actionMini, styles.actionDanger, pressed && { opacity: 0.8 }]}
              testID={`cupon-delete-${cupon.id}`}
            >
              <Trash2 size={11} color={colors.status.red} />
              <Text style={[styles.actionMiniTxtSec, { color: colors.status.red }]}>Borrar</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={onReactivate}
            style={({ pressed }) => [styles.actionMini, pressed && { opacity: 0.8 }]}
            testID={`cupon-reactivate-${cupon.id}`}
          >
            <RotateCcw size={11} color={colors.brand.primary} />
            <Text style={[styles.actionMiniTxtSec, { color: colors.brand.primary }]}>Reactivar</Text>
          </Pressable>
        )}
      </View>
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
    borderWidth: 1, borderColor: colors.border.blueHairline,
    alignItems: "center", justifyContent: "center",
  },
  title: { ...typography.h2, color: colors.text.primary, fontSize: 17 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },

  statsRow: { flexDirection: "row", gap: spacing.sm },
  statCard: {
    flex: 1, backgroundColor: colors.bg.card,
    borderWidth: 1, borderColor: colors.border.blueHairline,
    borderRadius: radii.card, padding: spacing.md, alignItems: "center",
    ...(shadows.card as object),
  },
  statValue: {
    fontFamily: typography.monoBold.fontFamily,
    fontVariant: ["tabular-nums"],
    fontSize: 26,
    color: colors.brand.sapphire,
    letterSpacing: -0.6,
  },
  statLabel: { ...typography.label, color: colors.text.secondary, fontSize: 10, marginTop: 4 },

  card: {
    backgroundColor: colors.bg.card, borderRadius: radii.card,
    borderWidth: 1, borderColor: colors.border.blueHairline,
    padding: spacing.md,
    ...(shadows.card as object),
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  cardTitle: { ...typography.h3, color: colors.text.primary, fontSize: 15 },
  cardHint: { color: colors.text.secondary, fontSize: 12, marginBottom: spacing.md, lineHeight: 16 },

  miniLabel: { ...typography.label, color: colors.text.secondary, fontSize: 10, marginTop: 4, marginBottom: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radii.pill, borderWidth: 1,
    borderColor: colors.border.blueHairline, backgroundColor: colors.bg.app,
    minWidth: 44, alignItems: "center", maxWidth: 240,
  },
  chipActive: { backgroundColor: colors.brand.azure, borderColor: colors.brand.azure, ...(shadows.btn as object) },
  chipText: { color: colors.text.primary, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: "#fff" },

  actionsRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },

  emptyMini: {
    paddingVertical: spacing.md, paddingHorizontal: spacing.sm,
    backgroundColor: colors.bg.app, borderRadius: radii.input,
    borderWidth: 1, borderStyle: "dashed", borderColor: colors.brand.primaryBorder,
  },
  emptyMiniTxt: { color: colors.text.secondary, fontSize: 12, textAlign: "center", lineHeight: 16 },

  cuponCard: {
    backgroundColor: colors.bg.app, borderRadius: radii.input,
    borderWidth: 1, borderColor: colors.border.blueHairline,
    padding: spacing.sm + 2, gap: spacing.sm,
  },
  cuponCardUsed: { opacity: 0.7 },
  cuponHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  cuponCodigoRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  cuponCodigo: {
    fontFamily: typography.monoBold.fontFamily,
    color: colors.brand.sapphire, fontSize: 16, letterSpacing: 1,
  },
  cuponDesc: { color: colors.text.primary, fontSize: 12, marginTop: 2 },
  cuponMeta: { color: colors.text.secondary, fontSize: 11, marginTop: 2 },
  cuponMetaUsed: { color: colors.text.tertiary, fontSize: 11, marginTop: 1, fontStyle: "italic" },
  cuponActions: {
    flexDirection: "row", flexWrap: "wrap", gap: 6,
  },
  actionMini: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.sm, borderWidth: 1,
    borderColor: colors.border.default, backgroundColor: colors.bg.card,
  },
  actionPrimary: {
    backgroundColor: "#25D366",  // WhatsApp green oficial
    borderColor: "#25D366",
  },
  actionDanger: {
    backgroundColor: colors.status.red + "10",
    borderColor: colors.status.red + "40",
  },
  actionMiniTxt: { color: "#fff", fontSize: 11, fontWeight: "800" },
  actionMiniTxtSec: { color: colors.text.primary, fontSize: 11, fontWeight: "700" },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.sm, borderWidth: 1,
  },
  badgeTxt: { fontSize: 9, fontWeight: "800" },
});
