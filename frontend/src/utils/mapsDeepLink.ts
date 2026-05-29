/**
 * mapsDeepLink — helpers para abrir el club en Maps de forma robusta.
 *
 * Estrategia:
 *   - Si la plataforma es iOS, intenta primero Apple Maps (`maps://?q=...`
 *     o `maps://?ll=lat,lng`). Si el SO o el usuario lo bloquea, cae a
 *     Google Maps universal URL.
 *   - Si es Android, abre Google Maps directamente con el esquema universal
 *     (Android resolverá entre app instalada o navegador automáticamente).
 *   - En web, abre nueva pestaña a Google Maps.
 *
 * Anti-fallos:
 *   - `nombre` o `direccion` vacíos: usa solo lo que haya. Si TODO está vacío,
 *     devuelve `null` y el caller debe ocultar el botón.
 *   - `lat/lng` NaN o fuera de rango → degrada a query por texto.
 *   - Si Linking.openURL falla (no hay Maps), silenciamos (catch).
 */
import { Linking, Platform } from "react-native";

export type MapsTarget = {
  nombre?: string | null;
  direccion?: string | null;
  lat?: number | null;
  lng?: number | null;
};

function _isValidCoord(lat: number | null | undefined, lng: number | null | undefined): lat is number {
  if (lat == null || lng == null) return false;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

/** Construye URL canónica de Google Maps (universal — funciona en web e iOS/Android). */
export function buildGoogleMapsUrl(t: MapsTarget): string | null {
  if (_isValidCoord(t.lat, t.lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${t.lat},${t.lng}`;
  }
  const partes = [t.nombre ?? "", t.direccion ?? ""].map((x) => (x ?? "").trim()).filter(Boolean);
  if (partes.length === 0) return null;
  const q = encodeURIComponent(partes.join(" "));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** Construye URL de Apple Maps (solo iOS). */
function _buildAppleMapsUrl(t: MapsTarget): string | null {
  if (_isValidCoord(t.lat, t.lng)) {
    return `maps://?ll=${t.lat},${t.lng}&q=${encodeURIComponent((t.nombre ?? "Ubicación").trim() || "Ubicación")}`;
  }
  const partes = [t.nombre ?? "", t.direccion ?? ""].map((x) => (x ?? "").trim()).filter(Boolean);
  if (partes.length === 0) return null;
  return `maps://?q=${encodeURIComponent(partes.join(" "))}`;
}

/**
 * Abre el destino en Maps de la forma más nativa posible.
 * Web → window.open. iOS → Apple Maps primero, fallback Google. Android → Google.
 *
 * @returns true si se intentó abrir; false si no había suficientes datos.
 */
export async function openInMaps(t: MapsTarget): Promise<boolean> {
  const googleUrl = buildGoogleMapsUrl(t);
  if (!googleUrl) return false;

  if (Platform.OS === "web" && typeof window !== "undefined") {
    try {
      window.open(googleUrl, "_blank", "noopener,noreferrer");
    } catch {
      // pop-up blocker / SSR — fallback navegación same-tab
      try { (window as any).location.href = googleUrl; } catch { /* noop */ }
    }
    return true;
  }

  // Mobile: en iOS preferimos Apple Maps (UX nativa). Fallback Google.
  if (Platform.OS === "ios") {
    const appleUrl = _buildAppleMapsUrl(t);
    if (appleUrl) {
      try {
        const can = await Linking.canOpenURL(appleUrl);
        if (can) {
          await Linking.openURL(appleUrl);
          return true;
        }
      } catch { /* cae a Google */ }
    }
  }

  // Android (o iOS sin Apple Maps disponible): Google Maps universal URL.
  try {
    await Linking.openURL(googleUrl);
    return true;
  } catch {
    return false;
  }
}
