/**
 * Splash in-app: logo + wordmark grande con fade-in suave.
 * Se monta encima del contenido la primera vez que abre la app y se desvanece
 * tras 700ms para una transición fluida al home.
 */
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { BrandLogo } from "@/src/components/BrandLogo";
import { BrandWordmark } from "@/src/components/BrandWordmark";
import { colors, spacing } from "@/src/theme";
import { FONTS } from "@/src/hooks/use-app-fonts";

export function BrandSplash({ onDone }: { onDone?: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(8)).current;
  const fadeOut = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 450,
        useNativeDriver: true,
      }),
      Animated.timing(translate, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Mantener visible un beat antes de desvanecer
      setTimeout(() => {
        Animated.timing(fadeOut, {
          toValue: 0,
          duration: 350,
          useNativeDriver: true,
        }).start(() => onDone && onDone());
      }, 700);
    });
  }, [opacity, translate, fadeOut, onDone]);

  return (
    <Animated.View
      style={[styles.wrap, { opacity: fadeOut, pointerEvents: "none" }]}
      testID="brand-splash"
    >
      <Animated.View
        style={{
          opacity,
          transform: [{ translateY: translate }],
          alignItems: "center",
        }}
      >
        <BrandLogo size={112} />
        <View style={{ height: spacing.base }} />
        <BrandWordmark size="xl" />
        <Animated.Text style={styles.tagline}>Tu reta de pádel, a un toque de pala</Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg.app,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  tagline: {
    fontFamily: FONTS.sansMedium,
    fontSize: 13,
    color: colors.text.secondary,
    marginTop: spacing.md,
    letterSpacing: -0.1,
  },
});
