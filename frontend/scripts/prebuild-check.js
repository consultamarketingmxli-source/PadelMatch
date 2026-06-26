#!/usr/bin/env node
/**
 * prebuild-check.js — Auditoría de build-readiness pre-EAS.
 *
 * Reproduce localmente las validaciones que hace `eas build` ANTES de subir
 * el proyecto al servicio de Expo. Detecta los problemas más comunes que
 * causarían un fallo en la nube:
 *
 *   1. Bundle IDs / package names consistentes app.json ↔ EAS ↔ wellknown
 *   2. Permisos declarados para todos los plugins usados
 *   3. Plugins críticos (notifications, ads, splash) tienen sus assets
 *   4. Universal Links / App Links matching de host
 *   5. googleServicesFile existe (warning si es TODO)
 *   6. Plugin de Sentry configurado
 *   7. Variables de entorno EXPO_PUBLIC_* sin valores `placeholder`
 *
 * Uso:
 *   node scripts/prebuild-check.js            # exit 1 si hay errores
 *   node scripts/prebuild-check.js --warn-only # exit 0 siempre, solo reporta
 *
 * Recomendado: ejecutar como `npm run prebuild:check` antes de `eas build`.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const APP_JSON = path.join(ROOT, "app.json");
const EAS_JSON = path.join(ROOT, "eas.json");
const BACKEND_WELLKNOWN = path.resolve(ROOT, "../backend/routers/wellknown.py");

const args = process.argv.slice(2);
const WARN_ONLY = args.includes("--warn-only");

let ERRORS = 0;
let WARNS = 0;

function info(msg) { console.log(`  · ${msg}`); }
function ok(msg)   { console.log(`\x1b[32m  ✔\x1b[0m ${msg}`); }
function warn(msg) { console.log(`\x1b[33m  ⚠\x1b[0m ${msg}`); WARNS++; }
function fail(msg) { console.log(`\x1b[31m  ✖\x1b[0m ${msg}`); ERRORS++; }
function section(title) { console.log(`\n\x1b[1m${title}\x1b[0m`); }

// ── 1. Cargar manifests ──────────────────────────────────────────────────
section("1) Cargar manifests");
let appConfig;
try {
  appConfig = JSON.parse(fs.readFileSync(APP_JSON, "utf8"));
  ok("app.json cargado");
} catch (e) {
  fail(`app.json no se pudo leer: ${e.message}`);
  process.exit(WARN_ONLY ? 0 : 1);
}

let easConfig = null;
if (fs.existsSync(EAS_JSON)) {
  try {
    easConfig = JSON.parse(fs.readFileSync(EAS_JSON, "utf8"));
    ok("eas.json cargado");
  } catch (e) {
    fail(`eas.json mal formado: ${e.message}`);
  }
} else {
  warn("eas.json no existe — ejecuta `eas build:configure` o copia el template.");
}

const expo = appConfig.expo || {};

// ── 2. Bundle ID / package consistency ───────────────────────────────────
section("2) Identificadores únicos");
const iosBundle = expo.ios?.bundleIdentifier;
const androidPkg = expo.android?.package;
if (!iosBundle) fail("ios.bundleIdentifier no definido");
else ok(`iOS bundleIdentifier: ${iosBundle}`);
if (!androidPkg) fail("android.package no definido");
else ok(`Android package: ${androidPkg}`);
if (iosBundle && androidPkg && iosBundle !== androidPkg) {
  warn(`iOS bundle (${iosBundle}) y Android package (${androidPkg}) NO coinciden — válido pero raro; suele esperarse el mismo`);
}

// Cross-check contra el wellknown backend
if (fs.existsSync(BACKEND_WELLKNOWN)) {
  const wk = fs.readFileSync(BACKEND_WELLKNOWN, "utf8");
  const match = wk.match(/ANDROID_PACKAGE\s*=\s*["']([^"']+)["']/);
  if (match && androidPkg && match[1] !== androidPkg) {
    fail(`Package mismatch: app.json="${androidPkg}" vs backend/wellknown.py="${match[1]}". Esto romperá App Links.`);
  } else if (match) {
    ok(`wellknown.py ANDROID_PACKAGE coincide con app.json (${match[1]})`);
  }
  if (/TEAM_ID_TODO/.test(wk)) warn("backend/wellknown.py contiene TEAM_ID_TODO — reemplazar antes de iOS Universal Links.");
  if (/SHA256_FINGERPRINT_TODO/.test(wk)) warn("backend/wellknown.py contiene SHA256_FINGERPRINT_TODO — reemplazar antes de Android App Links.");
} else {
  warn("backend/routers/wellknown.py no se encontró — saltando cross-check");
}

// ── 3. Permisos declarados ───────────────────────────────────────────────
section("3) Permisos Android");
const androidPerms = expo.android?.permissions || [];
const NEEDED_PERMS = [
  "android.permission.POST_NOTIFICATIONS",  // push
  "android.permission.INTERNET",            // siempre necesario
];
for (const p of NEEDED_PERMS) {
  if (androidPerms.includes(p)) ok(`permiso ${p}`);
  else fail(`falta permiso ${p}`);
}

// ── 4. iOS infoPlist usage descriptions ──────────────────────────────────
section("4) iOS infoPlist usage descriptions");
const infoPlist = expo.ios?.infoPlist || {};
if (infoPlist.NSUserNotificationsUsageDescription) {
  ok("NSUserNotificationsUsageDescription presente");
} else {
  warn("falta NSUserNotificationsUsageDescription — App Store puede rechazar push sin esto");
}
if (infoPlist.ITSAppUsesNonExemptEncryption === false) {
  ok("ITSAppUsesNonExemptEncryption=false (declara que no usas crypto export-controlled)");
} else {
  warn("ITSAppUsesNonExemptEncryption NO está como false — App Store pedirá clarificación");
}

// ── 5. Universal Links / App Links ───────────────────────────────────────
section("5) Universal/App Links");
const assocDomains = expo.ios?.associatedDomains || [];
if (assocDomains.length === 0) fail("ios.associatedDomains vacío — Universal Links no funcionarán");
else {
  assocDomains.forEach((d) => ok(`iOS associated domain: ${d}`));
}
const intentFilters = expo.android?.intentFilters || [];
if (intentFilters.length === 0) fail("android.intentFilters vacío — App Links no funcionarán");
else {
  const autoVerified = intentFilters.filter((f) => f.autoVerify);
  if (autoVerified.length === 0) warn("ningún intentFilter tiene autoVerify=true — App Links sin verificar (aún funcionan, pero piden modal al usuario)");
  intentFilters.forEach((f) => {
    const hosts = (f.data || []).map((d) => d.host).join(", ");
    ok(`Android intent filter: ${f.action} hosts=[${hosts}] autoVerify=${!!f.autoVerify}`);
  });
}

// ── 6. Plugins críticos ──────────────────────────────────────────────────
section("6) Plugins críticos");
const plugins = expo.plugins || [];
const pluginNames = plugins.map((p) => Array.isArray(p) ? p[0] : p);
const REQUIRED_PLUGINS = ["expo-router", "expo-notifications"];
for (const p of REQUIRED_PLUGINS) {
  if (pluginNames.includes(p)) ok(`plugin ${p}`);
  else fail(`falta plugin ${p}`);
}

// ── 7. Google Services file (Android push) ───────────────────────────────
section("7) google-services.json (Android push)");
const gsf = expo.android?.googleServicesFile;
if (!gsf) {
  fail("android.googleServicesFile NO declarado — push Android no funcionará");
} else {
  const fullPath = path.resolve(ROOT, gsf);
  if (fs.existsSync(fullPath)) {
    ok(`googleServicesFile encontrado: ${gsf}`);
  } else {
    const todoPath = fullPath + ".TODO";
    if (fs.existsSync(todoPath)) {
      warn(`googleServicesFile referencia ${gsf} pero solo existe el .TODO. Sube el real de Firebase Console antes de build de producción.`);
    } else {
      fail(`googleServicesFile referenciado pero archivo ${gsf} no existe`);
    }
  }
}

// ── 8. Sentry plugin ─────────────────────────────────────────────────────
section("8) Sentry");
const sentryPlugin = plugins.find((p) => Array.isArray(p) && p[0] === "@sentry/react-native/expo");
if (sentryPlugin) ok("Sentry plugin configurado");
else warn("Sentry plugin no configurado — fallos en prod no se reportarán");

// ── 9. Variables EXPO_PUBLIC_* sin placeholders ─────────────────────────
section("9) Variables de entorno (placeholders prohibidos en producción)");
if (easConfig && easConfig.build && easConfig.build.production && easConfig.build.production.env) {
  const env = easConfig.build.production.env;
  Object.entries(env).forEach(([k, v]) => {
    if (typeof v === "string" && /placeholder|TODO|REEMPLAZAR/i.test(v)) {
      fail(`production.env.${k} contiene placeholder: "${v}"`);
    } else {
      ok(`production.env.${k} = ${v}`);
    }
  });
} else {
  warn("eas.json no tiene build.production.env — recomendado declarar EXPO_PUBLIC_BACKEND_URL");
}

// ── 10. App icons & splash ──────────────────────────────────────────────
section("10) Assets críticos");
const REQUIRED_ASSETS = [
  expo.icon,
  expo.ios?.icon?.light,
  expo.android?.adaptiveIcon?.foregroundImage,
  expo.web?.favicon,
].filter(Boolean);
for (const asset of REQUIRED_ASSETS) {
  const full = path.resolve(ROOT, asset);
  if (fs.existsSync(full)) ok(`asset ok: ${asset}`);
  else fail(`asset faltante: ${asset}`);
}

// ── Resumen ──────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(64));
if (ERRORS > 0) {
  console.log(`\x1b[31m✖ ${ERRORS} error(es) · ${WARNS} warning(s)\x1b[0m`);
  console.log("  Corrige los errores antes de ejecutar `eas build --profile production`.");
  process.exit(WARN_ONLY ? 0 : 1);
} else if (WARNS > 0) {
  console.log(`\x1b[33m⚠ ${WARNS} warning(s) — build posible, revisar antes de submit a stores\x1b[0m`);
  process.exit(0);
} else {
  console.log("\x1b[32m✔ Build-readiness: PASS · todo listo para `eas build`\x1b[0m");
  process.exit(0);
}
