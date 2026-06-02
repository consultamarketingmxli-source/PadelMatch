/**
 * /legal — Hub legal (Location B del spec).
 *
 * 4 rows:
 *   - Términos y Condiciones → /legal/terms
 *   - Política de Privacidad → /legal/privacy
 *   - Licencias Open Source → /legal/licenses
 *   - Acerca de la app + Aviso → /legal/about
 *
 * Diseño: Apple-style settings rows con divisores, chevron-right, iconos a la izq.
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Info,
  Package,
  ShieldCheck,
} from "lucide-react-native";

import { APP_VERSION } from "@/src/content/legal";

type Row = {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  href: string;
};

const rows: Row[] = [
  {
    icon: <FileText size={20} color="#1E40AF" />,
    title: "Términos y Condiciones",
    subtitle: "Reglas de uso de la plataforma",
    href: "/legal/terms",
  },
  {
    icon: <ShieldCheck size={20} color="#1E40AF" />,
    title: "Política de Privacidad",
    subtitle: "Cómo tratamos tus datos personales",
    href: "/legal/privacy",
  },
  {
    icon: <Package size={20} color="#1E40AF" />,
    title: "Licencias Open Source",
    subtitle: "Bibliotecas de terceros utilizadas",
    href: "/legal/licenses",
  },
  {
    icon: <Info size={20} color="#1E40AF" />,
    title: "Acerca de la app",
    subtitle: "Versión, contacto y disclaimer",
    href: "/legal/about",
  },
];

export default function LegalHub() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ArrowLeft size={22} color="#0F172A" />
        </Pressable>
        <Text style={styles.title}>Legal y Cumplimiento</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.sectionLabel}>DOCUMENTOS LEGALES</Text>
        <View style={styles.card}>
          {rows.map((r, i) => (
            <Pressable
              key={r.href}
              onPress={() => router.push(r.href as any)}
              android_ripple={{ color: "#E2E8F0" }}
              style={({ pressed }) => [
                styles.row,
                i < rows.length - 1 && styles.rowBorder,
                pressed && { backgroundColor: "#F8FAFC" },
              ]}
              accessibilityRole="button"
              accessibilityLabel={r.title}
            >
              <View style={styles.rowIcon}>{r.icon}</View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{r.title}</Text>
                <Text style={styles.rowSubtitle}>{r.subtitle}</Text>
              </View>
              <ChevronRight size={18} color="#94A3B8" />
            </Pressable>
          ))}
        </View>

        <Text style={styles.footnote}>
          PadelAppRetas v{APP_VERSION}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
  },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "800", color: "#0F172A" },
  body: { padding: 16, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 0.6,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    minHeight: 56,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E2E8F0",
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: "700", color: "#0F172A" },
  rowSubtitle: { fontSize: 12, color: "#64748B", marginTop: 1 },
  footnote: {
    marginTop: 16,
    textAlign: "center",
    fontSize: 11,
    color: "#94A3B8",
    fontWeight: "600",
  },
});
