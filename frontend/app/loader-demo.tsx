/**
 * Página de DEMO temporal: valida las formas canónicas de pelota y pala
 * + las 3 variantes del SmartLoader.
 *
 * Acceso: /loader-demo (no enlazada en navegación).
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
import { PadelBallShape, PadelPalaShape } from "@/src/components/brand";
import { BrandLogo } from "@/src/components/BrandLogo";
import { PadelPalaIcon } from "@/src/components/PadelPalaIcon";

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
        <Text style={styles.title}>Brand Shapes · Loaders Demo</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* ────────────── Formas canónicas ────────────── */}
        <Text style={styles.section}>A · Pelota canónica (mismo SVG, distinto color)</Text>
        <View style={styles.row}>
          <Tile label="Volt #ccff00">
            <PadelBallShape size={72} color="#ccff00" />
          </Tile>
          <Tile label="Volt + 3D">
            <PadelBallShape size={72} color="#ccff00" gradient highlight />
          </Tile>
          <Tile label="Brand azul">
            <PadelBallShape
              size={72}
              color="#2563EB"
              gradientTo="#312E81"
              gradient
              highlight
            />
          </Tile>
          <Tile label="Mono negro">
            <PadelBallShape size={72} color="#0F172A" />
          </Tile>
        </View>

        <Text style={styles.section}>B · Pala canónica (grid 8×8 perforaciones)</Text>
        <View style={styles.row}>
          <Tile label="Negro ref">
            <PadelPalaShape size={84} color="#1E1B4B" />
          </Tile>
          <Tile label="Brand azul">
            <PadelPalaShape size={84} color="#2563EB" />
          </Tile>
          <Tile label="Volt">
            <PadelPalaShape size={84} color="#ccff00" holeColor="#0F172A" />
          </Tile>
          <Tile label="PadelPalaIcon">
            <PadelPalaIcon size={84} />
          </Tile>
        </View>

        <Text style={styles.section}>C · BrandLogo (3 variantes)</Text>
        <View style={styles.row}>
          <Tile label="light">
            <BrandLogo size={72} variant="light" />
          </Tile>
          <Tile darkBg label="dark">
            <BrandLogo size={72} variant="dark" />
          </Tile>
          <Tile label="mono">
            <BrandLogo size={72} variant="mono" />
          </Tile>
        </View>

        {/* ────────────── Loaders ────────────── */}
        <Text style={styles.section}>D · PadelBallLoader (squash & stretch)</Text>
        <View style={styles.showcase}>
          <PadelBallLoader size={56} label="Procesando pago..." />
        </View>

        <Text style={styles.section}>E · Skeletons de feed</Text>
        <View style={styles.showcaseLeft}>
          <Skeleton.RetaCard />
        </View>

        <Text style={styles.section}>F · SmartLoader condicional</Text>
        <Text style={styles.hint}>
          {"<"}300ms = nada, 300–800ms = skeleton, ≥800ms = pelota.
        </Text>

        <View style={styles.btnRow}>
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

function Tile({
  label,
  children,
  darkBg,
}: {
  label: string;
  children: React.ReactNode;
  darkBg?: boolean;
}) {
  return (
    <View
      style={[styles.tile, darkBg && { backgroundColor: "#0F172A", borderColor: "#1E293B" }]}
    >
      <View style={styles.tileBody}>{children}</View>
      <Text style={[styles.tileLabel, darkBg && { color: "#94A3B8" }]}>{label}</Text>
    </View>
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
  body: { padding: 16, paddingBottom: 48 },
  section: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
    marginTop: 24,
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  hint: { color: "#64748B", fontSize: 12, marginBottom: 8 },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  tile: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    minWidth: 92,
  },
  tileBody: {
    minHeight: 90,
    alignItems: "center",
    justifyContent: "center",
  },
  tileLabel: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
  },
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
  btnRow: { flexDirection: "row", gap: 6, marginBottom: 12, flexWrap: "wrap" },
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
