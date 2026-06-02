/**
 * /icon-gallery — Galería preview de TODOS los iconos generados.
 *
 * Renderiza los 5 PNGs producidos por scripts/generate_icons.py:
 *   icon.png · adaptive-icon.png · splash-icon.png · favicon.png · icon-monochrome.png
 *
 * Cada uno se muestra con el contexto correcto:
 *   - icon: tal cual (iOS renderiza squircle al instalar)
 *   - adaptive-icon: sobre fondo slate-900 (lo que verá Android)
 *   - splash-icon: sobre F8FAFC (lo que verá el splash screen)
 *   - favicon: tamaño nativo 48px
 *   - monochrome: sobre fondo blue brand para simular tinted mode
 */
import React from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";

const ICONS = [
  {
    name: "icon.png",
    label: "iOS Icon (1024×1024)",
    note: "iOS aplica el squircle en runtime",
    asset: require("../assets/images/icon.png"),
    bg: "#E2E8F0",
  },
  {
    name: "adaptive-icon.png",
    label: "Android Adaptive (1024×1024)",
    note: "Foreground sobre backgroundColor #0f172a",
    asset: require("../assets/images/adaptive-icon.png"),
    bg: "#0f172a",
  },
  {
    name: "splash-icon.png",
    label: "Splash Screen (1024×1024)",
    note: "Sobre fondo splash #F8FAFC",
    asset: require("../assets/images/splash-icon.png"),
    bg: "#F8FAFC",
  },
  {
    name: "favicon.png",
    label: "Favicon (48×48)",
    note: "Tamaño nativo",
    asset: require("../assets/images/favicon.png"),
    bg: "#E2E8F0",
    nativeSize: 48,
  },
  {
    name: "icon-monochrome.png",
    label: "Tinted Mode (1024×1024)",
    note: "iOS 18+ Dark/Tinted, fondo blue brand simulado",
    asset: require("../assets/images/icon-monochrome.png"),
    bg: "#1E40AF",
  },
];

export default function IconGallery() {
  return (
    <ScrollView style={styles.stage} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Icon Set · PadelAppRetas</Text>
      <Text style={styles.subtitle}>Generados desde Pelota Padel.jpg vía Pillow</Text>

      <View style={styles.grid}>
        {ICONS.map((ic) => (
          <View key={ic.name} style={styles.card}>
            <View style={[styles.preview, { backgroundColor: ic.bg }]}>
              <Image
                source={ic.asset}
                style={{
                  width: ic.nativeSize ?? 200,
                  height: ic.nativeSize ?? 200,
                  borderRadius: ic.name === "icon.png" ? 44 : 0,
                }}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.label}>{ic.label}</Text>
            <Text style={styles.note}>{ic.note}</Text>
            <Text style={styles.filename}>{ic.name}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: "#F1F5F9" },
  scroll: { padding: 20, paddingBottom: 60 },
  title: {
    fontSize: 22,
    fontWeight: "900",
    color: "#0F172A",
    textAlign: "center",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "#475569",
    textAlign: "center",
    marginBottom: 20,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    justifyContent: "center",
  },
  card: {
    width: 240,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
    paddingBottom: 12,
  },
  preview: {
    width: 240,
    height: 240,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    paddingHorizontal: 12,
    marginTop: 10,
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
  },
  note: {
    paddingHorizontal: 12,
    marginTop: 2,
    fontSize: 11,
    color: "#64748B",
    textAlign: "center",
  },
  filename: {
    paddingHorizontal: 12,
    marginTop: 6,
    fontSize: 11,
    color: "#1E40AF",
    fontWeight: "700",
    textAlign: "center",
  },
});
