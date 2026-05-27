/**
 * Carga las fuentes premium de PadelappRetas:
 *  - Inter (Regular 400, SemiBold 600, Bold 700, ExtraBold 800, Black 900)
 *  - JetBrains Mono (Regular 400, SemiBold 600, Bold 700)
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

export const useAppFonts = (): readonly [boolean, Error | null] => {
  return useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
    JetBrainsMono_400Regular,
    JetBrainsMono_600SemiBold,
    JetBrainsMono_700Bold,
  });
};

// Nombres de familias exportados para usar en StyleSheet sin typos.
export const FONTS = {
  sansRegular: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemiBold: "Inter_600SemiBold",
  sansBold: "Inter_700Bold",
  sansExtraBold: "Inter_800ExtraBold",
  sansBlack: "Inter_900Black",
  monoRegular: "JetBrainsMono_400Regular",
  monoSemiBold: "JetBrainsMono_600SemiBold",
  monoBold: "JetBrainsMono_700Bold",
} as const;
