/**
 * app.config.js — Wrapper dinámico sobre `app.json`.
 * ─────────────────────────────────────────────────────────────────────────
 * Este archivo lo lee `expo` en cada build/dev-server. Sirve para inyectar
 * lógica condicional que un `app.json` estático no puede expresar.
 *
 * Uso actual (Iter52-Publish · Android-first):
 *   • Guarda 1: Omite `android.googleServicesFile` cuando el archivo real
 *     todavía no está subido (sólo existe `google-services.json.TODO`).
 *     Sin esta guarda, `eas build --profile preview --platform android`
 *     falla con `Cannot find module 'google-services.json'`.
 *
 *   • Guarda 2: Deshabilita el plugin `@sentry/react-native/expo` cuando
 *     `SENTRY_AUTH_TOKEN` no está presente en el entorno de build. El plugin
 *     inyecta la tarea de Gradle `SentryUpload` que intenta subir sourcemaps
 *     al servidor de Sentry — sin token, el build de Android falla con
 *     `error: Auth token is required for this request. Please run
 *     sentry-cli login and try again!`. Al remover el plugin, el build
 *     omite ese paso completamente. Sentry runtime (JS `Sentry.init(...)`)
 *     sigue funcionando normalmente para error tracking; sólo perdemos la
 *     capacidad de resolver sourcemaps en el dashboard hasta que el usuario
 *     configure `SENTRY_AUTH_TOKEN` como secret en EAS.
 *
 * Filosofía: `app.json` sigue siendo la fuente de verdad declarativa. Este
 * archivo sólo hace ajustes MÍNIMOS y DOCUMENTADOS.
 */
/* global __dirname, process */
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

  // ═════════ Guarda 2: Sentry plugin condicional ═════════
  // El plugin `@sentry/react-native/expo` agrega la tarea Gradle
  // `createBundleReleaseJsAndAssets_SentryUpload` durante el build de
  // Android, que requiere `SENTRY_AUTH_TOKEN`. Si el token no está
  // disponible, removemos el plugin para que el build no falle.
  const sentryAuthToken =
    process.env.SENTRY_AUTH_TOKEN || process.env.EXPO_PUBLIC_SENTRY_AUTH_TOKEN;
  if (!sentryAuthToken || sentryAuthToken.trim() === "") {
    if (Array.isArray(expo.plugins)) {
      const before = expo.plugins.length;
      expo.plugins = expo.plugins.filter((p) => {
        const name = Array.isArray(p) ? p[0] : p;
        return name !== "@sentry/react-native/expo";
      });
      if (expo.plugins.length < before) {
        console.warn(
          `[app.config] SENTRY_AUTH_TOKEN ausente — plugin ` +
            `'@sentry/react-native/expo' deshabilitado. Sourcemaps NO se ` +
            `subirán a Sentry en este build. Sentry runtime (error ` +
            `tracking en la app) sigue funcionando. Para habilitar upload ` +
            `de sourcemaps, configurá SENTRY_AUTH_TOKEN como secret en EAS.`,
        );
      }
    }
  } else {
    console.log(
      "[app.config] SENTRY_AUTH_TOKEN detectado — sourcemap upload habilitado.",
    );
  }

  return { ...appJson, expo };
};
