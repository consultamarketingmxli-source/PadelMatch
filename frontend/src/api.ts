/** API client for Pixel Padel OS — handles auth token + /api prefix. */
import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
const TOKEN_KEY = "ppos.admin.token";

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

async function tokenHeader() {
  const t = await storage.secureGet<string>(TOKEN_KEY, "");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean; raw?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth) Object.assign(headers, await tokenHeader());
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

  // ===== retas público =====
  radar: (lat?: number, lng?: number, radioKm = 30) => {
    const qs = lat !== undefined && lng !== undefined ? `?lat=${lat}&lng=${lng}&radio_km=${radioKm}` : "";
    return request<Reta[]>(`/public/retas/radar${qs}`);
  },
  getRetaBySlug: (slug: string) => request<Reta>(`/public/retas/${slug}`),

  // ===== inscripciones =====
  checkout: (retaId: string, body: { reta_id: string; nombre: string; telefono: string }) =>
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
  tablaPosiciones: (retaId: string) =>
    request<TablaPosicionEntry[]>(`/public/retas/${retaId}/tabla`),

  // ===== stripe checkout =====
  checkoutStripe: (
    retaId: string,
    body: { nombre: string; telefono: string; success_url?: string; cancel_url?: string },
  ) =>
    request<StripeCheckoutResponse>(`/public/retas/${retaId}/checkout-stripe`, {
      method: "POST",
      body,
    }),
  paymentStatus: (inscripcionId: string) =>
    request<PaymentStatus>(`/public/inscripciones/${inscripcionId}/payment-status`),

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
};
