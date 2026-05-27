# 🚀 Guía de Transición a Producción (LIVE) — PadelappRetas

> **Última actualización:** Junio 2025
> **Audiencia:** Owner / DevOps. Sigue esta guía paso a paso ANTES de hacer click en **Publish** desde el panel de Emergent.

---

## 📋 Resumen ejecutivo

PadelappRetas funciona hoy en modo **Sandbox/Test** con credenciales de prueba. Para procesar **dinero real**, debes:

1. Obtener credenciales **LIVE** de cada proveedor (Stripe, Twilio, Mercado Pago, Resend/SendGrid).
2. Reemplazar las variables de entorno en el panel de Emergent → **Publish → Environment Variables**.
3. Configurar webhooks productivos apuntando a la URL pública definitiva.
4. Verificar el flujo end-to-end con una compra real de bajo monto.

**⚠️ NO modifiques `/app/backend/.env` directamente.** Esos valores son para development local. Las variables de producción se inyectan vía panel de Emergent.

---

## 🔐 Variables que DEBEN cambiar a LIVE

Copia esta tabla. Para cada fila, marca ✅ cuando hayas actualizado el valor en Emergent Publish:

| # | Variable | Valor TEST actual | Valor LIVE esperado | Dónde obtenerlo |
|---|----------|-------------------|---------------------|-----------------|
| 1 | `STRIPE_API_KEY` | `sk_test_...` | `sk_live_...` | https://dashboard.stripe.com/apikeys |
| 2 | `STRIPE_WEBHOOK_SECRET` | (no seteado) | `whsec_...` | https://dashboard.stripe.com/webhooks |
| 3 | `TWILIO_ACCOUNT_SID` | `AC45d68b...` | `AC` + nuevo SID prod | https://console.twilio.com/ → Account → API Keys |
| 4 | `TWILIO_AUTH_TOKEN` | `2d44f1c...` | nuevo token prod | misma página |
| 5 | `TWILIO_WHATSAPP_FROM` | `whatsapp:+14155238886` (sandbox) | `whatsapp:+<tu_numero_aprobado>` | Twilio → WhatsApp Senders aprobados |
| 6 | `TWILIO_JOIN_CODE` | `join busy-crack` | **eliminar** | (sandbox-only, ya no aplica) |
| 7 | `MP_CLIENT_ID` | `7849343570174391` | tu Client ID PROD app | https://www.mercadopago.com.mx/developers/panel/app |
| 8 | `MP_PUBLIC_KEY` | `APP_USR-...` (test) | `APP_USR-...` (PROD) | misma página, sección "Credenciales productivas" |
| 9 | `MP_CLIENT_SECRET` | (configurar si usas OAuth) | `APP_USR-secret-...` | misma página |
| 10 | `APP_PUBLIC_URL` | `https://padelreta.preview.emergentagent.com` | `https://app.padelappretas.com` (tu dominio final) | Emergent te lo asigna al deployar |
| 11 | `JWT_SECRET` | dev value | string aleatorio ≥ 64 chars | `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| 12 | `CORS_ORIGINS` | `*` | `https://app.padelappretas.com,https://padelappretas.com` | tus dominios web finales |
| 13 | `EMAIL_PROVIDER` | (no seteado) | `resend` o `sendgrid` | — |
| 14 | `EMAIL_API_KEY` | (no seteado) | `re_...` o `SG....` | https://resend.com/api-keys o https://app.sendgrid.com/settings/api_keys |
| 15 | `EMAIL_FROM` | (no seteado) | `PadelappRetas <no-reply@padelappretas.com>` | dominio verificado en Resend/SendGrid |
| 16 | `EMAIL_REPLY_TO` | (opcional) | `soporte@padelappretas.com` | tu email de soporte |

**⛔ NO TOQUES** estas variables (las inyecta Emergent):
- `MONGO_URL` — la BD productiva la asigna Emergent.
- `DB_NAME` — la asigna Emergent.
- `EXPO_PACKAGER_PROXY_URL`, `EXPO_PACKAGER_HOSTNAME`, `EXPO_TUNNEL_SUBDOMAIN`.
- `EMERGENT_LLM_KEY` (si lo usas para alguna integración LLM).

---

## 1️⃣ Stripe — Pasar de TEST a LIVE

### Pre-requisitos
- Cuenta Stripe **activada** (Settings → Business → Submitted documents → Activated).
- Cuenta bancaria conectada para retiros (Settings → Payouts).

### Pasos
1. Ve a https://dashboard.stripe.com/apikeys, asegúrate de que el toggle superior diga **"Viewing live data"**.
2. Copia la **Publishable key** y **Secret key** (esta última empieza con `sk_live_`).
3. Pega `sk_live_...` como nuevo valor de `STRIPE_API_KEY` en Emergent Publish.
4. **Webhook productivo:**
   - Dashboard → Developers → Webhooks → **Add endpoint**
   - Endpoint URL: `https://<tu-dominio-final>/api/webhooks/stripe`
   - Events: marca `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`.
   - **Click "Reveal signing secret"** → copia `whsec_...`.
   - Pega como valor de `STRIPE_WEBHOOK_SECRET` en Emergent Publish.

### Verificación
- Una vez deployado, haz una compra de prueba con una tarjeta real de bajo monto (ej: $10 MXN).
- Verifica que el evento aparezca en Stripe Dashboard → Events.
- Verifica que la inscripción pase de "Pendiente" a "Aprobado" automáticamente.

---

## 2️⃣ Twilio WhatsApp — Pasar del Sandbox al número aprobado

### Pre-requisitos
- Cuenta Twilio productiva (no trial).
- **Número WhatsApp Business aprobado por Meta** (proceso de ~3-7 días hábiles vía Twilio Console → Messaging → Senders → Request WhatsApp Sender).
- Templates de mensaje aprobados (Twilio Console → Messaging → Content templates) — necesarios para enviar notificaciones fuera de la ventana de 24h.

### Pasos
1. Ve a https://console.twilio.com/ → **Account → API Keys & Tokens**.
2. Crea un nuevo **Auth Token** productivo o usa el principal.
3. Copia `Account SID` y `Auth Token`.
4. Actualiza en Emergent Publish:
   - `TWILIO_ACCOUNT_SID` → tu nuevo SID prod
   - `TWILIO_AUTH_TOKEN` → tu nuevo token prod
   - `TWILIO_WHATSAPP_FROM` → `whatsapp:+<tu_numero_aprobado>` (sin espacios, con `+` y código país)
   - **Elimina** `TWILIO_JOIN_CODE` (solo aplica al sandbox).

### Verificación
- Envía una notificación de prueba (ej: promover waitlist) y confirma que llegue desde tu número productivo.
- Revisa Twilio Console → Monitor → Logs por errores 63016 (template no aprobado) o 21408 (número no autorizado).

---

## 3️⃣ Mercado Pago Marketplace — Activar credenciales LIVE

### Importante
PadelappRetas opera como **Marketplace**. Cada **organizador** conecta su propia cuenta MP vía OAuth en `/admin/mercadopago/connect`. La plataforma (tú) solo necesita los datos de la **app**:

### Pasos
1. Ve a https://www.mercadopago.com.mx/developers/panel/app y selecciona tu app.
2. **Sección "Credenciales productivas":**
   - Copia el `Client ID` → variable `MP_CLIENT_ID`.
   - Copia el `Public Key` (empieza con `APP_USR-...`) → variable `MP_PUBLIC_KEY`.
   - Copia el `Client Secret` → variable `MP_CLIENT_SECRET` (si usas el flow OAuth completo).
3. **Webhook productivo:**
   - Sección "Webhooks" → Edit URLs
   - URL de notificación: `https://<tu-dominio-final>/api/webhooks/mercadopago`
   - Eventos: `payment`, `merchant_order`.

### Verificación de organizadores
- Los organizadores deben **re-conectar** sus cuentas MP en producción (los Access Tokens de test NO sirven en prod).
- Comunícate con cada admin para que entre a `/admin/mercadopago/connect` y pegue su Access Token productivo.

### Verificación de pago
- Crea una reta de prueba con costo $10 MXN.
- Compra desde una cuenta real (no test).
- Confirma que el dinero llegue a la cuenta del organizador (100%) en su panel MP.
- Si activaste `apply_fee=true`, confirma que el 10% se quede en tu cuenta principal.

---

## 4️⃣ Email Transaccional — Activar Resend o SendGrid

### Opción A: Resend (recomendado, simpler)
1. Crea cuenta gratis en https://resend.com (sin tarjeta requerida).
2. **Verifica tu dominio:**
   - Dashboard → Domains → Add Domain → `padelappretas.com`
   - Agrega los 3 registros DNS (TXT, MX, DKIM) que te indique Resend.
   - Espera la verificación (~5-30 min).
3. Settings → API Keys → Create API Key (full access) → copia `re_...`.
4. Configura en Emergent Publish:
   - `EMAIL_PROVIDER=resend`
   - `EMAIL_API_KEY=re_xxxxxxxxxxxxx`
   - `EMAIL_FROM=PadelappRetas <no-reply@padelappretas.com>`
   - `EMAIL_REPLY_TO=soporte@padelappretas.com`

### Opción B: SendGrid
1. https://signup.sendgrid.com → cuenta gratis (100 emails/día).
2. Settings → **Sender Authentication** → autentica tu dominio (DKIM + SPF).
3. Settings → **API Keys** → Create API Key con permiso `Mail Send` → copia `SG....`.
4. Configura en Emergent Publish:
   - `EMAIL_PROVIDER=sendgrid`
   - `EMAIL_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxx`
   - `EMAIL_FROM=PadelappRetas <no-reply@padelappretas.com>`

### Verificación
- Haz una compra real → confirma que llegue el email "Inscripción confirmada".
- Revisa el dashboard de Resend/SendGrid → debería aparecer el email como "Delivered".
- Si va a SPAM: verifica que SPF + DKIM + DMARC estén configurados correctamente en tu DNS.

---

## 5️⃣ Deep Linking — Universal Links / App Links (post-build)

El scheme `padelappretas://` ya está configurado en `app.json`. Para que MP/Stripe re-abran la app nativa después del pago:

### iOS (Universal Links)
1. Generar `apple-app-site-association` y colocarlo en `https://app.padelappretas.com/.well-known/apple-app-site-association`.
2. Configurar `associatedDomains: ["applinks:app.padelappretas.com"]` en `app.json` antes de generar build.

### Android (App Links)
1. Generar `assetlinks.json` y colocarlo en `https://app.padelappretas.com/.well-known/assetlinks.json`.
2. Configurar `intentFilters` con `autoVerify: true` en `app.json`.

**⚠️ Esto solo aplica si quieres que los links de email/SMS abran la app nativa en vez del browser. Para web, el flujo actual ya funciona.**

---

## 🔒 Checklist final pre-Publish

- [ ] Todas las 16 variables LIVE configuradas en Emergent Publish.
- [ ] `JWT_SECRET` rotado a un valor aleatorio nuevo (≥ 64 caracteres).
- [ ] `CORS_ORIGINS` restringido a tus dominios reales (sin `*`).
- [ ] Stripe webhook configurado con `whsec_...` real.
- [ ] MP webhook configurado a la URL de producción.
- [ ] Twilio WhatsApp number aprobado y templates listos.
- [ ] Dominio email verificado en Resend o SendGrid.
- [ ] Probaste una compra real de bajo monto end-to-end:
  - [ ] Stripe → pago → email confirmación → inscripción "Aprobado".
  - [ ] MP → pago → email confirmación → inscripción "Aprobado".
- [ ] Backup de la BD configurado (mongodump diario).
- [ ] Plan de rollback: tienes los valores TEST guardados por si algo sale mal.

---

## 🆘 Troubleshooting común

| Síntoma | Causa probable | Fix |
|---------|----------------|-----|
| Stripe webhook devuelve 400 "Webhook inválido" | `STRIPE_WEBHOOK_SECRET` no coincide | Re-copiar el `whsec_...` exacto desde Stripe Dashboard |
| MP webhook no llega | URL incorrecta en panel MP | Revisar que termine en `/api/webhooks/mercadopago` |
| Email no llega | Dominio no verificado | Verificar DKIM/SPF en DNS, esperar propagación |
| WhatsApp 63016 | Template no aprobado | Crear template en Twilio Content Editor y esperar aprobación Meta |
| 502 Bad Gateway en checkout MP | Organizador desconectado | Admin debe re-conectar su Access Token en `/admin/mercadopago/connect` |

---

## 📞 Soporte

- **Stripe:** https://support.stripe.com
- **Mercado Pago Devs:** https://www.mercadopago.com.mx/developers/es/support
- **Twilio:** https://help.twilio.com
- **Resend:** support@resend.com
- **SendGrid:** https://support.sendgrid.com

---

_Generado automáticamente. Mantén este documento actualizado cada vez que agregues nuevas integraciones._
