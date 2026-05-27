import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useAppFonts } from "@/src/hooks/use-app-fonts";
import { BrandSplash } from "@/src/components/BrandSplash";

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
