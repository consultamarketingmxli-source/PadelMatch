/**
 * Página de DEMO del sistema de loaders. Acceso: /loader-demo
 * Para validar visualmente las 3 variantes (instantáneo / skeleton / pelota).
 *
 * NO se enlaza desde ningún menú — sólo accesible si conoces la URL.
 * Eliminar antes de ir a producción si no quieres exponerla.
 */
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";

import {
  PadelBallLoader,
  Skeleton,
  SmartLoader,
} from "@/src/components/loaders";

export default function LoaderDemo() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [scenario, setScenario] = useState<"fast" | "medium" | "slow">("medium");

  const trigger = (s: "fast" | "medium" | "slow") => {
    setScenario(s);
    setLoading(true);
    const ms = s === "fast" ? 200 : s === "medium" ? 600 : 1500;
    setTimeout(() => setLoading(false), ms);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <ArrowLeft size={20} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.title}>Sistema de Loaders Demo</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>1 · Pelota volt (loader crítico)</Text>
        <View style={styles.showcase}>
          <PadelBallLoader size={56} label="Procesando pago..." />
        </View>

        <Text style={styles.section}>2 · Skeletons de feed</Text>
        <View style={styles.showcaseLeft}>
          <Skeleton.RetaCard />
        </View>

        <Text style={styles.section}>3 · SmartLoader condicional</Text>
        <Text style={styles.hint}>
          Pulsa un escenario. Si {"<"}300ms = nada, 300–800ms = skeleton, ≥800ms = pelota.
        </Text>

        <View style={styles.row}>
          <Btn label="200ms (instantáneo)" onPress={() => trigger("fast")} />
          <Btn label="600ms (skeleton)" onPress={() => trigger("medium")} />
          <Btn label="1500ms (pelota)" onPress={() => trigger("slow")} />
        </View>

        <View style={styles.demoArea}>
          <SmartLoader
            loading={loading}
            skeleton={
              <View>
                <Skeleton.RetaCard />
                <Skeleton.RetaCard />
              </View>
            }
          >
            <View style={styles.dataReady}>
              <Text style={styles.dataReadyText}>
                ✓ Datos listos (último escenario: {scenario})
              </Text>
            </View>
          </SmartLoader>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Btn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.btn}>
      <Text style={styles.btnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    backgroundColor: "#fff",
  },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "800", color: "#0F172A" },
  body: { padding: 16 },
  section: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
    marginTop: 16,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  hint: { color: "#64748B", fontSize: 12, marginBottom: 8 },
  showcase: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  showcaseLeft: { gap: 8 },
  row: { flexDirection: "row", gap: 6, marginBottom: 12, flexWrap: "wrap" },
  btn: {
    backgroundColor: "#1E40AF",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  demoArea: {
    minHeight: 220,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  dataReady: {
    backgroundColor: "#ECFCCB",
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
  },
  dataReadyText: { color: "#365314", fontWeight: "700" },
});
