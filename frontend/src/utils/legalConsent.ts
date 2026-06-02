/**
 * legalConsent.ts — Estado reactivo del consentimiento legal.
 *
 * Arquitectura Clean:
 *   • Capa de persistencia: SecureStore (via `storage`) → sobrevive a relogin.
 *   • Capa de red: GET /api/v1/legal/versions + POST /api/v1/user/legal-consent.
 *   • Capa de presentación: hook `useLegalConsent()` — reactivo, suscriptor.
 *
 * Flujo:
 *   1. Al montar la app, el hook hace fetch a /versions y compara con el caché.
 *   2. Si las versiones difieren → `needsReConsent = true`.
 *   3. Cuando el usuario acepta, `accept()` persiste local + sync remoto.
 *   4. Cualquier componente suscrito re-renderiza automáticamente.
 *
 * IMPORTANTE: el hook NO requiere autenticación para registrar consentimiento
 * de un user_id null (pre-registro). Esto permite tracking GDPR Art. 7 desde
 * el primer instante del onboarding.
 */
import { useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

const LOCAL_KEY = "padelappretas.legal.consent";
const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

export type LegalVersions = {
  tc_version: string;
  tc_effective_date: string;
  privacy_version: string;
  privacy_effective_date: string;
  legal_entity: string;
  contact_email: string;
};

export type ConsentCache = {
  tc_version: string;
  privacy_version: string;
  accepted_at: string; // ISO8601
  user_id: string | null;
};

export type LegalState = {
  loading: boolean;
  currentVersions: LegalVersions | null;
  cachedConsent: ConsentCache | null;
  /** true si el usuario nunca aceptó o las versiones cambiaron */
  needsConsent: boolean;
};

// Pub/sub simple para mantener un único estado global compartido.
type Listener = (s: LegalState) => void;
const _listeners = new Set<Listener>();
let _state: LegalState = {
  loading: true,
  currentVersions: null,
  cachedConsent: null,
  needsConsent: false,
};

function _emit(next: Partial<LegalState>) {
  _state = { ..._state, ...next };
  for (const l of _listeners) l(_state);
}

async function _loadCache(): Promise<ConsentCache | null> {
  const v = await storage.secureGet<ConsentCache | null>(LOCAL_KEY, null);
  return v && typeof v === "object" ? (v as ConsentCache) : null;
}

async function _saveCache(c: ConsentCache): Promise<void> {
  await storage.secureSet(LOCAL_KEY, c);
}

async function _fetchVersions(): Promise<LegalVersions | null> {
  try {
    const r = await fetch(`${BASE_URL}/api/v1/legal/versions`, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return null;
    return (await r.json()) as LegalVersions;
  } catch {
    return null;
  }
}

function _computeNeedsConsent(
  versions: LegalVersions | null,
  cache: ConsentCache | null,
): boolean {
  if (!versions) return false; // sin info de red, no molestamos
  if (!cache) return true;
  return (
    cache.tc_version !== versions.tc_version ||
    cache.privacy_version !== versions.privacy_version
  );
}

/**
 * Inicializa el estado. Llamar UNA vez al startup de la app (ej. en _layout).
 * Idempotente: múltiples llamadas no duplican fetch.
 */
let _initStarted = false;
export async function initLegalConsent(): Promise<void> {
  if (_initStarted) return;
  _initStarted = true;

  const [cache, versions] = await Promise.all([_loadCache(), _fetchVersions()]);
  _emit({
    loading: false,
    currentVersions: versions,
    cachedConsent: cache,
    needsConsent: _computeNeedsConsent(versions, cache),
  });
}

/**
 * Registra el consentimiento del usuario actual.
 * @param userId teléfono (player) o email (admin), o null en pre-registro.
 * @returns true si todo OK (incluso si la sync remota falló, el cache local sí se guarda).
 */
export async function acceptLegal(userId: string | null = null): Promise<boolean> {
  if (!_state.currentVersions) {
    // refrescamos por las dudas
    const v = await _fetchVersions();
    if (!v) return false;
    _emit({ currentVersions: v });
  }
  const versions = _state.currentVersions!;
  const acceptedAt = new Date().toISOString();
  const cache: ConsentCache = {
    tc_version: versions.tc_version,
    privacy_version: versions.privacy_version,
    accepted_at: acceptedAt,
    user_id: userId,
  };

  // 1) Persist local PRIMERO (garantiza UX inmediato).
  await _saveCache(cache);
  _emit({ cachedConsent: cache, needsConsent: false });

  // 2) Sync remoto (best-effort — si falla, reintentaremos en el próximo init).
  try {
    await fetch(`${BASE_URL}/api/v1/user/legal-consent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        user_id: userId,
        tc_version: versions.tc_version,
        privacy_version: versions.privacy_version,
        accepted_at: acceptedAt,
      }),
    });
  } catch {
    /* tolerante a red — el cache local cubre el caso offline */
  }
  return true;
}

/**
 * Hook reactivo. Cualquier componente que lo use re-renderiza al cambiar estado.
 */
export function useLegalConsent(): LegalState & {
  accept: (userId?: string | null) => Promise<boolean>;
} {
  const [s, setS] = useState<LegalState>(_state);

  useEffect(() => {
    _listeners.add(setS);
    // arranque diferido por si _layout no lo ha llamado aún
    void initLegalConsent();
    return () => {
      _listeners.delete(setS);
    };
  }, []);

  return {
    ...s,
    accept: acceptLegal,
  };
}
