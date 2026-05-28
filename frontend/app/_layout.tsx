import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { LogBox } from "react-native";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useAppFonts } from "@/src/hooks/use-app-fonts";
import { BrandSplash } from "@/src/components/BrandSplash";

// Silenciar warnings ruidosos provenientes de dependencias (no-blockers).
// Estos warnings vienen de:
//  • react-native-draggable-flatlist en web (useNativeDriver)
//  • react-native-screens / react-navigation internals (pointerEvents prop)
//  • Compatibilidad futura React 19 (element.ref)
// El comportamiento es correcto en iOS/Android nativo.
LogBox.ignoreLogs([
  "useNativeDriver",
  "props.pointerEvents is deprecated",
  "Accessing element.ref",
  "shadow* props are deprecated",
]);

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [iconsLoaded, iconsErr] = useIconFonts();
  const [fontsLoaded, fontsErr] = useAppFonts();
  const ready = (iconsLoaded || iconsErr) && (fontsLoaded || fontsErr);
  const [showBrandSplash, setShowBrandSplash] = useState(true);

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#F8FAFC" },
          animation: "slide_from_right",
        }}
      />
      {showBrandSplash ? (
        <BrandSplash onDone={() => setShowBrandSplash(false)} />
      ) : null}
    </>
  );
}
