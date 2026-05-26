# Pixel Padel OS — PRD

## Resumen
Mobile-first Expo (React Native) + FastAPI + MongoDB app para la gestión de torneos de pádel (Retas). Estética premium oscura con acento neon verde pádel `#A3E635`.

## Arquitectura
- **Backend**: FastAPI con MongoDB (Motor async). JWT admin (bcrypt). Cronjobs: recordatorios WhatsApp 2h (mock), expirar bloqueos checkout 5 min, promoción atómica de lista de espera.
- **Frontend**: Expo Router con rutas:
  - `/` — Radar público (GPS opcional, todas las retas si no GPS, filtro 30km con Haversine si GPS).
  - `/retas/[slug]` — Detalle público con Semáforo, formulario de pago / waitlist.
  - `/perfil` — Stats del jugador por teléfono.
  - `/admin/login` — Login admin JWT.
  - `/admin` — Dashboard admin.
  - `/admin/reta/[id]` — Crear (`new`) o editar reta. Botón generar PDF A4 Round Robin.

## Lógica matemática (`backend/logica_torneo.py`)
- **`construir_fecha_local_iso(fecha, hora, tz_offset)`**: ISO con offset explícito (evita desfase UTC).
- **`obtener_distancia_km(lat1,lon1,lat2,lon2)`**: Haversine (km).
- **Round Robin perfecto Wh(8)** (hardcoded validado por backtracking):
  - 7 rondas, 2 partidos/ronda.
  - Ningún jugador repite pareja (1-factorization de K8).
  - Cada par rival exactamente 2 veces.
  - Mismo número de partidos por jugador.
- **`generar_rol_filtrado_8_jugadores(jugadores, num_rondas=5|6|7)`**: trunca preservando balance; experiencia mínima 5 partidos por jugador.
- **`generar_rol_multi_cancha(jugadores, canchas, num_rondas)`**: extiende a N canchas (8 jugadores cada una).

## Modelo de datos (MongoDB)
- `admins` (email único, hashed_password bcrypt).
- `usuarios` (id, nombre, telefono único, nivel, perfil_publico).
- `retas` (id, slug único, fecha_evento ISO con offset, canchas, max_jugadores=8*canchas, modalidad PUNTOS|TIEMPO, num_rondas 5/6/7, logo, observaciones≤140, lat/lng, alertas_enviadas).
- `inscripciones` (estatus_pago: Pendiente|Aprobado|Expirado, bloqueado_hasta ISO).
- `lista_espera` (índice único compuesto reta_id+posicion_fila — anti race-condition).

## Endpoints
Ver `/app/memory/test_credentials.md` para resumen.

## PDF A4 (`backend/pdf_generator.py`)
- reportlab; tabla por cancha con auto-wrap (`wordWrap=CJK`).
- Logo del club (base64 data:image) o placeholder `P·OS`.
- Observaciones del organizador con borde verde pádel.
- Header con nombre, club, fecha, modalidad, rondas, canchas.

## Mocks activos
- **Pagos**: `/api/webhooks/payment` simulado. Frontend confirma el pago auto en demo.
- **WhatsApp Twilio**: si no hay env vars de Twilio, logs en `notifications.py` (envío real activable solo configurando `TWILIO_*`).

## Componentes Frontend
- `TrafficLight` — Semáforo 3-dot con neon glow.
- `RetaCard` — Tarjeta con logo, stats grid, observaciones styled.
- `Button`, `Input` — Sistema de UI consistente.

## Próximos pasos
- Integrar Twilio real (requiere credenciales del usuario).
- Integrar Stripe/Mercado Pago real.
- Importar logo del club desde galería (expo-image-picker → base64).
- Geocoding inverso para auto-llenar lat/lng al crear reta.
