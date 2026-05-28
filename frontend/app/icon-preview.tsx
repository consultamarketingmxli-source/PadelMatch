/**
 * RUTA TEMPORAL — Preview visual del PadelPalaIcon.
 * Eliminar este archivo una vez aprobado por el Director de Arte.
 */
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PadelPalaIcon } from "../src/components/PadelPalaIcon";

export default function IconPreview() {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>PadelPalaIcon — Director de Arte v6</Text>
        <Text style={styles.subtitle}>
          Geometría: viewBox 48×64 · diamante real · puente M-invertido · grid limpio
        </Text>

        {/* ============================================== */}
        {/* SECCIÓN 1 — Tamaño hero outline */}
        {/* ============================================== */}
        <View style={styles.section}>
          <Text style={styles.label}>Hero · 256 · outline</Text>
          <View style={styles.heroBox}>
            <PadelPalaIcon size={256} />
          </View>
        </View>

        {/* ============================================== */}
        {/* SECCIÓN 2 — Hero filled */}
        {/* ============================================== */}
        <View style={styles.section}>
          <Text style={styles.label}>Hero · 256 · filled</Text>
          <View style={styles.heroBox}>
            <PadelPalaIcon size={256} filled />
          </View>
        </View>

        {/* ============================================== */}
        {/* SECCIÓN 3 — Escala progresiva */}
        {/* ============================================== */}
        <View style={styles.section}>
          <Text style={styles.label}>Escala · 16 · 24 · 32 · 48 · 64 · 96 · 128</Text>
          <View style={styles.row}>
            {[16, 24, 32, 48, 64, 96, 128].map((s) => (
              <View key={s} style={styles.iconCell}>
                <PadelPalaIcon size={s} />
                <Text style={styles.iconLabel}>{s}px</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ============================================== */}
        {/* SECCIÓN 4 — Estado activo (filled) en escala */}
        {/* ============================================== */}
        <View style={styles.section}>
          <Text style={styles.label}>Filled · estado activo</Text>
          <View style={styles.row}>
            {[24, 32, 48, 64, 96].map((s) => (
              <View key={`f-${s}`} style={styles.iconCell}>
                <PadelPalaIcon size={s} filled />
                <Text style={styles.iconLabel}>{s}px</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ============================================== */}
        {/* SECCIÓN 5 — Sobre fondo oscuro (color blanco) */}
        {/* ============================================== */}
        <View style={[styles.section, styles.darkSection]}>
          <Text style={[styles.label, { color: "#FFFFFF" }]}>
            Sobre fondo oscuro · color blanco
          </Text>
          <View style={styles.row}>
            {[48, 96, 144].map((s) => (
              <View key={`w-${s}`} style={styles.iconCell}>
                <PadelPalaIcon size={s} color="#FFFFFF" />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  scroll: { padding: 24, paddingBottom: 80, gap: 28 },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0F172A",
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 13,
    color: "#64748B",
    marginTop: -16,
  },
  section: {
    backgroundColor: "#FFFFFF",
    padding: 20,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E2E8F0",
    gap: 16,
  },
  darkSection: {
    backgroundColor: "#0F172A",
    borderColor: "#0F172A",
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    color: "#475569",
  },
  heroBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 20,
    alignItems: "flex-end",
  },
  iconCell: {
    alignItems: "center",
    gap: 6,
  },
  iconLabel: {
    fontSize: 10,
    color: "#94A3B8",
    fontWeight: "500",
  },
});
