# PadelAppRetas — Production Activation Backlog

Este documento centraliza los TODOs de **activación a producción** para las
integraciones que actualmente operan en modo simulación/sandbox.

Cada item es independiente. Cuando se obtengan las credenciales reales, basta
con seguir los pasos indicados — el código ya está preparado para detectarlas
y activarse automáticamente.

---

## 🛡️ 1) Sentry Source Maps (deobfuscación de stack traces TypeScript)

**Estado actual:** Sentry SDK ya inyectado (frontend `@sentry/react-native/expo`
en `app.json` líneas 55-62 + backend `SENTRY_DSN` en `.env`). Los errores se
reportan al dashboard pero los stack traces salen **minified** (sin nombres de
variables ni líneas legibles).

**Pasos para activar:**

1. Generar y subir source maps cada vez que se publique un build:
   ```bash
   cd /app/frontend
   npx sentry-expo-upload-sourcemaps \
     --organization padelappretas \
     --project padelappretas-mobile \
     --auth-token $SENTRY_AUTH_TOKEN
   ```
2. Obtener `SENTRY_AUTH_TOKEN` desde:
   `https://sentry.io/settings/account/api/auth-tokens/`
   con scope `project:releases` + `project:write`.
3. Agregarlo a las CI/CD secrets (no en `.env` versionado).
4. **Opcional:** integrar en el pipeline de `eas build` con un hook
   `expo.hooks.postPublish` o ejecutar manualmente tras cada release.

**Verificación:** Tras la primera subida, los nuevos issues en Sentry deben
mostrar el TypeScript original (no JS minified).

---

## 💎 2) RevenueCat (Monetización IAP — Premium de Por Vida)

**Estado actual:** El store `userPlanStore.tsx` opera en modo SIMULACIÓN. La
función `simulatePurchase()` activa Premium localmente. El SDK
`react-native-purchases` está cargado con lazy-require dentro de try/catch
para evitar crashes cuando no hay key.

**Pasos para activar:**

1. Crear cuenta y proyecto en https://app.revenuecat.com
2. Registrar app iOS (Bundle ID) + Android (package name) en RevenueCat
3. Crear producto IAP **único, no-renovable**:
   - **Product ID:** `padelappretas_premium_lifetime`
   - **App Store Connect:** Non-Consumable, $349 MXN
   - **Play Console:** One-time purchase (managed product), $349 MXN
4. En RevenueCat dashboard:
   - Asociar SKUs iOS/Android al producto
   - Crear **entitlement** `premium_access` y asociarlo al producto
5. Copiar las API keys públicas a `/app/frontend/.env`:
   ```env
   EXPO_PUBLIC_REVENUECAT_API_KEY_IOS=appl_xxxxxxxxxxxx
   EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID=goog_xxxxxxxxxxxx
   ```
6. Hacer rebuild nativo con EAS (Expo Go NO permite IAP):
   ```bash
   eas build --platform all --profile production
   ```

**Verificación:** Al abrir la app post-build, `simulationMode` debe ser
`false` y `purchasePremium()` debe lanzar el sheet nativo de IAP (iOS) o el
Play Store overlay (Android).

**Código relevante:** `/app/frontend/src/stores/userPlanStore.tsx` líneas
53-82 (`initRevenueCatSafely`).

---

## 🔔 3) Emergent-managed Push Notifications

**Estado actual:** Servicio `services/push_service.py` operativo. Cuando
`EMERGENT_PUSH_KEY=placeholder` (estado actual) → modo no-op silencioso (logs
informativos, sin envío real).

**Pasos para activar:** Esto se hace **automáticamente** en el flujo de
deploy de Emergent — el placeholder es reemplazado por la key real al
publicar. No requiere acción manual.

**Requisito:** Para Android, el usuario debe proveer `google-services.json`
desde Firebase Console antes de generar el build.

---

## 💸 4) MercadoPago (Marketplace OAuth — Producción)

**Estado actual:** OAuth completamente implementado en
`routers/mercadopago.py`. Soporta multi-organizador con tokens encriptados
at-rest (Fernet). Funciona en sandbox.

**Pasos para activar producción:**

1. Migrar `MP_CLIENT_ID` y `MP_CLIENT_SECRET` de sandbox a producción desde:
   https://www.mercadopago.com.mx/developers/panel/credentials
2. Actualizar `APP_PUBLIC_URL` al dominio final (debe coincidir con el
   redirect_uri registrado en el panel MP).
3. Reconectar cada organizador vía OAuth (los tokens sandbox no migran).

---

## 📧 5) Resend (Emails Transaccionales)

**Estado actual:** ✅ Activo. Key real en `.env`
(`RESEND_API_KEY=re_YQ9nA3Mn...`). Sólo pendiente validar dominio
personalizado:

**Mejora opcional:** Actualizar `RESEND_FROM_EMAIL` de
`onboarding@resend.dev` a un dominio propio (ej. `notificaciones@padelappretas.app`)
una vez que el DNS esté configurado en https://resend.com/domains.

---

## 📊 Roadmap

| # | Tarea                          | Bloqueador                    | Estimación |
|---|--------------------------------|-------------------------------|-----------:|
| 1 | Sentry Source Maps             | Sentry Auth Token             |       30m  |
| 2 | RevenueCat Producción          | App Store + Play Console live |        4h  |
| 3 | Push Emergent                  | Deploy (automático)           |   auto     |
| 4 | MP Producción                  | Validación KYC MP             |        2h  |
| 5 | Resend dominio propio          | Acceso al DNS del dominio     |        1h  |
| 6 | Ingress `/.well-known/*` route | Config K8s producción         |       30m  |
| 7 | iOS TEAM_ID + Android SHA256   | Cuenta Apple Dev + keystore   |        1h  |

---

## 🔗 6) Ingress Routing para Universal/App Links (CRÍTICO antes de stores)

**Estado actual:** Los endpoints `/.well-known/apple-app-site-association` y
`/.well-known/assetlinks.json` están **correctamente servidos por el backend
FastAPI** (testeado con 200 OK + JSON válido en localhost:8001).

⚠️  **Problema en producción:** El ingress K8s actual sólo enruta `/api/*` al
backend. Cuando Apple/Google intenten verificar los archivos en
`https://padelappretas.app/.well-known/*`, recibirán el HTML del frontend Expo
en lugar del JSON del backend → **Universal Links / App Links se desactivan
silenciosamente**.

**Pasos para activar:**

1. Editar el manifest del Ingress (o `nginx.conf` si es bare-metal):
   ```yaml
   - path: /.well-known/
     pathType: Prefix
     backend:
       service:
         name: backend
         port:
           number: 8001
   ```
2. Aplicar el cambio (`kubectl apply -f ingress.yaml`).
3. Verificar tras deploy:
   ```bash
   curl -i https://padelappretas.app/.well-known/apple-app-site-association
   # → 200 + Content-Type: application/json + {"applinks": ...}
   curl -i https://padelappretas.app/.well-known/assetlinks.json
   # → 200 + JSON con package_name=com.padelappretas.app
   ```
4. Apple cachea el AASA por 24h. Si necesitas forzar revalidación, usar
   `https://app-site-association.cdn-apple.com/a/v1/padelappretas.app`.

---

## 🍎 7) iOS TEAM_ID + Android SHA-256 Fingerprints

**Estado actual:** `/app/backend/routers/wellknown.py` tiene placeholders:
- `IOS_TEAM_ID = "TEAM_ID_TODO"`
- `ANDROID_SHA256_FINGERPRINTS = ["SHA256_FINGERPRINT_TODO_REPLACE_AFTER_BUILD"]`

**Pasos:**

### iOS TEAM_ID
1. Inscribirse en https://developer.apple.com/programs (USD 99/año).
2. Account → Membership → copiar `Team ID` (10 chars alfanuméricos).
3. Editar `wellknown.py` línea 23: `IOS_TEAM_ID = "ABC123XYZ4"`.
4. Re-deploy backend.

### Android SHA-256 (uno por keystore)
1. **Para builds locales / debug:**
   ```bash
   keytool -list -v -keystore ~/.android/debug.keystore \
     -alias androiddebugkey -storepass android -keypass android \
     | grep SHA256
   ```
2. **Para builds release (Play App Signing):**
   - Play Console → tu app → Configuración → Integridad de la app → App signing.
   - Copiar el `SHA-256 certificate fingerprint`.
3. Agregar a `ANDROID_SHA256_FINGERPRINTS` (mantener AMBOS — debug + release
   permite testear App Links en builds internos sin re-deploy).
4. Re-deploy backend.

**Validación:** El `Android App Links Assistant` en Android Studio
(`Tools → App Links Assistant → Test App Links`) confirmará la verificación.
