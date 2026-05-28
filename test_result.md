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
  Continuar con P0: completar la integración Frontend del Motor de Búsqueda Híbrido
  (Texto + GPS opcional + Fallback por fecha). Backend ya tiene endpoint
  /api/public/retas/buscar funcionando con índices texto y filtro Haversine.
  Validar que: (a) lista carga sin GPS por defecto ordenada por fecha,
  (b) texto en SearchBar filtra retas/clubs, (c) botón GPS denegado muestra Toast
  amber y mantiene fallback, (d) sin crashes ni white-screens.

backend:
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
    - "Importación masiva de jugadores (paste CSV)"
    - "Backend endpoint POST /api/retas/{id}/inscripciones/import"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      message: |
        Hybrid Search Engine completo (backend + frontend). Validar:
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
