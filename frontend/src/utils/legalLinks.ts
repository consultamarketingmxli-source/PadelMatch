/**
 * legalLinks — Constantes globales + helper para abrir URLs in-app.
 *
 * Estrategia:
 *  1. Intenta `expo-web-browser` (in-app browser tipo Safari View Controller).
 *  2. Fallback a `expo-linking` si el browser nativo falla.
 *  3. console.warn si todo falla (no crash).
 */
import * as Linking from "expo-linking";

export const LEGAL_URLS = {
  support: "https://padelappretas.framer.website",
  privacy: "https://padelappretas.framer.website/privacy",
  terms: "https://padelappretas.framer.website/privacy",
} as const;

/**
 * Abre URL en navegador in-app (Safari View Controller iOS / Chrome Custom Tabs Android).
 * Fallback a Linking.openURL si expo-web-browser no está disponible.
 */
export async function openExternalLink(url: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const WebBrowser = require("expo-web-browser");
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: "pageSheet",
      controlsColor: "#2563eb",
      toolbarColor: "#0f172a",
      showTitle: true,
    });
  } catch {
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) await Linking.openURL(url);
      else console.warn("[legalLinks] URL no soportada:", url);
    } catch (err) {
      console.warn("[legalLinks] No se pudo abrir:", url, err);
    }
  }
}
