/** API client for PadelappRetas OS — handles auth token + /api prefix. */
import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
const TOKEN_KEY = "ppos.admin.token";

export type FormatoScore = {
  tipo: "PUNTOS" | "TIEMPO";
  valor: number;
  unidad: "juegos" | "sets" | "minutos";
};

export type ModalidadRegistro = "individual" | "parejas_libres" | "parejas_mixtas";

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
  url_slug: string;
  organizador_logo_url?: string | null;
  observaciones_publicas: string;
  latitud?: number | null;
  longitud?: number | null;
  alertas_enviadas: boolean;
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

export type RolResponse = {
  reta_id: string;
  canchas: number;
  num_rondas: 5 | 6 | 7;
  jugadores: string[];
  rol: CanchaRol[];
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

async function tokenHeader() {
  const t = await storage.secureGet<string>(TOKEN_KEY, "");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function request<T>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    auth?: boolean;
    raw?: boolean;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth) Object.assign(headers, await tokenHeader());
  if (opts.headers) Object.assign(headers, opts.headers);
  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt}`);
  }
  if (opts.raw) return res as unknown as T;
  return (await res.json()) as T;
}

export const api = {
  // ===== auth =====
  async login(username: string, password: string) {
    const r = await request<{ access_token: string; token_type: string }>(
      "/auth/login",
      { method: "POST", body: { username, password } },
    );
    await storage.secureSet(TOKEN_KEY, r.access_token);
    return r;
  },
  async logout() {
    await storage.secureRemove(TOKEN_KEY);
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
  playerVerifyOtp: (body: { telefono: string; codigo: string }) =>
    request<PlayerAuthResponse>(`/players/auth/otp/verify`, { method: "POST", body }),
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
