/**
 * Carga las fuentes premium de PadelappRetas — REBRAND v3 (Sapphire/Azure):
 *  - Plus Jakarta Sans (Regular 400 → Black 900) — fuente principal del rebrand
 *  - Inter (fallback heredado, mientras se completa la migración)
 *  - JetBrains Mono (datos críticos: precios, marcadores, DG)
 *
 * Se cargan en paralelo con las fuentes de íconos para evitar parpadeos.
 */
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
} from "@expo-google-fonts/inter";
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
} from "@expo-google-fonts/jetbrains-mono";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";

export const useAppFonts = (): readonly [boolean, Error | null] => {
  return useFonts({
    // Brand principal (rebrand v3)
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    // Fallback heredado
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
    // Datos críticos
    JetBrainsMono_400Regular,
    JetBrainsMono_600SemiBold,
    JetBrainsMono_700Bold,
  });
};

// Nombres de familias exportados para usar en StyleSheet sin typos.
// IMPORTANTE: los alias sans* ahora apuntan a Plus Jakarta Sans (rebrand v3).
// Se mantienen los nombres para no romper imports existentes.
export const FONTS = {
  sansRegular: "PlusJakartaSans_400Regular",
  sansMedium: "PlusJakartaSans_500Medium",
  sansSemiBold: "PlusJakartaSans_600SemiBold",
  sansBold: "PlusJakartaSans_700Bold",
  sansExtraBold: "PlusJakartaSans_800ExtraBold",
  // PJS no tiene Black 900 (tope = 800). Usamos ExtraBold con letter-spacing
  // negativo para emular el peso visual del Black solicitado por el rebrand.
  sansBlack: "PlusJakartaSans_800ExtraBold",
  monoRegular: "JetBrainsMono_400Regular",
  monoSemiBold: "JetBrainsMono_600SemiBold",
  monoBold: "JetBrainsMono_700Bold",
} as const;
