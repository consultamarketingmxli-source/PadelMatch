/**
 * app.config.js — Wrapper dinámico sobre `app.json`.
 * ─────────────────────────────────────────────────────────────────────────
 * Este archivo lo lee `expo` en cada build/dev-server. Sirve para inyectar
 * lógica condicional que un `app.json` estático no puede expresar.
 *
 * Uso actual (Iter51-Publish · Android-first):
 *   • Omite `android.googleServicesFile` cuando el archivo real todavía no
 *     está subido (sólo existe `google-services.json.TODO`). Sin esta guarda,
 *     `eas build --profile preview --platform android` falla con
 *     `Cannot find module 'google-services.json'`.
 *   • Cuando el usuario suba el archivo real de Firebase, esta guarda se
 *     desactiva automáticamente y push notifications empiezan a funcionar
 *     sin tocar código.
 *
 * Filosofía: `app.json` sigue siendo la fuente de verdad declarativa. Este
 * archivo sólo hace ajustes MÍNIMOS y DOCUMENTADOS.
 */
/* global __dirname */
const fs = require("fs");
const path = require("path");

const appJsonPath = path.resolve(__dirname, "app.json");
const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));

module.exports = ({ config: _existingConfig }) => {
  const expo = { ...appJson.expo };

  // ═════════ Guarda 1: google-services.json opcional ═════════
  // Si el archivo referenciado no existe físicamente, quitamos la referencia
  // para que EAS build no falle. En runtime, `expo-notifications` detecta la
  // ausencia y retorna token vacío (el backend maneja este caso con
  // `state="pending_deploy"` — ver Iter47).
  const gsf = expo.android?.googleServicesFile;
  if (gsf) {
    const absGsf = path.resolve(__dirname, gsf);
    if (!fs.existsSync(absGsf)) {
      console.warn(
        `[app.config] ${gsf} NO existe — omitiendo googleServicesFile. ` +
          `Push notifications Android estarán deshabilitados hasta que subas ` +
          `el archivo real desde Firebase Console.`,
      );
      const { googleServicesFile: _drop, ...androidSinGsf } = expo.android;
      expo.android = androidSinGsf;
    }
  }

  return { ...appJson, expo };
};
