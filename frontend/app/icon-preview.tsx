/**
 * /icon-preview — Render del icono de acceso directo (app icon).
 *
 * Composición:
 *   1. Lienzo Squircle 512×512 con fondo #0f172a (slate-900).
 *   2. Pelota Padel.jpg con máscara circular (Image + borderRadius=50%).
 *   3. Wordmark "PadelAppRetas" minimalista alineado al centro,
 *      justo debajo de la base de la pelota.
 *
 * Esta pantalla es SOLO para preview visual — no se enlaza desde navegación.
 */
import React from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";

const PELOTA_URL =
  "https://customer-assets.emergentagent.com/job_padel-tournament-hub-9/artifacts/fpyuwnwu_Pelota%20Padel.jpg";

const CANVAS_SIZE = 512;
const BALL_SIZE = 230;
const SQUIRCLE_RADIUS = Math.round(CANVAS_SIZE * 0.22); // iOS-style squircle

export default function IconPreview() {
  return (
    <View style={styles.stage}>
      {/* Squircle base */}
      <View style={styles.squircle}>
        {/* Pelota con máscara circular */}
        <View style={styles.ballWrap}>
          <Image
            source={{ uri: PELOTA_URL }}
            style={styles.ball}
            resizeMode="cover"
          />
        </View>

        {/* Wordmark minimalista */}
        <View style={styles.wordmarkRow}>
          <Text style={styles.wordmarkLight}>Padel</Text>
          <Text style={styles.wordmarkHeavy}>AppRetas</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E2E8F0",
    padding: 24,
  },
  squircle: {
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    borderRadius: SQUIRCLE_RADIUS,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 56,
    paddingBottom: 64,
    // Sombra de elevación tipo iOS app icon
    ...Platform.select({
      web: {
        boxShadow:
          "0 12px 32px rgba(15, 23, 42, 0.35), 0 4px 10px rgba(15, 23, 42, 0.25)",
      },
      default: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.35,
        shadowRadius: 32,
        elevation: 12,
      },
    }),
  },
  ballWrap: {
    width: BALL_SIZE,
    height: BALL_SIZE,
    borderRadius: BALL_SIZE / 2,
    overflow: "hidden",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  ball: {
    width: BALL_SIZE,
    height: BALL_SIZE,
  },
  wordmarkRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
  },
  wordmarkLight: {
    fontSize: 44,
    lineHeight: 50,
    fontWeight: "300",
    color: "#E2E8F0",
    letterSpacing: -1.2,
    fontFamily: Platform.select({
      web: "Inter, system-ui, -apple-system, sans-serif",
      default: undefined,
    }) as string,
  },
  wordmarkHeavy: {
    fontSize: 44,
    lineHeight: 50,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -1.5,
    fontFamily: Platform.select({
      web: "Inter, system-ui, -apple-system, sans-serif",
      default: undefined,
    }) as string,
  },
});
