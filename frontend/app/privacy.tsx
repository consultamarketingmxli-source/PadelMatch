/**
 * /privacy — Alias público de la Política de Privacidad de PadelAppRetas.
 *
 * Motivo:
 *   • Google Play Store y Apple App Store exigen una URL pública dedicada
 *     de la política de privacidad (habitualmente `/privacy` en la raíz).
 *   • Enlaces desde emails de marketing, footers y firmas prefieren la
 *     ruta corta `/privacy` sobre `/legal/privacy`.
 *
 * Implementación:
 *   • Reusa el mismo `LegalContentView` y `PRIVACY_SECTIONS` que la ruta
 *     canónica `/legal/privacy` — así el contenido queda en un único
 *     source of truth (`/src/content/legal.ts`) y no se puede desincronizar.
 *   • Al hacer `expo export --platform web`, esta ruta genera
 *     `/privacy/index.html` estático, resolviendo el 404 reportado.
 *
 * Nota SEO: si se prefiere una URL canónica única, se puede añadir un
 * `<link rel="canonical" href="/legal/privacy">` en el futuro, pero por
 * ahora ambas rutas devuelven el mismo contenido intencionalmente.
 */
import React from "react";
import { LegalContentView } from "@/src/components/LegalContentView";
import { PRIVACY_SECTIONS, LEGAL_EFFECTIVE_DATE } from "@/src/content/legal";

export default function Privacy() {
  return (
    <LegalContentView
      title="Política de Privacidad"
      subtitle={`Vigente desde el ${LEGAL_EFFECTIVE_DATE}`}
      sections={PRIVACY_SECTIONS}
      documentVersion="1.0"
    />
  );
}
