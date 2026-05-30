/**
 * +not-found.tsx — Pantalla 404 branded.
 *
 * iter36 P3 fix: reemplaza el "Unmatched Route" default de expo-router
 * (texto blanco sobre fondo negro, sin branding) con una pantalla
 * coherente con el sistema de diseño de PadelAppRetas:
 *   - Brand logo + tagline
 *   - Mensaje amigable
 *   - CTA "Volver al inicio"
 *
 * IMPORTANTE: expo-router usa el archivo con prefijo `+not-found` como
 * fallback para CUALQUIER ruta no resuelta. No requiere registro manual.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Home, Compass } from "lucide-react-native";

import { BrandLogo, BrandWordmark } from "@/src/components/BrandLogo";

export default function NotFound() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <View style={styles.brandRow}>
          <BrandLogo size={64} variant="light" />
          <BrandWordmark size={20} />
        </View>

        <View style={styles.illustration}>
          <Compass size={88} color="#94A3B8" strokeWidth={1.5} />
        </View>

        <Text style={styles.code}>404</Text>
        <Text style={styles.title}>Esta pista no existe</Text>
        <Text style={styles.subtitle}>
          La ruta que buscas no está disponible o fue eliminada. Regresemos al
          radar de retas.
        </Text>

        <Pressable
          style={styles.primaryBtn}
          onPress={() => router.replace("/")}
        >
          <Home size={18} color="#FFFFFF" />
          <Text style={styles.primaryBtnText}>Volver al inicio</Text>
        </Pressable>

        <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
          <Text style={styles.secondaryBtnText}>Regresar a la pantalla anterior</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  brandRow: {
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  illustration: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    marginBottom: 8,
  },
  code: {
    fontSize: 48,
    fontWeight: "900",
    color: "#1E40AF",
    letterSpacing: -1.5,
    lineHeight: 52,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#475569",
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 380,
    marginBottom: 12,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1E40AF",
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 10,
    marginTop: 4,
  },
  primaryBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  secondaryBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryBtnText: { color: "#475569", fontWeight: "600", fontSize: 13 },
});
