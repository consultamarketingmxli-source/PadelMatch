/** Lista de inscripciones de una reta con acción de reembolso. */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, RotateCcw, CheckCircle2, Clock, Upload, XCircle } from "lucide-react-native";

import { Inscripcion, api } from "@/src/api";
import { ImportarJugadoresModal } from "@/src/components/ImportarJugadoresModal";
import { colors, radii, spacing, typography } from "@/src/theme";

const estatusInfo = (s: string) => {
  if (s === "Aprobado") return { color: colors.status.green, icon: <CheckCircle2 size={14} color={colors.status.green} />, label: "Pagado" };
  if (s === "Pendiente") return { color: colors.status.amber, icon: <Clock size={14} color={colors.status.amber} />, label: "Pendiente" };
  return { color: colors.status.red, icon: <XCircle size={14} color={colors.status.red} />, label: s };
};

export default function AdminInscripciones() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [items, setItems] = useState<Inscripcion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.listInscripciones(id);
      setItems(r);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudieron cargar las inscripciones");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const onRefund = (insc: Inscripcion) => {
    Alert.alert(
      "Confirmar reembolso",
      `¿Reembolsar a ${insc.nombre} (${insc.telefono})? Su lugar se libera y se promueve a la siguiente persona en lista de espera.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Reembolsar",
          style: "destructive",
          onPress: async () => {
            if (!id) return;
            setRefunding(insc.id);
            try {
              const res = await api.refundInscripcion(id, insc.id);
              Alert.alert(
                "Reembolso completado",
                `Stripe procesó ${res.amount_refunded_mxn ? `$${res.amount_refunded_mxn} MXN` : "el reembolso"}.${res.promoted ? "\nSe promovió al siguiente en lista de espera." : ""}`,
              );
              await load();
            } catch (e: any) {
              Alert.alert("Error", e.message ?? "No se pudo procesar el reembolso");
            } finally {
              setRefunding(null);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="inscripciones-back">
          <ArrowLeft size={18} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Inscripciones</Text>
        <TouchableOpacity
          onPress={() => setImportOpen(true)}
          style={styles.importBtn}
          testID="import-open"
        >
          <Upload size={14} color={colors.brand.primary} />
          <Text style={styles.importBtnTxt}>Importar</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand.primary} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Sin inscripciones</Text>
              <Text style={styles.emptyText}>Cuando jugadores se inscriban aparecerán aquí.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const info = estatusInfo(item.estatus_pago);
            const canRefund = item.estatus_pago === "Aprobado";
            const isRefunding = refunding === item.id;
            return (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.nombre}</Text>
                  <Text style={styles.meta}>{item.telefono}</Text>
                  <View style={styles.estatusRow}>
                    {info.icon}
                    <Text style={[styles.estatus, { color: info.color }]}>{info.label}</Text>
                  </View>
                </View>
                {canRefund ? (
                  <TouchableOpacity
                    onPress={() => onRefund(item)}
                    disabled={isRefunding}
                    style={[styles.refundBtn, isRefunding && { opacity: 0.5 }]}
                    testID={`refund-${item.id}`}
                  >
                    {isRefunding ? (
                      <ActivityIndicator color={colors.text.inverse} size="small" />
                    ) : (
                      <>
                        <RotateCcw size={12} color={colors.text.inverse} />
                        <Text style={styles.refundBtnText}>Reembolsar</Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          }}
        />
      )}

      {/* Modal de Importación Masiva — paste CSV */}
      <ImportarJugadoresModal
        retaId={id || ""}
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => void load()}
      />
    </SafeAreaView>
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
    borderWidth: 1, borderColor: colors.border.default, alignItems: "center", justifyContent: "center",
  },
  importBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: spacing.sm + 2, paddingVertical: 8,
    borderRadius: radii.md, borderWidth: 1,
    borderColor: colors.brand.primary + "40",
    backgroundColor: colors.brand.primary + "10",
  },
  importBtnTxt: {
    ...typography.button, fontSize: 12, color: colors.brand.primary,
  },
  title: { ...typography.h2, color: colors.text.primary, fontSize: 18 },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.bg.card, borderRadius: radii.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.border.default,
  },
  name: { ...typography.bodyBold, color: colors.text.primary },
  meta: { color: colors.text.secondary, fontSize: 11, marginTop: 2 },
  estatusRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  estatus: { fontSize: 11, fontWeight: "700" },
  refundBtn: {
    backgroundColor: colors.status.red, borderRadius: radii.md,
    paddingHorizontal: 12, paddingVertical: 8,
    flexDirection: "row", alignItems: "center", gap: 4,
  },
  refundBtnText: { color: colors.text.inverse, fontSize: 12, fontWeight: "800" },
  empty: { paddingVertical: spacing.xxl, alignItems: "center", gap: spacing.sm },
  emptyTitle: { ...typography.h2, color: colors.text.primary, fontSize: 18 },
  emptyText: { color: colors.text.secondary, textAlign: "center", paddingHorizontal: spacing.lg },
});
