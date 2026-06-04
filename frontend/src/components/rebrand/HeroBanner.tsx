/**
 * HeroBanner — Tarjeta hero premium con foto real de cancha de pádel.
 *
 * Spec del Master Design v3:
 *   • Foto AVIF de cancha (lbsdpc8k_campo-padel-alto-angulo) como fondo.
 *   • Overlay gradient Sapphire 82% → Azure 40% para legibilidad.
 *   • TopBar interno: brand + notification bell.
 *   • Título Black tracking-tighter + subtítulo.
 *   • Pills informativos translúcidos con backdrop-blur.
 *   • CTA secundario blanco contrastando con el azul profundo.
 */
import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowRight, Bell, CalendarDays, Globe } from "lucide-react-native";
import { brandAssets, colors, fonts, radii, shadows } from "@/src/theme";

export type HeroBannerProps = {
  brand?: string;
  title: string | React.ReactNode;
  subtitle?: string | React.ReactNode;
  ctaLabel?: string;
  onCtaPress?: () => void;
  onBellPress?: () => void;
  stats?: Array<{ icon?: "globe" | "calendar"; label: string }>;
};

export function HeroBanner({
  brand = "PadelAppRetas",
  title,
  subtitle,
  ctaLabel,
  onCtaPress,
  onBellPress,
  stats = [],
}: HeroBannerProps) {
  return (
    <View style={[styles.hero, shadows.hero]}>
      {/* Foto real de cancha como fondo absoluto */}
      <Image
        source={{ uri: brandAssets.courtHero }}
        style={StyleSheet.absoluteFillObject}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
      {/* Overlay gradient Sapphire 82% → Azure 40% */}
      <LinearGradient
        colors={["rgba(15,40,110,0.82)", "rgba(29,78,216,0.55)", "rgba(59,130,246,0.40)"]}
        locations={[0, 0.45, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      {/* TopBar interno */}
      <View style={styles.topBar}>
        <Text style={styles.brand}>{brand}</Text>
        {onBellPress && (
          <Pressable onPress={onBellPress} style={styles.bellBtn} hitSlop={8}>
            <Bell size={16} color="#fff" strokeWidth={2} />
          </Pressable>
        )}
      </View>

      {/* Título */}
      <Text style={styles.title}>{title}</Text>

      {/* Subtítulo */}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      {/* Stat pills */}
      {stats.length > 0 && (
        <View style={styles.statsRow}>
          {stats.map((s, i) => (
            <View key={i} style={styles.pill}>
              {s.icon === "globe" && <Globe size={11} color="rgba(255,255,255,0.9)" strokeWidth={2.4} />}
              {s.icon === "calendar" && <CalendarDays size={11} color="rgba(255,255,255,0.9)" strokeWidth={2.4} />}
              <Text style={styles.pillText}>{s.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* CTA secundario blanco */}
      {ctaLabel && (
        <Pressable
          onPress={onCtaPress}
          style={({ pressed }) => [styles.cta, pressed && { transform: [{ translateY: 1 }], opacity: 0.92 }]}
        >
          <Text style={styles.ctaLabel}>{ctaLabel}</Text>
          <ArrowRight size={13} color={colors.brand.sapphire} strokeWidth={2.8} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radii.hero,
    overflow: "hidden",
    paddingTop: 26,
    paddingHorizontal: 24,
    paddingBottom: 24,
    backgroundColor: colors.brand.sapphire,
    minHeight: 280,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  brand: {
    color: "#fff",
    fontFamily: fonts.sansExtraBold,
    fontSize: 15,
    letterSpacing: -0.4,
  },
  bellBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: "#fff",
    fontFamily: fonts.sansExtraBold,
    fontSize: 28,
    lineHeight: 30,
    letterSpacing: -1.2,
    marginBottom: 12,
  },
  subtitle: {
    color: "rgba(255,255,255,0.75)",
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
  },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.13)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  pillText: {
    color: "rgba(255,255,255,0.88)",
    fontFamily: fonts.sansSemiBold,
    fontSize: 11,
    letterSpacing: -0.1,
  },
  cta: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderRadius: radii.button,
  },
  ctaLabel: {
    color: colors.brand.sapphire,
    fontFamily: fonts.sansExtraBold,
    fontSize: 13,
    letterSpacing: -0.3,
  },
});
