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
