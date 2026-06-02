/**
 * LegalContentView — Pantalla reutilizable para renderizar contenido legal.
 *
 * Características:
 *   - Header sticky con botón "Cerrar" (X) en top-left para volver.
 *   - Soporta dos modos:
 *       1) `sections`: arr de {title, body} → render nativo formateado.
 *       2) `webUrl`: URL externa → render via WebView IN-APP (sin salir de la app).
 *   - Footer fijo con metadatos legales (versión y fecha de vigencia).
 *
 * Por defecto preferimos modo `sections` (offline-ready, mejor performance,
 * estilizado coherente con la app). El modo `webUrl` se reserva para casos
 * donde el contenido legal vive en un CMS externo.
 */
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { X } from "lucide-react-native";

import { WebView } from "react-native-webview";
import type { LegalSection } from "@/src/content/legal";

type Props = {
  title: string;
  /** Subtítulo opcional bajo el título (ej. "Vigente desde 30 may 2026"). */
  subtitle?: string;
  /** Render nativo de secciones (preferido). */
  sections?: LegalSection[];
  /** URL externa en WebView (alternativo). */
  webUrl?: string;
  /** Versión del documento (footer). */
  documentVersion?: string;
};

export function LegalContentView({
  title,
  subtitle,
  sections,
  webUrl,
  documentVersion,
}: Props) {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Header sticky */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
        >
          <X size={22} color="#0F172A" />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
        </View>
        <View style={{ width: 40 }} />
      </View>

      {webUrl ? (
        // Modo WebView in-app: nunca sale de la app a Safari/Chrome externos.
        <WebView
          source={{ uri: webUrl }}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.webLoading}>
              <ActivityIndicator size="large" color="#1E40AF" />
            </View>
          )}
          style={styles.webview}
          // Seguridad: bloqueamos navegación fuera del dominio inicial.
          onShouldStartLoadWithRequest={(req) => {
            try {
              const origin = new URL(webUrl).origin;
              return req.url.startsWith(origin);
            } catch {
              return true;
            }
          }}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {sections?.map((s, i) => (
            <View key={i} style={styles.section}>
              <Text style={styles.sectionTitle}>{s.title}</Text>
              <Text style={styles.sectionBody}>{s.body}</Text>
            </View>
          ))}
          {documentVersion ? (
            <View style={styles.footer}>
              <Text style={styles.footerText}>
                Versión {documentVersion} — PadelAppRetas
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}
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
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  headerTitleWrap: { flex: 1, alignItems: "center" },
  headerTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },
  headerSubtitle: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
  scroll: { padding: 20, paddingBottom: 48 },
  section: { marginBottom: 22 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 6,
    fontFamily: Platform.select({
      web: "Inter, system-ui, -apple-system, sans-serif",
      default: undefined,
    }) as string,
  },
  sectionBody: {
    fontSize: 14,
    lineHeight: 21,
    color: "#334155",
    fontFamily: Platform.select({
      web: "Inter, system-ui, -apple-system, sans-serif",
      default: undefined,
    }) as string,
  },
  footer: {
    marginTop: 12,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    alignItems: "center",
  },
  footerText: { fontSize: 11, color: "#94A3B8", fontWeight: "600" },
  webview: { flex: 1 },
  webLoading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
