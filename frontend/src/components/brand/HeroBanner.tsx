/**
 * HeroBanner — Banner inmersivo del rebrand v3 (Sapphire/Azure).
 *
 * Composición:
 *   • Imagen de fondo `brandAssets.courtHero` (cancha alto-ángulo).
 *   • Overlay vertical Sapphire → Azure → transparente.
 *   • Title display + subtitle opcional + slot derecho opcional (CTA / icon).
 *
 * Solo UI: no maneja estado ni navegación. Drop-in en cualquier pantalla.
 */
import React from "react";
import {
  ImageBackground,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  brandAssets,
  colors,
  radii,
  shadows,
  spacing,
  typography,
} from "@/src/theme";

export type HeroBannerProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  right?: React.ReactNode;
  footer?: React.ReactNode;
  height?: number;
  /** Estilo extra del wrapper externo (no del contenido interno). */
  style?: ViewStyle;
  testID?: string;
};

export function HeroBanner({
  title,
  subtitle,
  eyebrow,
  right,
  footer,
  height = 200,
  style,
  testID,
}: HeroBannerProps) {
  return (
    <View
      testID={testID}
      style={[styles.wrapper, shadows.hero as object, { height }, style]}
    >
      <ImageBackground
        source={require("@/assets/brand/court-iconic.jpg")}
        style={StyleSheet.absoluteFill as ViewStyle}
        imageStyle={styles.image}
        resizeMode="cover"
      >
        {/* Overlay Sapphire → Azure premium (de oscuro abajo a claro arriba) */}
        <LinearGradient
          colors={[
            "rgba(30,58,138,0.62)",   // sapphire top
            "rgba(30,58,138,0.72)",   // sapphire mid
            "rgba(15,23,42,0.82)",    // ink deep bottom
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill as ViewStyle}
        />
        {/* Inner highlight horizontal — sutil glow azure en la parte superior */}
        <LinearGradient
          colors={["rgba(96,165,250,0.18)", "rgba(96,165,250,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.topGlow}
          pointerEvents="none"
        />

        <View style={styles.content}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              {eyebrow ? (
                <Text style={styles.eyebrow} numberOfLines={1}>
                  {eyebrow}
                </Text>
              ) : null}
              <Text style={styles.title} numberOfLines={2}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={2}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {right ? <View style={styles.rightSlot}>{right}</View> : null}
          </View>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: radii.hero,
    overflow: "hidden",
    backgroundColor: colors.brand.sapphire,
  },
  image: {
    borderRadius: radii.hero,
  },
  topGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 80,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: "space-between",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  eyebrow: {
    ...typography.label,
    color: "rgba(255,255,255,0.78)",
    fontSize: 10,
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  title: {
    fontFamily: typography.display.fontFamily,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -1,
    color: "#FFFFFF",
  },
  subtitle: {
    ...typography.body,
    color: "rgba(255,255,255,0.85)",
    marginTop: spacing.sm,
  },
  rightSlot: {
    alignItems: "flex-end",
  },
  footer: {
    marginTop: spacing.md,
  },
});
