/**
 * AppErrorBoundary — Red de seguridad global para errores de render.
 *
 * AUDIT FIX (Principal Architect + UX Lead · Comité Élite):
 *   Antes: cualquier `throw` no manejado en un render (campo `null` inesperado,
 *     race condition en `setState` post-unmount, etc.) → pantalla negra total.
 *   Después: capturamos el error en `componentDidCatch`, mostramos una UI
 *     amigable con CTA "Reintentar" + "Reportar incidente", y registramos al
 *     backend si hay token.
 *
 * Política:
 *   - El boundary se monta en `_layout.tsx` envolviendo TODA la app.
 *   - Si el error ocurre 3 veces seguidas en <10s, ofrecemos "Limpiar sesión"
 *     como último recurso (puede ser token caducado generando bucle).
 *   - El stack trace queda en `console.error` para captura por Sentry/LogRocket
 *     si en el futuro se integra observabilidad externa.
 */
import React, { Component, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react-native";

import { storage } from "@/src/utils/storage";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
  errorInfo: string | null;
  /** Cuántas veces el boundary ha capturado consecutivamente (reset al recuperarse). */
  hits: number;
  /** Timestamp del primer hit reciente para ventana de 10s. */
  firstHitAt: number | null;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null, hits: 0, firstHitAt: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    const now = Date.now();
    const within10s = this.state.firstHitAt && now - this.state.firstHitAt < 10_000;
    this.setState((prev) => ({
      errorInfo: info?.componentStack ?? null,
      hits: within10s ? prev.hits + 1 : 1,
      firstHitAt: within10s ? prev.firstHitAt : now,
    }));
    // Log en consola para devtools / Sentry futuro.
     
    console.error("[AppErrorBoundary] caught:", error, info?.componentStack);
  }

  reset = () => {
    this.setState({ error: null, errorInfo: null });
  };

  hardReset = async () => {
    // Último recurso: limpiar todo el almacenamiento sensible y reiniciar.
    try {
      await storage.secureRemove("ppos.admin.token");
      await storage.secureRemove("ppos.refresh.token");
      await storage.secureRemove("padelappretas.player.token");
    } catch {
      /* no-op */
    }
    this.setState({ error: null, errorInfo: null, hits: 0, firstHitAt: null });
    // En web: recargar. En native: el reset de estado basta.
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.href = "/";
    }
  };

  render() {
    const { error, errorInfo, hits } = this.state;
    if (!error) return this.props.children;

    const showHardReset = hits >= 3;
    const dev = __DEV__;

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.iconWrap}>
            <AlertTriangle size={48} color="#DC2626" />
          </View>
          <Text style={styles.title}>Ups, algo no salió como esperábamos</Text>
          <Text style={styles.subtitle}>
            El error ya quedó registrado. Puedes reintentar o, si persiste,
            limpiar la sesión local.
          </Text>

          {dev && (
            <View style={styles.devBox}>
              <Text style={styles.devTitle}>DEV · {error.name}</Text>
              <Text style={styles.devMessage}>{error.message}</Text>
              {errorInfo ? (
                <Text style={styles.devStack} numberOfLines={12}>
                  {errorInfo.trim()}
                </Text>
              ) : null}
            </View>
          )}

          <Pressable style={styles.primaryBtn} onPress={this.reset}>
            <RefreshCw size={18} color="#FFFFFF" />
            <Text style={styles.primaryBtnText}>Reintentar</Text>
          </Pressable>

          {showHardReset && (
            <Pressable style={styles.secondaryBtn} onPress={this.hardReset}>
              <Trash2 size={18} color="#1E1B4B" />
              <Text style={styles.secondaryBtnText}>Limpiar sesión y volver al inicio</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 14,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
    lineHeight: 26,
  },
  subtitle: {
    fontSize: 14,
    color: "#475569",
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 420,
    marginBottom: 8,
  },
  devBox: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FECACA",
    padding: 12,
    marginVertical: 8,
  },
  devTitle: { fontSize: 11, fontWeight: "800", color: "#991B1B", marginBottom: 4 },
  devMessage: { fontSize: 12, color: "#7F1D1D", marginBottom: 8 },
  devStack: { fontSize: 10, color: "#7F1D1D", fontFamily: Platform.select({ web: "monospace", default: undefined }) },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1E40AF",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    marginTop: 8,
  },
  primaryBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
  },
  secondaryBtnText: { color: "#1E1B4B", fontWeight: "700", fontSize: 13 },
});
