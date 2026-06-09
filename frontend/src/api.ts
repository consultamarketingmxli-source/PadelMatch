/** API client for PadelappRetas OS — handles auth token + /api prefix. */
import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";
import { playerTokenStore } from "@/src/utils/playerTokenStore";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
const TOKEN_KEY = "ppos.admin.token";
// Ola E — Refresh Tokens
const REFRESH_TOKEN_KEY = "ppos.refresh.token"; // SecureStore (native) — vacío en web (cookie)
const IS_WEB = Platform.OS === "web";
const CLIENT_PLATFORM = IS_WEB ? "web" : "native";

/* ---------------------------------------------------------------------------
 * Auditoría Routing — Interceptor global de errores 401 (Stale Session).
 *
 * Cuando el backend responde 401 a cualquier petición autenticada, limpiamos
 * los tokens (admin + player) del storage y emitimos un evento global. Un
 * listener en `app/_layout.tsx` lo captura y navega al login apropiado con
 * un toast informativo. Esto evita que la pantalla "se congele" cuando el
 * JWT caduca silenciosamente.
 * ------------------------------------------------------------------------- */
type AuthExpiredListener = () => void;
const _authExpiredListeners: Set<AuthExpiredListener> = new Set();

export function onAuthExpired(listener: AuthExpiredListener): () => void {
  _authExpiredListeners.add(listener);
  return () => _authExpiredListeners.delete(listener);
}

let _authExpiredDebounce: ReturnType<typeof setTimeout> | null = null;
function _emitAuthExpired() {
  // Debounce: si caen 5 peticiones en paralelo con 401, solo emitimos 1 evento.
  if (_authExpiredDebounce) return;
  _authExpiredDebounce = setTimeout(() => {
    _authExpiredDebounce = null;
    _authExpiredListeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* no-op */
      }
    });
  }, 100);
}

export type FormatoScore = {
  tipo: "PUNTOS" | "TIEMPO";
  valor: number;
  unidad: "juegos" | "sets" | "minutos";
  /** Fase 1 (Sección 1) — suma máxima score_a + score_b (solo PUNTOS). */
  cap_total?: number | null;
  /** Fase 1 — KO 3-0 (o equivalente cap/2+1). */
  ko_enabled?: boolean;
};

export type ModalidadRegistro = "individual" | "parejas_libres" | "parejas_mixtas";
export type CriterioDesempate = "A" | "B" | "C";
export type NumGanadoresPorCancha = 1 | 2 | 3;

/** Directorio de Clubes (Selector Inteligente). */
export type ClubDir = {
  id: string;
  nombre: string;
  direccion_completa?: string;
  latitud?: number | null;
  longitud?: number | null;
  /** Solo presente si se pidió con lat/lng en el query. */
  distancia_km?: number | null;
};

export type Reta = {
  id: string;
  organizador_id: string;
  nombre: string;
  club: string;
  fecha_evento: string;
  canchas_disponibles: number;
  max_jugadores: number;
  costo_inscripcion: number;
  modalidad_juego: "PUNTOS" | "TIEMPO";
  num_rondas: 5 | 6 | 7;
  formato_score?: FormatoScore;
  modalidad_registro?: ModalidadRegistro;
  permitir_individual_en_parejas?: boolean;
  tipo_acceso?: "paga" | "gratis_amigos";
  url_slug: string;
  organizador_logo_url?: string | null;
  observaciones_publicas: string;
  // Directorio de Clubes (Selector Inteligente) — vínculo opcional.
  club_id?: string | null;
  club_direccion?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  alertas_enviadas: boolean;
  /** Fase 1 (Sección 1) — Parametrización extendida. */
  num_ganadores_por_cancha?: NumGanadoresPorCancha;
  criterio_desempate?: CriterioDesempate;
  jugadores_por_cancha?: number;
  inscritos_count: number;
  waitlist_count: number;
  capacidad_pct: number;
  semaforo: "VERDE" | "AMARILLO" | "ROJO";
};

export type Inscripcion = {
  id: string;
  reta_id: string;
  jugador_id: string;
  nombre: string;
  telefono: string;
  estatus_pago: "Pendiente" | "Aprobado" | "Expirado";
  bloqueado_hasta?: string | null;
  // Soporte parejas (Fase 1)
  pareja_grupo_id?: string | null;
  pareja_nombre?: string | null;
  pareja_telefono?: string | null;
  es_free_agent?: boolean;
  creado_en: string;
};

export type WaitlistEntry = {
  id: string;
  reta_id: string;
  jugador_id: string;
  nombre: string;
  telefono: string;
  posicion_fila: number;
  notificado: boolean;
};

export type PlayerStats = {
  jugador_id: string;
  nombre: string;
  partidos_jugados: number;
  partidos_ganados: number;
  efectividad: number;
};

export type PartidoRol = {
  pareja_a: [string, string];
  pareja_b: [string, string];
};

export type RondaRol = {
  ronda: number;
  partidos: PartidoRol[];
};

export type CanchaRol = {
  cancha: number;
  rondas: RondaRol[];
};

export type FixtureMetadataDTO = {
  optimizacion_aplicada: boolean;
  parejas_repetidas: number;
  rivales_repetidos_extra: number;
  descansos_distribuidos: boolean;
  iteraciones_usadas: number;
  relax_level_final: number;
  motivo: string;
  algoritmo: string;
};

export type RolResponse = {
  reta_id: string;
  canchas: number;
  num_rondas: 5 | 6 | 7;
  jugadores: string[];
  rol: CanchaRol[];
  fixture_metadata?: FixtureMetadataDTO;
  es_parejas?: boolean;
};

export type PartidoResultado = {
  id: string;
  reta_id: string;
  cancha: number;
  ronda: number;
  partido_idx: number;
  pareja_a: string[];
  pareja_b: string[];
  score_a: number;
  score_b: number;
  ganador: "A" | "B" | "EMPATE";
  /** Fase 2 (Sección 4) — partido cerrado por KO (3-0 o equivalente cap/2+1). */
  terminado_por_ko?: boolean;
  creado_en: string;
};

export type StripeCheckoutResponse = {
  inscripcion_id: string;
  checkout_url: string;
  session_id: string;
};

export type PaymentStatus = {
  inscripcion_id: string;
  estatus_pago: string;
  session_id?: string | null;
  stripe_payment_status?: string | null;
};

export type RetaKPI = {
  reta_id: string;
  nombre: string;
  club: string;
  fecha_evento: string;
  url_slug: string;
  capacidad_pct: number;
  semaforo: "VERDE" | "AMARILLO" | "ROJO";
  inscritos: number;
  max_jugadores: number;
  waitlist: number;
  ingresos_mxn: number;
  refunds_mxn: number;
};

export type AdminMetrics = {
  ingresos_totales_mxn: number;
  ingresos_pendientes_mxn: number;
  refunds_totales_mxn: number;
  pagos_aprobados: number;
  pagos_pendientes: number;
  pagos_fallidos: number;
  conversion_pct: number;
  retas_totales: number;
  retas_futuras: number;
  retas_llenas: number;
  jugadores_unicos: number;
  top_retas: RetaKPI[];
  proximas_retas: RetaKPI[];
};

export type RefundResponse = {
  ok: boolean;
  inscripcion_id: string;
  refund_id?: string | null;
  amount_refunded_mxn: number;
  promoted: boolean;
};

export type PlayerAuthResponse = {
  access_token: string;
  token_type: string;
  jugador_id: string;
  nombre: string;
  telefono: string;
};

export type MpStatus = {
  connected: boolean;
  mp_user_id?: string | null;
  nickname?: string | null;
  email?: string | null;
  site_id?: string | null;
  connected_at?: string | null;
  apply_fee: boolean;
  fee_percent: number;
  // ===== Marketplace OAuth multi-cuenta =====
  connection_mode?: "oauth" | "manual" | null;
  encrypted_at_rest?: boolean;
  encryption_available?: boolean;
  expires_at?: string | null;
  has_refresh_token?: boolean;
};

export type MpOAuthStart = {
  authorize_url: string;
  state: string;
  redirect_uri: string;
};

export type MpCheckoutResponse = {
  inscripcion_id: string;
  preference_id: string;
  init_point: string;
  sandbox_init_point?: string | null;
};

export type MpPaymentStatusType = {
  inscripcion_id: string;
  estatus_pago: string;
  mp_payment_id?: string | null;
  mp_status?: string | null;
};

// ===== Marketing — Cupones =====
export type Cupon = {
  id: string;
  codigo: string;
  organizador_id: string;
  descripcion?: string | null;
  reta_id_exclusivo?: string | null;
  usado: boolean;
  fecha_creacion: string;
  fecha_uso?: string | null;
  inscripcion_id_uso?: string | null;
  jugador_nombre_uso?: string | null;
  creado_por_admin_id?: string | null;
};

export type CuponValidateResponse = {
  valido: boolean;
  razon?: string | null;
  cupon?: { codigo: string; descripcion: string } | null;
  monto_descuento?: number | null;
  monto_final?: number | null;
};

export type PlayerInscripcion = {
  id: string;
  reta_id: string;
  reta_nombre: string;
  reta_slug: string;
  fecha_evento: string;
  club: string;
  estatus_pago: string;
  creado_en: string;
};

export type TablaPosicionEntry = {
  nombre: string;
  partidos_jugados: number;
  partidos_ganados: number;
  partidos_empatados: number;
  partidos_perdidos: number;
  juegos_a_favor: number;
  juegos_en_contra: number;
  diferencia: number;
  puntos: number;
  efectividad: number;
};

export type ShareInfo = {
  reta_id: string;
  nombre: string;
  url_publica: string;
  url_slug: string;
  qr_endpoint: string;
  qr_publico: string;
  inscritos: number;
  waitlist: number;
  max_jugadores: number;
  capacidad_pct: number;
  semaforo: "VERDE" | "AMARILLO" | "ROJO";
  sugerencia?: string | null;
};

export type PlayerWaitlistItem = {
  waitlist_id: string;
  reta_id: string;
  reta_nombre: string;
  reta_slug: string;
  club: string;
  fecha_evento: string;
  posicion_fila: number;
  total_en_espera: number;
  notificado: boolean;
};

async function tokenHeader(): Promise<Record<string, string>> {
  const t = await storage.secureGet<string>(TOKEN_KEY, "");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Devuelve el access token admin crudo (para descargas con header custom). */
export async function getAdminAccessToken(): Promise<string | null> {
  return (await storage.secureGet<string>(TOKEN_KEY, "")) || null;
}

/** URL absoluta del backend (sin /api). Útil para componer endpoints custom. */
export function backendBaseUrl(): string {
  return BASE;
}

/* ---------------------------------------------------------------------------
 * Ola E — Refresh Token Mutex + Auto-Refresh on 401
 *
 * Estrategia:
 *  - Mobile (Native): refresh token guardado en SecureStore; lo enviamos en
 *    header `X-Refresh-Token` al endpoint /auth/refresh.
 *  - Web: refresh token vive en cookie `HttpOnly` `padelapp_refresh`; el
 *    navegador la adjunta automáticamente con `credentials: 'include'`.
 *  - Mutex `_refreshInFlight`: si caen 5 peticiones con 401 simultáneas,
 *    solo UNA dispara refresh; las demás esperan al mismo Promise.
 *  - Rotación: cada refresh invalida el anterior y devuelve uno nuevo.
 *  - Reuse detection: si el backend detecta replay, revoca todas las sesiones.
 * ------------------------------------------------------------------------- */
export async function getRefreshToken(): Promise<string | null> {
  if (IS_WEB) return null; // cookie HttpOnly — JS no la puede leer
  return (await storage.secureGet<string>(REFRESH_TOKEN_KEY, "")) || null;
}

export async function setRefreshToken(token: string | null): Promise<void> {
  if (IS_WEB) return; // no-op (cookie HttpOnly manejada por backend)
  if (token) await storage.secureSet(REFRESH_TOKEN_KEY, token);
  else await storage.secureRemove(REFRESH_TOKEN_KEY);
}

let _refreshInFlight: Promise<string | null> | null = null;

/** Llama /api/auth/refresh; devuelve el nuevo access token o `null` si falla. */
async function performRefresh(): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Client-Platform": CLIENT_PLATFORM,
    };
    const init: RequestInit = { method: "POST", headers };
    if (IS_WEB) {
      init.credentials = "include"; // adjunta cookie HttpOnly
    } else {
      const ref = await getRefreshToken();
      if (!ref) return null;
      headers["X-Refresh-Token"] = ref;
    }
    const res = await fetch(`${BASE}/api/auth/refresh`, init);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string | null;
    };
    if (!data?.access_token) return null;
    // Guardamos el nuevo access en SecureStore (admin) y el refresh rotado.
    await storage.secureSet(TOKEN_KEY, data.access_token);
    if (!IS_WEB && data.refresh_token) {
      await setRefreshToken(data.refresh_token);
    }
    return data.access_token;
  } catch {
    return null;
  }
}

async function ensureRefresh(): Promise<string | null> {
  if (!_refreshInFlight) {
    _refreshInFlight = performRefresh().finally(() => {
      _refreshInFlight = null;
    });
  }
  return _refreshInFlight;
}

async function request<T>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    auth?: boolean;
    raw?: boolean;
    headers?: Record<string, string>;
    _retry?: boolean; // interno: no reintentar dos veces el refresh.
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Client-Platform": CLIENT_PLATFORM,
  };
  if (opts.auth) Object.assign(headers, await tokenHeader());
  if (opts.headers) Object.assign(headers, opts.headers);
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };
  if (IS_WEB) init.credentials = "include"; // siempre, por si hay cookie
  const res = await fetch(`${BASE}/api${path}`, init);

  if (!res.ok) {
    // Ola E — Auto-refresh on 401 (única vez por petición).
    if (
      res.status === 401 &&
      !opts._retry &&
      (opts.auth || /Authorization/i.test(JSON.stringify(headers)))
    ) {
      const newToken = await ensureRefresh();
      if (newToken) {
        // Reintentar con nuevo token. Si el caller usó `auth:true`, ya se
        // reinyectará vía tokenHeader(); si pasó Authorization manual,
        // lo sobreescribimos también.
        const retryHeaders = { ...(opts.headers || {}) };
        if (/Authorization/i.test(JSON.stringify(opts.headers || {}))) {
          retryHeaders["Authorization"] = `Bearer ${newToken}`;
        }
        return request<T>(path, { ...opts, headers: retryHeaders, _retry: true });
      }
      // Refresh falló → limpiamos y emitimos authExpired.
      try {
        await storage.secureRemove(TOKEN_KEY);
        await setRefreshToken(null);
        await playerTokenStore.remove();
      } catch {
        /* no-op */
      }
      _emitAuthExpired();
    }
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt}`);
  }
  if (opts.raw) return res as unknown as T;
  return (await res.json()) as T;
}

export const api = {
  // ===== auth =====
  async login(username: string, password: string) {
    const r = await request<{
      access_token: string;
      token_type: string;
      refresh_token?: string | null;
      expires_in?: number;
    }>("/auth/login", { method: "POST", body: { username, password } });
    await storage.secureSet(TOKEN_KEY, r.access_token);
    if (r.refresh_token) await setRefreshToken(r.refresh_token);
    return r;
  },
  async logout() {
    // Notifica al backend para revocar refresh token + borra cookie.
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Client-Platform": CLIENT_PLATFORM,
      };
      const init: RequestInit = { method: "POST", headers };
      if (IS_WEB) {
        init.credentials = "include";
      } else {
        const ref = await getRefreshToken();
        if (ref) headers["X-Refresh-Token"] = ref;
      }
      await fetch(`${BASE}/api/auth/logout`, init);
    } catch {
      /* silenciamos errores de red en logout */
    }
    await storage.secureRemove(TOKEN_KEY);
    await setRefreshToken(null);
  },

  /**
   * Cierra sesión en TODOS los dispositivos del usuario (admin o player).
   * Revoca todos los refresh tokens en backend + limpia almacenamiento local.
   * Funciona con cualquier access token Bearer válido (admin o player).
   */
  async revokeAllSessions(accessToken: string) {
    const r = await request<{ ok: boolean; sessions_revoked: number }>(
      "/auth/revoke-all-sessions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    // Limpieza local completa.
    await storage.secureRemove(TOKEN_KEY);
    await setRefreshToken(null);
    try {
      await playerTokenStore.remove();
    } catch {
      /* no-op */
    }
    return r;
  },
  async getToken() {
    return (await storage.secureGet<string>(TOKEN_KEY, "")) || null;
  },
  async me() {
    return request<{ email: string; role: string }>("/auth/me", { auth: true });
  },

  // ===== retas admin =====
  listRetasAdmin: () => request<Reta[]>("/retas", { auth: true }),
  getRetaAdmin: (id: string) => request<Reta>(`/retas/${id}`, { auth: true }),
  createReta: (body: any) => request<Reta>("/retas", { method: "POST", body, auth: true }),
  updateReta: (id: string, body: any) =>
    request<Reta>(`/retas/${id}`, { method: "PUT", body, auth: true }),
  deleteReta: (id: string) =>
    request<{ ok: boolean }>(`/retas/${id}`, { method: "DELETE", auth: true }),
  listInscripciones: (id: string) =>
    request<Inscripcion[]>(`/retas/${id}/inscripciones`, { auth: true }),

  // ===== Compartir (Fase B) =====
  getShareInfo: (id: string) => request<ShareInfo>(`/retas/${id}/share-info`, { auth: true }),
  /** URL absoluta del PNG QR público (no requiere auth) — sirve como src de <Image>. */
  getPublicQrUrl: (slug: string) => `${BASE}/api/public/retas/${slug}/qr`,

  // ===== retas público =====
  radar: (lat?: number, lng?: number, radioKm = 30) => {
    const qs = lat !== undefined && lng !== undefined ? `?lat=${lat}&lng=${lng}&radio_km=${radioKm}` : "";
    return request<Reta[]>(`/public/retas/radar${qs}`);
  },
  /**
   * Motor de búsqueda híbrido — 3 vías combinables:
   *  A) GPS (lat/lng + radioKm)
   *  B) Texto (q, trim+lowercase aplicado en server)
   *  C) Fallback: sin params → todas ordenadas por fecha_evento ASC.
   */
  buscarRetas: (params: { q?: string; lat?: number; lng?: number; radioKm?: number }) => {
    const sp = new URLSearchParams();
    const q = (params.q ?? "").trim().toLowerCase();
    if (q) sp.set("q", q);
    if (params.lat !== undefined && params.lng !== undefined) {
      sp.set("lat", String(params.lat));
      sp.set("lng", String(params.lng));
      sp.set("radio_km", String(params.radioKm ?? 30));
    }
    const qs = sp.toString() ? `?${sp.toString()}` : "";
    return request<Reta[]>(`/public/retas/buscar${qs}`);
  },
  getRetaBySlug: (slug: string) => request<Reta>(`/public/retas/${slug}`),

  // ===== Directorio de Clubes (Selector Inteligente) =====
  buscarClubes: (params: { q?: string; lat?: number; lng?: number; radioKm?: number; limit?: number }) => {
    const sp = new URLSearchParams();
    const q = (params.q ?? "").trim();
    if (q) sp.set("q", q);
    if (params.lat !== undefined && params.lng !== undefined) {
      sp.set("lat", String(params.lat));
      sp.set("lng", String(params.lng));
      sp.set("radio_km", String(params.radioKm ?? 50));
    }
    if (params.limit) sp.set("limit", String(params.limit));
    const qs = sp.toString() ? `?${sp.toString()}` : "";
    return request<{
      results: ClubDir[];
      total: number;
      error?: string;
    }>(`/public/clubes/buscar${qs}`);
  },

  // ===== inscripciones =====
  checkout: (
    retaId: string,
    body: {
      reta_id: string;
      nombre: string;
      telefono: string;
      pareja_nombre?: string;
      pareja_telefono?: string;
      es_free_agent?: boolean;
    },
  ) =>
    request<Inscripcion>(`/public/retas/${retaId}/checkout`, {
      method: "POST",
      body,
    }),

  // ===== soporte (Fase B) =====
  alertarOrganizador: (
    slug: string,
    body: { nombre: string; telefono: string; motivo: string },
  ) =>
    request<{
      ok: boolean;
      enviado_whatsapp: boolean;
      canal: "whatsapp" | "registro";
      mensaje: string;
      alerta_id: string;
    }>(`/public/retas/${slug}/soporte/alertar-organizador`, {
      method: "POST",
      body,
    }),
  reportarAusencia: (
    slug: string,
    body: { nombre: string; telefono: string; motivo?: string },
  ) =>
    request<{
      ok: boolean;
      enviado_whatsapp: boolean;
      canal: "whatsapp" | "registro";
      mensaje: string;
      alerta_id: string;
    }>(`/public/retas/${slug}/soporte/reportar-ausencia`, {
      method: "POST",
      body,
    }),
  alertasPendientes: (params?: { retaId?: string; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.retaId) sp.set("reta_id", params.retaId);
    if (params?.limit) sp.set("limit", String(params.limit));
    const qs = sp.toString() ? `?${sp.toString()}` : "";
    return request<{
      items: Array<{
        id: string;
        reta_id: string;
        reta_nombre: string;
        reta_slug: string;
        tipo: "alertar_organizador" | "reportar_ausencia";
        nombre_jugador: string;
        telefono_jugador: string;
        motivo: string;
        canal: "whatsapp" | "registro";
        enviado_whatsapp: boolean;
        leida: boolean;
        creada_en: string;
      }>;
      total_pendientes: number;
    }>(`/admin/alertas/pendientes${qs}`, { auth: true });
  },
  marcarAlertaLeida: (alertaId: string) =>
    request<{ ok: boolean }>(`/admin/alertas/${alertaId}/leida`, {
      method: "PATCH",
      auth: true,
    }),
  adminMe: () =>
    request<{ id: string; email: string; telefono_whatsapp: string | null }>(
      `/admin/me`,
      { auth: true },
    ),
  adminSetWhatsapp: (telefono: string | null) =>
    request<{ ok: boolean; telefono_whatsapp: string | null }>(
      `/admin/me/whatsapp`,
      {
        method: "PATCH",
        body: { telefono_whatsapp: telefono },
        auth: true,
      },
    ),
  patchInscripcionInline: (
    inscId: string,
    body: { nombre?: string; telefono?: string; cancha_asignada?: number },
  ) =>
    request<{ ok: boolean; inscripcion: Inscripcion }>(
      `/admin/inscripciones/${inscId}/inline`,
      { method: "PATCH", body, auth: true },
    ),
  confirmarInscripcionManual: (inscId: string, nota?: string) =>
    request<{ ok: boolean; confirmada_manualmente?: boolean; ya_aprobada?: boolean }>(
      `/admin/inscripciones/${inscId}/confirmar-manual`,
      { method: "POST", body: { nota }, auth: true },
    ),
  joinWaitlist: (retaId: string, body: { reta_id: string; nombre: string; telefono: string }) =>
    request<WaitlistEntry>(`/public/retas/${retaId}/waitlist`, {
      method: "POST",
      body,
    }),
  paymentWebhook: (inscripcionId: string, status: "approved" | "failed") =>
    request<{ ok: boolean; status: string }>(`/webhooks/payment`, {
      method: "POST",
      body: { inscripcion_id: inscripcionId, status },
    }),

  // ===== stats =====
  playerStats: (telefono: string) =>
    request<PlayerStats>(`/public/players/${encodeURIComponent(telefono)}/stats`),

  // ===== resultados =====
  getRol: (retaId: string) =>
    request<RolResponse>(`/retas/${retaId}/rol`, { auth: true }),
  /**
   * Persiste el orden manual de jugadores (drag & drop entre canchas).
   * Body: lista ordenada de nombres — debe coincidir 1:1 con inscritos aprobados.
   * Reglas: 409 si ya existen resultados capturados; 422 si nombres no coinciden.
   */
  updateJugadoresOrden: (retaId: string, jugadores: string[]) =>
    request<{ ok: boolean; jugadores: string[] }>(
      `/retas/${retaId}/jugadores/orden`,
      { method: "PUT", body: { jugadores }, auth: true },
    ),
  /**
   * Preview del rol Round Robin con un orden tentativo de jugadores.
   * No persiste nada — solo simula. Usado en UX de drag & drop para
   * que el organizador vea cómo quedará la distribución de partidos.
   */
  previewRol: (retaId: string, jugadores: string[]) =>
    request<RolResponse & { is_preview: true }>(
      `/retas/${retaId}/rol/preview`,
      { method: "POST", body: { jugadores }, auth: true },
    ),
  /**
   * Fase D — Recalcula las rondas FUTURAS de un torneo en curso preservando
   * los marcadores ya guardados. Útil cuando un jugador se lesiona o se
   * cambia el cupo a mitad del torneo.
   */
  recalcularRondasPendientes: (
    retaId: string,
    excluirJugadores: string[] = [],
  ) =>
    request<{
      reta_id: string;
      canchas: number;
      num_rondas: number;
      rol_actualizado: {
        cancha: number;
        rondas: { ronda: number; partidos: { pareja_a: string[]; pareja_b: string[] }[]; bloqueada: boolean }[];
      }[];
      rondas_bloqueadas: { cancha: number; ronda: number }[];
      jugadores_activos: string[];
      jugadores_excluidos: string[];
      fixture_metadata: FixtureMetadataDTO;
      rondas_pendientes_recalculadas: number;
      es_parejas: boolean;
    }>(`/retas/${retaId}/rol/recalcular-pendientes`, {
      method: "POST",
      body: { excluir_jugadores: excluirJugadores },
      auth: true,
    }),
  /**
   * Importación masiva de jugadores (CSV). El backend valida cupo,
   * duplicados y bloquea si ya hay resultados (409).
   * Devuelve breakdown: creadas + omitidos[{nombre, razon}].
   */
  importInscripciones: (
    retaId: string,
    jugadores: { nombre: string; telefono?: string }[],
  ) =>
    request<{
      creadas: number;
      omitidos: { nombre: string; razon: "duplicado" | "cupo_lleno" | "vacio" }[];
      total_aprobados: number;
      max_jugadores: number;
    }>(`/retas/${retaId}/inscripciones/import`, {
      method: "POST",
      body: { jugadores },
      auth: true,
    }),
  listResultados: (retaId: string) =>
    request<PartidoResultado[]>(`/retas/${retaId}/resultados`, { auth: true }),
  upsertResultado: (
    retaId: string,
    body: {
      cancha: number;
      ronda: number;
      partido_idx: number;
      pareja_a: string[];
      pareja_b: string[];
      score_a: number;
      score_b: number;
    },
  ) =>
    request<PartidoResultado>(`/retas/${retaId}/resultados`, {
      method: "POST",
      body,
      auth: true,
    }),
  deleteResultado: (retaId: string, resultId: string) =>
    request<{ ok: boolean; deleted: string }>(
      `/retas/${retaId}/resultados/${resultId}`,
      { method: "DELETE", auth: true },
    ),
  tablaPosiciones: (retaId: string) =>
    request<TablaPosicionEntry[]>(`/public/retas/${retaId}/tabla`),
  /** Clasificación privada — admin (auth:true) o player (header Authorization). */
  getClasificacionAdmin: (retaId: string) =>
    request<TablaPosicionEntry[]>(`/retas/${retaId}/clasificacion`, { auth: true }),
  getClasificacionPlayer: (retaId: string, playerToken: string) =>
    request<TablaPosicionEntry[]>(`/retas/${retaId}/clasificacion`, {
      headers: { Authorization: `Bearer ${playerToken}` },
    }),
  /** URL completa del WebSocket realtime. token opcional (admin o player). */
  getRealtimeWsUrl: (retaId: string, token: string): string => {
    const httpBase = (BASE || "").replace(/\/$/, "");
    const wsBase = httpBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    const encoded = encodeURIComponent(token);
    return `${wsBase}/api/ws/retas/${encodeURIComponent(retaId)}?token=${encoded}`;
  },

  // ===== stripe checkout =====
  checkoutStripe: (
    retaId: string,
    body: {
      nombre: string;
      telefono: string;
      success_url?: string;
      cancel_url?: string;
      pareja_nombre?: string;
      pareja_telefono?: string;
      es_free_agent?: boolean;
    },
  ) =>
    request<StripeCheckoutResponse>(`/public/retas/${retaId}/checkout-stripe`, {
      method: "POST",
      body,
    }),
  paymentStatus: (inscripcionId: string) =>
    request<PaymentStatus>(`/public/inscripciones/${inscripcionId}/payment-status`),

  // ===== mercado pago marketplace =====
  mpStatus: () => request<MpStatus>(`/admin/mercadopago/status`, { auth: true }),
  mpConnect: (access_token: string) =>
    request<MpStatus>(`/admin/mercadopago/connect`, {
      method: "POST",
      body: { access_token },
      auth: true,
    }),
  mpDisconnect: () =>
    request<{ ok: boolean }>(`/admin/mercadopago/disconnect`, {
      method: "POST",
      auth: true,
    }),
  mpUpdateSettings: (apply_fee: boolean) =>
    request<MpStatus>(`/admin/mercadopago/settings`, {
      method: "PATCH",
      body: { apply_fee },
      auth: true,
    }),
  /** Fase Marketplace: inicia el flujo OAuth y devuelve la URL para abrir en el navegador. */
  mpOAuthStart: (redirect_uri?: string) => {
    const qs = redirect_uri ? `?redirect_uri=${encodeURIComponent(redirect_uri)}` : "";
    return request<MpOAuthStart>(`/admin/mercadopago/oauth/start${qs}`, { auth: true });
  },
  checkoutMercadoPago: (
    retaId: string,
    body: {
      nombre: string;
      telefono: string;
      payer_email?: string;
      success_url?: string;
      cancel_url?: string;
      pareja_nombre?: string;
      pareja_telefono?: string;
      es_free_agent?: boolean;
    },
  ) =>
    request<MpCheckoutResponse>(`/public/retas/${retaId}/checkout-mercadopago`, {
      method: "POST",
      body,
    }),
  mpPaymentStatus: (inscripcionId: string) =>
    request<MpPaymentStatusType>(`/public/inscripciones/${inscripcionId}/mp-status`),

  // ===== admin dashboard =====
  adminMetrics: () => request<AdminMetrics>(`/admin/metrics`, { auth: true }),
  refundInscripcion: (retaId: string, inscripcionId: string) =>
    request<RefundResponse>(
      `/admin/retas/${retaId}/inscripciones/${inscripcionId}/refund`,
      { method: "POST", auth: true },
    ),

  // ===== player auth (OTP) =====
  playerRequestOtp: (body: { nombre: string; telefono: string }) =>
    request<{ ok: boolean; enviado_por_sms: boolean; mensaje: string }>(
      `/players/auth/otp/request`,
      { method: "POST", body },
    ),
  playerVerifyOtp: async (body: { telefono: string; codigo: string }) => {
    const r = await request<PlayerAuthResponse>(`/players/auth/otp/verify`, {
      method: "POST",
      body,
    });
    // Ola E — guarda refresh token devuelto (sólo native; web usa cookie).
    const anyR = r as PlayerAuthResponse & { refresh_token?: string | null };
    if (anyR.refresh_token) await setRefreshToken(anyR.refresh_token);
    return r;
  },
  playerMe: (token: string) =>
    request<{ jugador_id: string; telefono: string; nombre: string; role: string }>(
      `/players/me`,
      { headers: { Authorization: `Bearer ${token}` } },
    ),
  playerMyInscripciones: (token: string) =>
    request<PlayerInscripcion[]>(`/players/me/inscripciones`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  playerMyStats: (token: string) =>
    request<PlayerStats>(`/players/me/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  playerMyWaitlist: (token: string) =>
    request<PlayerWaitlistItem[]>(`/players/me/waitlist`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  /**
   * Auditoría Routing — Bifurcación inteligente.
   * Devuelve los roles del usuario autenticado por OTP para decidir si
   * mostrar el hub `/seleccion` o saltar directo al ambiente correcto.
   */
  playerMyRoles: (token: string) =>
    request<{
      is_player: boolean;
      is_organizer: boolean;
      is_super_admin: boolean;
      stats: { retas_organizadas: number; clubes_propios: number };
    }>(`/players/me/roles`, {
      headers: { Authorization: `Bearer ${token}` },
    }),

  // ===== Apple 5.1.1 — Account Deletion (anonimización irreversible) =====
  /**
   * Elimina la cuenta del jugador permanentemente.
   *
   * El backend NO borra el registro físicamente para preservar el histórico de
   * torneos (puntos, posiciones, brackets). En su lugar **anonimiza**:
   *   - nombre  → "Usuario_Anónimo_XXXX"
   *   - email   → null
   *   - telefono → hash SHA256
   * Esto cumple con Apple App Store 5.1.1 (cuenta y datos personales borrados)
   * y con GDPR derecho al olvido, sin destruir partidos relacionados.
   */
  playerDeleteMyAccount: async (token: string) => {
    const res = await request<{ ok: boolean; mensaje: string }>(`/players/me`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    // Limpieza local total tras éxito.
    await storage.secureRemove(TOKEN_KEY);
    await setRefreshToken(null);
    try {
      await playerTokenStore.remove();
    } catch {
      /* no-op */
    }
    return res;
  },

  /** Player logout — revoca refresh token + limpia almacenamiento. */
  async playerLogout() {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Client-Platform": CLIENT_PLATFORM,
      };
      const init: RequestInit = { method: "POST", headers };
      if (IS_WEB) {
        init.credentials = "include";
      } else {
        const ref = await getRefreshToken();
        if (ref) headers["X-Refresh-Token"] = ref;
      }
      await fetch(`${BASE}/api/auth/logout`, init);
    } catch {
      /* no-op */
    }
    await setRefreshToken(null);
    try {
      await playerTokenStore.remove();
    } catch {
      /* no-op */
    }
  },

  // ===== Centro de Privacidad (Player) =====
  // Ola E.2 — Estas APIs usan el refresh token para detectar `is_current`.
  // En web la cookie HttpOnly se envía sola (path=/api, credentials:include).
  // En native añadimos el header X-Refresh-Token desde SecureStore.
  playerMySessions: async (token: string) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (!IS_WEB) {
      const ref = await getRefreshToken();
      if (ref) headers["X-Refresh-Token"] = ref;
    }
    return request<{
      sessions: Array<{
        id: string;
        ip: string | null;
        location?: string;
        user_agent: string;
        created_at: string | null;
        last_used_at: string | null;
        expires_at: string | null;
        is_current: boolean;
      }>;
      count: number;
    }>(`/players/me/sessions`, { headers });
  },

  playerRevokeSession: async (token: string, sessionId: string) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (!IS_WEB) {
      const ref = await getRefreshToken();
      if (ref) headers["X-Refresh-Token"] = ref;
    }
    return request<{ ok: boolean; already_revoked?: boolean }>(
      `/players/me/sessions/${sessionId}`,
      { method: "DELETE", headers },
    );
  },

  playerSecurityActivity: async (token: string, limit = 20) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (!IS_WEB) {
      const ref = await getRefreshToken();
      if (ref) headers["X-Refresh-Token"] = ref;
    }
    return request<{
      items: Array<{
        accion: string;
        result: string;
        ip: string | null;
        location?: string;
        user_agent: string;
        timestamp: string | null;
      }>;
      count: number;
    }>(`/players/me/security-activity?limit=${limit}`, { headers });
  },

  // ===== Centro de Seguridad (Admin) =====
  adminSecurityStats: (days = 7) =>
    request<{
      window_days: number;
      since: string;
      total_events: number;
      top_actions: Array<{ accion: string; count: number }>;
      by_result: Record<string, number>;
      critical: {
        failed_logins: number;
        nosql_blocks: number;
        rate_limited: number;
        account_deletions: number;
        refresh_reuse_detected: number;
        mp_webhook_signature_invalid: number;
      };
      active_sessions: number;
    }>(`/admin/security/stats?days=${days}`, { auth: true }),

  adminSecurityLogs: (params: {
    accion?: string;
    id_usuario?: string;
    result?: string;
    from?: string;
    to?: string;
    limit?: number;
    skip?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    return request<{
      items: Array<{
        accion: string;
        id_usuario: string | null;
        result: string;
        ip_origen: string | null;
        location?: string;
        user_agent: string;
        timestamp: string | null;
        extra: Record<string, any>;
      }>;
      total: number;
      limit: number;
      skip: number;
      has_more: boolean;
    }>(`/admin/security/logs?${qs.toString()}`, { auth: true });
  },

  /**
   * Devuelve la URL absoluta del endpoint CSV con los filtros aplicados.
   * El header Authorization lo añade quien la consuma (fetch + Blob en
   * web, FileSystem.downloadAsync con header en native).
   */
  adminSecurityLogsCsvPath: (params: {
    accion?: string;
    id_usuario?: string;
    result?: string;
    from?: string;
    to?: string;
  } = {}): string => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    const tail = qs.toString();
    return `/admin/security/logs.csv${tail ? `?${tail}` : ""}`;
  },

  // ===== pdf =====
  async generatePdfUrl(retaId: string, jugadores: string[], numRondas: 5 | 6 | 7) {
    // Devuelve un blob URL listo para abrir.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(await tokenHeader()),
    };
    const res = await fetch(`${BASE}/api/retas/${retaId}/pdf`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jugadores, num_rondas: numRondas }),
    });
    if (!res.ok) throw new Error(`PDF error ${res.status}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  // ===== exports CSV / PDF clasificación =====
  async exportRolCsvUrl(retaId: string) {
    return _downloadBlob(`/retas/${retaId}/rol/csv`, "text/csv");
  },
  async exportClasificacionCsvUrl(retaId: string) {
    return _downloadBlob(`/retas/${retaId}/clasificacion/csv`, "text/csv");
  },
  async exportClasificacionPdfUrl(retaId: string) {
    return _downloadBlob(`/retas/${retaId}/clasificacion/pdf`, "application/pdf");
  },

  // ===== Fase 4 — Retas de Parejas (Admin) =====
  /** Lista jugadores aprobados sin pareja (free-agents). */
  listFreeAgents: (retaId: string) =>
    request<{ inscripcion_id: string; nombre: string; telefono: string; creado_en?: string | null }[]>(
      `/retas/${retaId}/free-agents`,
      { auth: true },
    ),
  /** Lista todos los dúos con sus miembros (para Mesa de Control / UI). */
  listDuos: (retaId: string) =>
    request<{ pareja_grupo_id: string; miembros: { inscripcion_id: string; nombre: string; telefono: string; estatus_pago: string }[] }[]>(
      `/retas/${retaId}/duos`,
      { auth: true },
    ),
  /** Empareja DOS free-agents en un dúo nuevo. */
  matchFreeAgents: (retaId: string, inscripcion_a_id: string, inscripcion_b_id: string) =>
    request<{ ok: boolean; pareja_grupo_id: string; miembros: { inscripcion_id: string; nombre: string }[] }>(
      `/retas/${retaId}/free-agents/match`,
      { method: "POST", body: { inscripcion_a_id, inscripcion_b_id }, auth: true },
    ),
  /** Cancela inscripción. modo='duo' borra ambos, 'solo' deja al otro como free-agent. */
  cancelInscripcionPareja: (retaId: string, insc_id: string, modo: "duo" | "solo" = "duo") =>
    request<{ ok: boolean; eliminadas: number; libres_creadas: number; cupos_liberados: number; promoted: boolean }>(
      `/retas/${retaId}/inscripciones/${insc_id}?modo=${modo}`,
      { method: "DELETE", auth: true },
    ),

  // ===== Notificaciones admin (Twilio WhatsApp) =====
  /** Manda recordatorio "2h antes" a todos los inscritos Aprobados. */
  notifyRecordatorioGeneral: (retaId: string) =>
    request<{
      sent: number; mocked: number; failed: number; total_targets: number;
      configured: boolean;
      items: { nombre: string; telefono: string; status: string; needs_sandbox_join?: boolean }[];
    }>(`/retas/${retaId}/notify/recordatorio-general`, { method: "POST", auth: true }),
  /** Manda aviso "te toca AHORA" a los jugadores de una ronda concreta. */
  notifyProximoPartido: (retaId: string, ronda: number, cancha?: number) => {
    const qs = `ronda=${ronda}${cancha != null ? `&cancha=${cancha}` : ""}`;
    return request<{
      sent: number; mocked: number; failed: number; skipped: number;
      total_targets: number; partidos_procesados: number; configured: boolean;
      items: { nombre: string; telefono?: string; cancha?: number; ronda?: number; partido?: number; status: string }[];
    }>(`/retas/${retaId}/notify/proximo-partido?${qs}`, { method: "POST", auth: true });
  },
  /** Manda link público a TODOS los que están en lista de espera. */
  notifyListaEspera: (retaId: string) =>
    request<{
      sent: number; mocked: number; failed: number; total_targets: number; configured: boolean;
      items: { nombre?: string; telefono?: string; status: string }[];
    }>(`/retas/${retaId}/notify/lista-espera`, { method: "POST", auth: true }),

  /** Devuelve info del Sandbox Twilio (instrucciones de "join" para destinatarios). */
  getTwilioSandboxInfo: () =>
    request<{
      configured: boolean;
      is_sandbox: boolean;
      sandbox_number: string;
      join_code: string | null;
      instructions: string;
    }>("/admin/twilio/sandbox-info", { auth: true }),

  // ===== MARKETING — Cupones de descuento =====
  /** Crea un cupón. Si `codigo` se omite, genera uno automático tipo PRO-X9K2A7. */
  crearCupon: (body: { codigo?: string; descripcion?: string; reta_id_exclusivo?: string }) =>
    request<Cupon>("/admin/cupones", { method: "POST", body, auth: true }),
  /** Lista cupones del organizador (filtros opc.). */
  listarCupones: (params?: { reta_id?: string; solo_disponibles?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.reta_id) qs.set("reta_id", params.reta_id);
    if (params?.solo_disponibles) qs.set("solo_disponibles", "true");
    const url = `/admin/cupones${qs.toString() ? `?${qs.toString()}` : ""}`;
    return request<Cupon[]>(url, { auth: true });
  },
  borrarCupon: (cuponId: string) =>
    request<{ ok: boolean; deleted: number }>(`/admin/cupones/${cuponId}`, {
      method: "DELETE", auth: true,
    }),
  reactivarCupon: (cuponId: string) =>
    request<Cupon>(`/admin/cupones/${cuponId}/reactivar`, { method: "POST", auth: true }),
  /** Pre-validación del cupón antes del canje (no consume). PÚBLICO. */
  validarCupon: (retaId: string, codigo: string) =>
    request<CuponValidateResponse>(`/public/retas/${retaId}/cupon/validar`, {
      method: "POST", body: { codigo },
    }),
  /** Canje ATÓMICO. PÚBLICO. Crea inscripción Aprobada al instante. */
  canjearCupon: (retaId: string, body: { nombre: string; telefono: string; codigo: string }) =>
    request<{
      inscripcion_id: string;
      estatus_pago: "Aprobado";
      monto_final: number;
      cupon_codigo: string;
      cupon_id: string;
    }>(`/public/retas/${retaId}/cupon/canjear`, { method: "POST", body }),
  /** Cancela inscripción INDIVIDUAL (reactiva cupón si aplica). Admin auth. */
  cancelarInscripcionCuponAware: (inscId: string) =>
    request<{
      ok: boolean;
      eliminadas: number;
      cupos_liberados: number;
      cupon_reactivado: boolean;
      promoted: boolean;
    }>(`/admin/inscripciones/${inscId}/cancelar`, { method: "DELETE", auth: true }),

  // ===== Deploy readiness (LIVE checklist) =====
  /** Verifica el estado de las credenciales productivas antes de publicar. */
  getDeployReadiness: () =>
    request<{
      overall: "ready" | "test" | "missing";
      ready_for_live: boolean;
      integrations: {
        name: string; env: string; configured: boolean;
        mode: "live" | "test" | "missing" | "unknown";
        severity: "ok" | "warning" | "critical";
        advice: string;
        extra?: Record<string, unknown>;
      }[];
      missing_critical: string[];
      summary: { total: number; ok: number; warning: number; critical: number };
      doc_url: string;
    }>("/admin/deploy-readiness", { auth: true }),

  // ===== RSVP — Retas Gratis / Entre Amigos =====
  rsvpAceptar: (retaId: string, body: { nombre: string; telefono: string }) =>
    request<{
      inscripcion_id: string;
      estatus_confirmacion: "aceptado" | "lista_espera";
      posicion_lista_espera?: number | null;
      mensaje: string;
    }>(`/public/retas/${retaId}/rsvp/aceptar`, { method: "POST", body }),

  rsvpRechazar: (retaId: string, body: { nombre: string; telefono: string }) =>
    request<{
      ok: boolean;
      promoted: boolean;
      promoted_player?: string | null;
    }>(`/public/retas/${retaId}/rsvp/rechazar`, { method: "POST", body }),

  /** Vista admin agrupada por estatus de confirmación. */
  getAsistencia: (retaId: string) =>
    request<{
      reta_id: string;
      confirmados: any[];
      pendientes: any[];
      lista_espera: any[];
      rechazados: any[];
    }>(`/admin/retas/${retaId}/asistencia`, { auth: true }),

  /** Cambia el estatus_confirmacion de una inscripción (admin). */
  setEstatusInscripcion: (
    inscId: string,
    estatus: "pendiente_invitacion" | "aceptado" | "rechazado" | "lista_espera",
  ) =>
    request<{
      ok: boolean;
      estatus_confirmacion: string;
      estatus_pago: string;
      promoted?: boolean;
      promoted_player?: string | null;
    }>(`/admin/inscripciones/${inscId}/estatus`, {
      method: "PATCH",
      body: { estatus_confirmacion: estatus },
      auth: true,
    }),
};

/**
 * Helper privado: descarga un blob autenticado y devuelve un blob URL listo
 * para abrir/descargar desde el browser.
 */
async function _downloadBlob(path: string, expectedMime: string): Promise<string> {
  const headers: Record<string, string> = {};
  Object.assign(headers, await tokenHeader());
  const res = await fetch(`${BASE}/api${path}`, { method: "GET", headers });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* noop */
    }
    throw new Error(`Descarga error ${res.status}: ${detail}`);
  }
  const blob = await res.blob();
  // Forzar el MIME esperado si el browser lo perdió
  const typedBlob = blob.type ? blob : new Blob([blob], { type: expectedMime });
  return URL.createObjectURL(typedBlob);
}
