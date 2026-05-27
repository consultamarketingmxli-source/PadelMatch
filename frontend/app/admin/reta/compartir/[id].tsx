/**
 * Pantalla "Compartir reta" (Fase B — Convocatoria 3-click).
 *
 * Muestra al organizador:
 *   - QR descargable (PNG público, sin auth → cualquiera puede escanearlo)
 *   - Link público copiable
 *   - Botones de Compartir: WhatsApp, Compartir nativo, Copiar
 *   - Banner de capacidad + sugerencia inteligente
 *
 * UX principle: "1 click para promocionar tu reta" — nada de copy-paste manual.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import {
  ArrowLeft,
  Copy,
  Download,
  Share2,
  AlertCircle,
  Check,
  MessageCircle,
  Users,
} from "lucide-react-native";

import { ShareInfo, api } from "@/src/api";
import { colors, radii, spacing, typography } from "@/src/theme";

export default function CompartirReta() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getShareInfo(id as string);
      setInfo(data);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo cargar la info de compartir");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

  const handleCopy = async () => {
    if (!info) return;
    await Clipboard.setStringAsync(info.url_publica);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const handleShare = async () => {
    if (!info) return;
    const msg = `🎾 ¡Te invito a la reta "${info.nombre}"!\n\nInscríbete aquí (1 clic):\n${info.url_publica}`;
    try {
      await Share.share({ message: msg, url: info.url_publica, title: info.nombre });
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo compartir");
    }
  };

  const handleWhatsApp = async () => {
    if (!info) return;
    const text = encodeURIComponent(
      `🎾 ¡Te invito a la reta "${info.nombre}"!\n\nInscríbete aquí: ${info.url_publica}`,
    );
    // wa.me funciona tanto en web como en mobile (abre app si está instalada)
    const url = `https://wa.me/?text=${text}`;
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      Alert.alert("WhatsApp no disponible", "Usa el botón Compartir para enviar por otro medio.");
    }
  };

  const handleDownloadQR = async () => {
    if (!info) return;
    const qrUrl = api.getPublicQrUrl(info.url_slug);
    if (Platform.OS === "web") {
      // En web: fuerza descarga del PNG
      try {
        const res = await fetch(qrUrl);
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = `qr-${info.url_slug}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
      } catch (e: any) {
        Alert.alert("Error", e.message ?? "No se pudo descargar el QR");
      }
    } else {
      // En mobile: abre el PNG en el navegador para que el usuario lo guarde
      await Linking.openURL(qrUrl);
    }
  };

  if (loading || !info) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const semColor =
    info.semaforo === "VERDE"
      ? colors.status.green
      : info.semaforo === "AMARILLO"
        ? colors.status.amber
        : colors.status.red;

  const qrUrl = api.getPublicQrUrl(info.url_slug);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.iconBtn}
          testID="compartir-back"
        >
          <ArrowLeft size={18} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Compartir reta</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand.primary}
          />
        }
      >
        <Text style={styles.retaName}>{info.nombre}</Text>

        {/* Estado / Capacidad */}
        <View style={styles.statRow}>
          <View style={[styles.semDot, { backgroundColor: semColor }]} />
          <Text style={styles.statText}>
            <Text style={styles.statBold}>
              {info.inscritos}/{info.max_jugadores}
            </Text>{" "}
            inscritos
            {info.waitlist > 0 ? ` · ${info.waitlist} en espera` : ""}
            {" · "}
            {info.capacidad_pct.toFixed(0)}%
          </Text>
        </View>

        {/* Sugerencia inteligente */}
        {info.sugerencia ? (
          <View style={styles.suggestBox} testID="share-suggestion">
            <AlertCircle size={16} color={colors.status.amber} />
            <Text style={styles.suggestText}>{info.sugerencia}</Text>
          </View>
        ) : null}

        {/* QR */}
        <View style={styles.qrCard}>
          <Text style={styles.sectionLabel}>CÓDIGO QR</Text>
          <View style={styles.qrWrap}>
            <Image
              source={{ uri: qrUrl }}
              style={styles.qrImg}
              resizeMode="contain"
              testID="qr-image"
            />
          </View>
          <Text style={styles.qrCaption}>
            Escanea con la cámara para inscribirse al instante.
          </Text>
          <TouchableOpacity
            onPress={handleDownloadQR}
            style={styles.downloadBtn}
            testID="qr-download-btn"
          >
            <Download size={16} color={colors.text.inverse} />
            <Text style={styles.downloadText}>Descargar QR (PNG)</Text>
          </TouchableOpacity>
        </View>

        {/* Link público */}
        <Text style={styles.sectionLabel}>LINK PÚBLICO</Text>
        <View style={styles.linkBox}>
          <Text style={styles.linkText} numberOfLines={2} selectable>
            {info.url_publica}
          </Text>
          <TouchableOpacity
            onPress={handleCopy}
            style={styles.copyBtn}
            testID="copy-link-btn"
          >
            {copied ? (
              <Check size={16} color={colors.status.green} />
            ) : (
              <Copy size={16} color={colors.text.primary} />
            )}
            <Text style={[styles.copyText, copied && { color: colors.status.green }]}>
              {copied ? "Copiado" : "Copiar"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Acciones */}
        <Text style={styles.sectionLabel}>ACCIONES</Text>
        <TouchableOpacity
          onPress={handleWhatsApp}
          style={[styles.actionBtn, styles.actionWA]}
          testID="share-whatsapp-btn"
        >
          <MessageCircle size={18} color="#fff" />
          <Text style={[styles.actionText, { color: "#fff" }]}>Compartir por WhatsApp</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleShare}
          style={[styles.actionBtn, styles.actionSecondary]}
          testID="share-native-btn"
        >
          <Share2 size={18} color={colors.text.primary} />
          <Text style={styles.actionText}>Más opciones (Compartir…)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push(`/admin/reta/inscripciones/${info.reta_id}` as any)}
          style={[styles.actionBtn, styles.actionSecondary]}
          testID="open-inscripciones-btn"
        >
          <Users size={18} color={colors.text.primary} />
          <Text style={styles.actionText}>Ver inscritos & cobros</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...typography.h2, color: colors.text.primary, fontSize: 18 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  retaName: {
    ...typography.h2,
    color: colors.text.primary,
    fontSize: 22,
    marginBottom: spacing.md,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: spacing.md,
  },
  semDot: { width: 10, height: 10, borderRadius: 5 },
  statText: { color: colors.text.secondary, fontSize: 13 },
  statBold: { color: colors.text.primary, fontWeight: "800" },
  suggestBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#FFF8E1",
    borderWidth: 1,
    borderColor: colors.status.amber,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  suggestText: {
    flex: 1,
    color: colors.text.primary,
    fontSize: 12,
    lineHeight: 17,
  },
  qrCard: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  qrWrap: {
    width: 240,
    height: 240,
    backgroundColor: "#fff",
    borderRadius: radii.md,
    padding: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  qrImg: { width: "100%", height: "100%" },
  qrCaption: {
    color: colors.text.secondary,
    fontSize: 12,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  downloadBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radii.md,
    minWidth: 220,
  },
  downloadText: { color: colors.text.inverse, fontWeight: "800", fontSize: 14 },
  sectionLabel: {
    ...typography.label,
    color: colors.text.secondary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    fontSize: 11,
  },
  linkBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  linkText: {
    flex: 1,
    color: colors.text.primary,
    fontSize: 12,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.bg.app,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  copyText: { color: colors.text.primary, fontWeight: "700", fontSize: 12 },
  actionBtn: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
  },
  actionWA: { backgroundColor: "#25D366" },
  actionSecondary: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  actionText: { color: colors.text.primary, fontWeight: "800", fontSize: 14 },
});
