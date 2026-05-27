/**
 * Deep links cross-platform para PadelappRetas.
 *
 * Idea: en native usamos el scheme `padelappretas://` (ya configurado en app.json),
 * en web usamos URLs absolutas con `window.location.origin`. La librería
 * `expo-linking` se encarga del manejo nativo en builds y Expo Go.
 *
 * Ejemplo:
 *   buildPagoReturnUrl("exito", { inscripcion_id: "abc", provider: "mp" })
 *   // native →  padelappretas://pago/exito?inscripcion_id=abc&provider=mp
 *   // web    →  https://app.example.com/pago/exito?inscripcion_id=abc&provider=mp
 */
import { Platform } from "react-native";
import * as Linking from "expo-linking";

export type PagoOutcome = "exito" | "fallo";
export type PagoProvider = "mp" | "stripe";

export type PagoQuery = {
  inscripcion_id?: string;
  provider?: PagoProvider;
  reta_slug?: string;
};

export function buildPagoReturnUrl(outcome: PagoOutcome, params: PagoQuery): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const base = window.location.origin;
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) sp.set(k, String(v));
    });
    const qs = sp.toString();
    return `${base}/pago/${outcome}${qs ? `?${qs}` : ""}`;
  }
  // Native: scheme propio (configurado en app.json: "padelappretas")
  return Linking.createURL(`/pago/${outcome}`, { queryParams: params as any });
}
