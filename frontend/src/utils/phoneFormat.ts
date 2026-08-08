/**
 * phoneFormat.ts — Helpers para normalizar y validar teléfonos de usuario
 * al formato E.164 esperado por el backend (`+<país><número>`).
 *
 * Reglas de UX aplicadas:
 *   • Aceptamos entrada con espacios, guiones, paréntesis y puntos.
 *   • Si el usuario tipeó sólo 10 dígitos → asumimos México y prependemos +52.
 *   • Si ya trae "+" → respetamos el formato.
 *   • Si tiene 11-15 dígitos sin "+" → asumimos que trae lada y agregamos "+".
 *
 * El backend `core.validators._validate_phone` aplica exactamente la misma
 * lógica como defensa en profundidad, pero normalizar en el cliente reduce
 * roundtrips y mejora los mensajes de error.
 */

const DEFAULT_COUNTRY = "+52"; // México

/**
 * Normaliza input del usuario a formato E.164 (`+<país><número>`).
 * Devuelve `null` si el formato no es válido después de normalizar.
 */
export function normalizePhoneToE164(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Quitar separadores comunes.
  const stripped = trimmed.replace(/[\s\-.()]/g, "");

  // Ya viene con "+" → confiamos y validamos.
  if (stripped.startsWith("+")) {
    return /^\+[1-9]\d{7,14}$/.test(stripped) ? stripped : null;
  }

  const digits = stripped.replace(/\D/g, "");

  // 10 dígitos → asumimos MX y prependemos +52.
  if (digits.length === 10) {
    return `${DEFAULT_COUNTRY}${digits}`;
  }
  // 11-15 dígitos → asumimos que ya trae lada.
  if (digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}

/**
 * Formatea el input visualmente mientras el usuario escribe. Sólo agrupa
 * dígitos con espacios (`(55) 1234 5678`) para inputs de 10 dígitos MX.
 * Si el usuario ya escribió "+" internacional, respetamos lo que tipeó.
 */
export function formatPhoneWhileTyping(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();

  // Modo internacional: si empieza con "+", NO formateamos (respetamos).
  if (trimmed.startsWith("+")) {
    // Sólo permitimos "+", dígitos y espacios.
    return trimmed.replace(/[^\d+\s]/g, "").slice(0, 20);
  }

  // Modo local MX: agrupamos como (LADA) NNNN NNNN
  const digits = trimmed.replace(/\D/g, "").slice(0, 10);
  const len = digits.length;
  if (len === 0) return "";
  if (len <= 2) return `(${digits}`;
  if (len <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)} ${digits.slice(6)}`;
}

/**
 * Extrae el mensaje humano de un error de la API, priorizando `detail.message`
 * cuando el backend devolvió una estructura {code, message, twilio_code}.
 */
export function parseApiErrorMessage(err: unknown, fallback: string): {
  message: string;
  code?: string;
  twilioCode?: number | null;
} {
  const raw = (err as { message?: string })?.message ?? "";
  // El request() tira: `${status}: ${body}` — extraemos el body.
  const idx = raw.indexOf(": ");
  const body = idx > 0 ? raw.slice(idx + 2) : raw;

  try {
    const parsed = JSON.parse(body);
    const detail = parsed?.detail;
    if (detail && typeof detail === "object") {
      return {
        message: String(detail.message ?? fallback),
        code: typeof detail.code === "string" ? detail.code : undefined,
        twilioCode:
          typeof detail.twilio_code === "number" ? detail.twilio_code : null,
      };
    }
    if (typeof detail === "string") {
      return { message: detail };
    }
  } catch {
    /* body no era JSON — usamos raw */
  }

  return { message: body || fallback };
}
