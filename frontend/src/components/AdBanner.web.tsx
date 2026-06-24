/**
 * AdBanner.web.tsx — Stub para React Native Web.
 *
 * `react-native-google-mobile-ads` requiere módulos nativos Android/iOS.
 * En web los anuncios AdMob no se pueden mostrar — devolvemos `null` para
 * evitar crashes durante el bundling. Metro elige automáticamente este
 * archivo cuando la plataforma es `web`.
 */
import * as React from "react";

export function AdBanner() {
  // Suppress unused warning while keeping React in scope for JSX classics.
  void React;
  return null;
}

export default AdBanner;
