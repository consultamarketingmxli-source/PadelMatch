#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Fase A — Retas Gratis / Entre Amigos (RSVP).
  Activar tipo_acceso="gratis_amigos" en el wizard de creación.
  En el landing público /retas/{slug}, si la reta es gratis_amigos:
    - Ocultar Stripe/MP/Cupón
    - Mostrar tarjeta "Evento gratuito · sin cargo" + inputs nombre/teléfono
    - Botones grandes: Aceptar (emerald-600) y Rechazar (slate outline)
    - Estados post-respuesta: aceptado, lista_espera (con posición), rechazado
  En el admin /admin/reta/inscripciones/{id}, si la reta es gratis_amigos:
    - Vista de "Asistencia" en 3 columnas (Confirmados / Lista de espera / Pendientes)
    - Botones de override manual entre columnas
    - Si hay rechazados, columna extra de auditoría con opción "Reactivar"
    - Banner verde con contadores totales
  Backend endpoints ya implementados y probados:
    - POST /api/public/retas/{id}/rsvp/aceptar
    - POST /api/public/retas/{id}/rsvp/rechazar
    - GET  /api/admin/retas/{id}/asistencia
    - PATCH /api/admin/inscripciones/{id}/estatus

backend:
  - task: "RSVP — Retas Gratis / Entre Amigos (Fase A)"
    implemented: true
    working: true
    file: "/app/backend/routers/rsvp.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: "Router con 2 endpoints públicos (POST /aceptar, POST /rechazar) y 2 admin (PATCH /inscripciones/{id}/estatus, GET /retas/{id}/asistencia). Atomicidad con reservar_lugar_atomico. Lista de espera automática cuando llena. Promoción al rechazar. Idempotencia por teléfono. 4/4 tests E2E pasaron en sesión previa."

  - task: "Hybrid Search endpoint /api/public/retas/buscar"
    implemented: true
    working: true
    file: "/app/backend/routers/public.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Endpoint ya implementado y probado manualmente con script bash en la sesión anterior. Acepta q (texto), lat/lng/radio_km (Haversine), sin params → todas ordenadas por fecha_evento ASC. Índices de texto en `nombre` y `club` ya creados en db.py."

frontend:
  - task: "RSVP Public UI on /retas/[slug] (Fase A)"
    implemented: true
    working: true
    file: "/app/frontend/app/retas/[slug].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Conditional rendering basado en reta.tipo_acceso === 'gratis_amigos'. Oculta Stripe/MP/Cupón. Muestra tarjeta verde 'Evento gratuito · sin cargo', inputs nombre+teléfono, botones Aceptar (emerald-600 grande) y Rechazar (slate outline). 3 estados post-respuesta: aceptado (PartyPopper), lista_espera (Hourglass amber + badge posición), rechazado (XCircle). Botón 'Cambiar respuesta' resetea estado. testIDs: rsvp-card, rsvp-nombre-input, rsvp-telefono-input, rsvp-aceptar-btn, rsvp-rechazar-btn, rsvp-reset-btn, rsvp-state-aceptado|lista_espera|rechazado. Stat Costo muestra 'Gratis' en lugar de '$0'. Validado E2E con screenshots: Aceptar incrementa 0/8 → 1/8 + semáforo amarillo, Rechazar de un usuario NO-aceptado solo registra rechazo sin alterar cupo."

  - task: "Admin Attendance View 3-Column for gratis_amigos (Fase A)"
    implemented: true
    working: true
    file: "/app/frontend/app/admin/reta/inscripciones/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Refactor del screen Inscripciones a vista dual: si tipo_acceso='gratis_amigos' fetcheo GET /admin/retas/{id}/asistencia y renderizo 3 secciones tipo Trello (Confirmados verde / Lista de espera amber / Pendientes slate) + 4ª columna Rechazados (auditoría) si hay registros. Cada PersonRow tiene botones de override manual usando PATCH /admin/inscripciones/{id}/estatus. Banner verde top muestra '{n}/{max} confirmados' y contadores. Si NO es gratis_amigos, mantiene el flujo legacy con FlatList + botón Reembolsar. Validado E2E: vista admin muestra 1/8 confirmados, Andrés Test con chips [Lista de espera, Rechazar]. Empty states informativos por columna."

  - task: "Hybrid Search UI integration in index.tsx"
    implemented: true
    working: true
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Integración completa: SearchBar con debounce 350ms, toggle GPS con timeout duro 6s, Toast con tone warn para permisos denegados, subtítulo contextual que cambia entre 'Radar activo', 'Sin GPS', 'Todas las retas'. Screenshots manuales muestran los 3 estados funcionando."
  - task: "SearchBar component with pulse animation"
    implemented: true
    working: true
    file: "/app/frontend/src/components/SearchBar.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Componente con icono Search + TextInput + botón GPS con halo animado (pulse loop) cuando activo. Animación se detiene al cambiar a idle/denied."
  - task: "Toast component cross-platform"
    implemented: true
    working: true
    file: "/app/frontend/src/components/Toast.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Toast minimalista con fade-in/translate, autodismiss a 2.5s, tres tonos: info/warn/error."

  - task: "Live Leaderboard /retas/[slug]/tabla (Fase C)"
    implemented: true
    working: true
    file: "/app/frontend/app/retas/[slug]/tabla.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: false
          agent: "main"
          comment: "Bug crítico encontrado: usaba `ppStorage.getItem` (undefined). Corregido a `storage.secureGet<string>(ADMIN_TOKEN_KEY, '')` para usar SecureStore correctamente."
        - working: true
          agent: "main"
          comment: "Fix aplicado. Empty state + indicador EN VIVO + WebSocket Conectado renderean correctamente. Pantalla carga sin errores en preview web."
  - task: "Mesa de Control en Vivo /admin/reta/resultados/[id] (Fase C)"
    implemented: true
    working: true
    file: "/app/frontend/app/admin/reta/resultados/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "UI con tabs por cancha, ScoreStepper +/-, Empate (TIEMPO), banner ámbar de validación, guardar/eliminar. CourtLinesBackground + PadelPalaIcon aplicados."
  - task: "Club Pro Clean v2 login split-screen /admin/login"
    implemented: true
    working: true
    file: "/app/frontend/app/admin/login.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Hero layout con foto premium de raqueta + cancha, card login flotante, credenciales demo visibles. Screenshots mobile y desktop validan diseño."
  - task: "Drag & Drop Distribución de Jugadores por Cancha"
    implemented: true
    working: true
    file: "/app/frontend/app/admin/reta/jugadores/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: "Pantalla con react-native-draggable-flatlist. Long-press + arrastrar mueve jugadores entre canchas. Headers sticky por cancha (Cancha 1, Cancha 2, etc). Banner amber de bloqueo cuando hay resultados ya capturados. Footer fijo con Deshacer y Guardar distribución. Optimistic UI con revert ante error. Validado E2E: 5/5 tests pasaron (orden cronológico, PUT con orden manual, GET respeta orden, captura resultado, PUT 409 cuando hay resultados)."
  - task: "Backend endpoint PUT /api/retas/{id}/jugadores/orden"
    implemented: true
    working: true
    file: "/app/backend/routers/resultados.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: "Persiste jugadores_orden_manual en reta. Helper _resolver_jugadores_de_reta refactorizado del get_rol. Validaciones: lista debe ser strings (422), sin duplicados (422), 1:1 con aprobados (422), 409 si hay resultados capturados. Tests curl 100% OK."
  - task: "Backend endpoint POST /api/retas/{id}/rol/preview"
    implemented: true
    working: true
    file: "/app/backend/routers/resultados.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Genera rol Round Robin para un orden tentativo SIN persistir. Validaciones: strings, sin duplicados. Rellena con placeholders si faltan plazas. Devuelve is_preview=true. Tests curl OK."
  - task: "Vista Previa del Rol (Modal en pantalla de Drag & Drop)"
    implemented: true
    working: true
    file: "/app/frontend/app/admin/reta/jugadores/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: "Modal full-screen con ScrollView muestra Cancha → Rondas → Partidos (Pareja A vs Pareja B). Auto-refresh con debounce 200ms cuando se abre o cambia jugadores. Race-condition guard con previewReqIdRef. Subtítulo dinámico: 'Sin guardar' vs 'Guardado'. Screenshot mostró rondas 1-5 perfectamente con 8 jugadores reales. Botón testID jugadores-preview en footer. 22/22 tests pasaron en iter 11."
  - task: "Importación masiva de jugadores (paste CSV)"
    implemented: true
    working: true
    file: "/app/frontend/src/components/ImportarJugadoresModal.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Backend POST /api/retas/{id}/inscripciones/import con validaciones: cupo, duplicados (Set normalizado lowercase), nombre min/max chars, 409 si hay resultados capturados. Frontend modal con TextInput multiline, parser CSV propio (coma/tab/punto-coma + skip headers genéricos), preview de items parseados, vista de resultado con creadas + omitidos por razón (YA INSCRITO/CUPO LLENO/NOMBRE INVÁLIDO). Validado E2E con screenshots: paste 5 jugadores nuevos OK + paste con duplicados → 4 omitidos correctos. Botón Importar en topBar de /admin/reta/inscripciones/[id] con testID import-open. Modal testIDs: import-textarea, import-submit, import-close, import-done."
  - task: "Backend endpoint POST /api/retas/{id}/inscripciones/import"
    implemented: true
    working: true
    file: "/app/backend/routers/retas.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: true
          agent: "main"
          comment: "Pydantic models ImportJugadorItem/ImportJugadoresBody. Validaciones: lista vacía → 422, >1000 items → 422, resultados capturados → 409, duplicados case-insensitive (existentes + dentro del lote). Marca docs con via_import=true para trazabilidad. Tests curl 3/3 OK."

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 2
  run_ui: true

test_plan:
  current_focus:
    - "Módulo Clubes Inteligente — backend (Enriquecimiento Silencioso + Geoproximidad)"
    - "Módulo Clubes Inteligente — frontend Admin (<ClubAutocomplete /> + debounce + GPS timeout)"
    - "Módulo Clubes Inteligente — frontend Player (Deep Link Google Maps chip MAPA)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

backend_v2:
  - task: "Fase C — Matriz de Blindaje (rondas cerradas + late-fill)"
    implemented: true
    working: true
    file: "/app/backend/core/helpers.py + /app/backend/routers/soporte.py + /app/backend/routers/rsvp.py + /app/backend/tests/test_fase_c_blindaje.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: "Iter23 5/5 PASS. Nuevo helper assert_reta_no_cerrada (buffer 6h) en core/helpers.py. Aplicado en RSVP aceptar, PATCH inline edit, confirmar-manual → todos devuelven 403 con mensaje claro 'Esta reta ya finalizó (hace más de 6 h)'. Late-fill detectado en frontend con captura de lleno PRE-tap → mensaje 'La reta se acaba de llenar mientras escribías'. Tests retas-futuras siguen funcionando (no false-positives). Total backend: 43/43 sin regresiones (incluye 5 Fase C + 14 Fase B + 13 Clubes + 11 RSVP)."

  - task: "Fase B — Soporte Integral y Operaciones en Vivo"
    implemented: true
    working: true
    file: "/app/backend/routers/soporte.py + /app/backend/models.py + /app/backend/tests/test_fase_b_soporte.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "testing"
          comment: "Iter22 E2E PASS. 14/14 backend tests soporte + 13 clubes + 11 RSVP = 38/38 sin regresiones. Endpoints: POST alertar-organizador / reportar-ausencia (público), GET alertas/pendientes, PATCH alertas/{id}/leida, GET/PATCH admin/me, PATCH inscripciones/{id}/inline, POST inscripciones/{id}/confirmar-manual. Rate limit 60s por (slug,tel,tipo). Twilio WhatsApp opcional — si admin no tiene WA, queda como registro inbox. Inscripcion model extendido con cancha_asignada, ausencia_reportada, pago_manual. BUG CRÍTICO encontrado y arreglado por testing_agent: confirmar-manual escribía 'estatus' en vez de 'estatus_pago' (campo equivocado en mongo) y casing 'aprobado' vs 'Aprobado'. Fix en 3 lugares (línea 412/425/373). Test reforzado: ahora releé el doc y verifica estatus_pago=='Aprobado'. Test idempotencia añadido."

  - task: "Módulo Clubes Inteligente — buscar + Enriquecimiento Silencioso + Blindaje"
    implemented: true
    working: true
    file: "/app/backend/routers/clubes.py + /app/backend/routers/retas.py + /app/backend/tests/test_clubes_smart.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: "Iter22 13/13 PASS. Fixes de blindaje: (1) DuplicateKeyError handler en upsert_club_silencioso para race condition de creación concurrente. (2) Tests añadidos: race condition (2 retas paralelas → 1 club), regex con caracteres especiales (.* ( ++ ? [a-z]), geo inválido (422), PUT re-enriquecimiento. (3) Índice único nombre_norm verificado en core/db.py."

frontend_v2:
  - task: "Módulo Clubes Inteligente — Admin Autocomplete + Player Deep Link + Blindaje"
    implemented: true
    working: true
    file: "/app/frontend/src/components/ClubAutocomplete.tsx + /app/frontend/src/utils/mapsDeepLink.ts + /app/frontend/app/admin/reta/[id].tsx + /app/frontend/app/retas/[slug].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "main"
          comment: "Iter22 visual + funcional PASS. Fixes de blindaje: (1) stacking-context fix (zIndex+isolation) — los rows del dropdown ahora SÍ son clickables en react-native-web (antes el input Dirección interceptaba pointer events). (2) Auto-clean: al cambiar nombre tras un pick, dir+coords se limpian → no se persiste dirección de club B con nombre A. (3) GPS race cleanup con gpsTokenRef — respuestas obsoletas tras timeout son descartadas. (4) Backend error visible: hint rojo '⚠️ Directorio no disponible' si /buscar falla. (5) onBlur 250ms (era 180ms) para mobile lento. (6) mountedRef previene setState tras unmount. (7) Helper mapsDeepLink.ts centralizado: iOS → Apple Maps primero, Android → Google Maps, web → window.open con fallback location.href si pop-up blocker. (8) Coordenadas validadas (NaN, out-of-range). (9) Chip MAPA oculto si no hay destino válido. URLs validadas: con geo ?query=LAT,LNG | sin geo ?query=encoded(nombre+dir)."

agent_communication:
    - agent: "main"
      message: |
        FASE A — Retas Gratis / Entre Amigos (RSVP) — COMPLETA y validada manualmente.

        BACKEND (ya estaba listo, solo revalidar):
        1. POST /api/public/retas/{id}/rsvp/aceptar  con {nombre, telefono} → cuando hay cupo: estatus_confirmacion="aceptado", inscritos_count++. Cuando NO hay cupo: estatus_confirmacion="lista_espera" + posicion_lista_espera. Idempotencia: misma combinación reta+telefono devuelve la inscripción existente sin duplicar ni doble-reservar cupo.
        2. POST /api/public/retas/{id}/rsvp/rechazar con {nombre, telefono} → si previo "aceptado": libera cupo, promueve waitlist. Si nuevo rechazo: solo registra.
        3. GET  /api/admin/retas/{id}/asistencia (auth admin) → {confirmados[], pendientes[], lista_espera[], rechazados[]}.
        4. PATCH /api/admin/inscripciones/{id}/estatus body {estatus_confirmacion: "..."}  → al pasar a "aceptado" reserva cupo (409 si llena). Al salir de "aceptado" libera + promueve waitlist.
        5. Validar que las retas con tipo_acceso="paga" siguen funcionando (no romper checkout MP/Stripe ni cupones).

        FRONTEND (recién implementado):
        1. Crear reta con tipo_acceso=gratis_amigos vía API o admin form (testID form-tipo-acceso-gratis_amigos).
           - Datos demo ya creados: SLUG=reta-gratis-demo-club-amigos-2026-12-20, ID=87a6c2c5-cdb4-4d16-96e8-80f056fe9b14.
        2. Visitar /retas/{slug}:
           - Stat "Costo" debe decir "Gratis".
           - Card RSVP visible con testID rsvp-card.
           - Inputs rsvp-nombre-input y rsvp-telefono-input.
           - Botones rsvp-aceptar-btn (verde grande) y rsvp-rechazar-btn (outline).
           - NO debe aparecer Stripe/MP/Cupón.
        3. Click Aceptar con datos válidos:
           - Render testID rsvp-state-aceptado con icono PartyPopper y mensaje "¡Asistencia confirmada!".
           - Cupo en stats debe incrementarse.
           - Botón "Cambiar respuesta" testID rsvp-reset-btn.
        4. Repetir Aceptar con el MISMO teléfono → debe seguir mostrando estado aceptado (idempotencia, sin duplicado).
        5. Llenar la reta (8 aceptaciones únicas) y un 9º intentar Aceptar → render testID rsvp-state-lista_espera con badge "Posición #1".
        6. Click Rechazar con un nuevo teléfono que no había aceptado → render testID rsvp-state-rechazado.
        7. Login admin (admin@padelappretas.com / admin123) y navegar a /admin/reta/inscripciones/{id}:
           - Title debe decir "Asistencia" (no "Inscripciones").
           - Banner verde "Evento gratuito · RSVP" + "{n}/{max} confirmados" y subcontadores.
           - 3 columnas Confirmados/Lista de espera/Pendientes con counts y empty states.
           - Click en chip "Lista de espera" sobre un row confirmado → confirmación + apareces en Lista de espera (count decrementado en Confirmados).
           - Click en "Rechazar" sobre lista de espera → desaparece, aparece en columna Rechazados (auditoría) si existe.
           - Click "Confirmar" desde Lista de espera con cupo libre → vuelve a Confirmados.
           - Click "Confirmar" desde Lista de espera con cupo lleno → Alert con "no se pudo aceptar: reta llena".
        8. Validar que para una reta con tipo_acceso="paga", el screen sigue siendo la lista legacy con botón Reembolsar (no la vista 3 columnas).

        CREDENCIALES TEST:
          admin@padelappretas.com / admin123
          Universal Key emergent: ya configurada, no se necesita para RSVP.
          Slug demo: reta-gratis-demo-club-amigos-2026-12-20

        Reportar regresiones en cupones, búsqueda híbrida o checkout MP/Stripe si surgen.

    - agent: "main"
      message: |
        Fase 2/3/4 "Retas de Parejas" COMPLETAS (sesiones anteriores).
        BACKEND: 25/25 tests phase234 + 12/12 phase1 + 44/44 regresión → 37/37 PASS final tras añadir monto_total/cupos_reservados a MP/Stripe response.
        FRONTEND: /retas/{slug} con chip de modalidad, selector dúo/free-agent, inputs dinámicos de pareja, validación de teléfonos iguales, botón con monto x2.
        Archivos clave nuevos: routers/parejas_admin.py, core/standings.py:compute_duo_standings, logica_torneo.py:generar_rol_multi_cancha_parejas.
        Admin: GET /retas/{id}/free-agents, POST /free-agents/match, DELETE /inscripciones/{id}?modo=duo|solo, GET /duos.
        Credenciales: admin@padelappretas.com / admin123.

        BACKEND:
        1. GET /api/public/retas/buscar (sin params) → lista todas las retas ordenadas por fecha_evento ASC.
        2. GET /api/public/retas/buscar?q=club → busca usando text index Mongo (case-insensitive, trim aplicado en server).
        3. GET /api/public/retas/buscar?lat=19.4326&lng=-99.1332&radio_km=30 → filtra por Haversine.
        4. GET /api/public/retas/buscar?q=padel&lat=19.4326&lng=-99.1332 → combina texto + geo.
        5. Edge cases: q vacío, lat sin lng (debe ignorar geo), radio_km gigante.
        
        FRONTEND:
        1. Pantalla principal carga retas sin GPS por defecto. Subtítulo: "Todas las retas · ordenado por fecha".
        2. SearchBar acepta texto → tras debounce 350ms filtra lista (probar "club", "demo", "MP").
        3. Tap en botón GPS (testID gps-toggle-btn) → en preview web/headless dispara denied → Toast aparece con texto "Ubicación desactivada..." y subtítulo cambia a "Sin GPS · ordenado por fecha".
        4. Vaciar input no debe disparar petición redundante.
        5. Pull-to-refresh debe re-ejecutar fetch híbrido con params actuales.
        6. No debe haber white-screens, crashes ni dependencias de GPS.
        
        Credenciales admin (no necesarias para esto): admin@padelappretas.com / admin123.
        Datos seed: existen al menos "Reta Demo" (Padel Club CDMX) y "Reta MP Test" (Club Test).
