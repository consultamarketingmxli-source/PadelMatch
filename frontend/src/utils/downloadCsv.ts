/**
 * downloadCsv.ts — Descarga CSV cross-platform (web + iOS + Android).
 *
 * • Web: usa Blob + URL.createObjectURL + <a download> simulado.
 * • Native: descarga el CSV a cache con FileSystem + abre share sheet con
 *   expo-sharing (el usuario decide guardar/compartir/mail).
 *
 * El backend devuelve el archivo con header `Content-Disposition: attachment`
 * pero RN/Web no respeta ese header en `fetch`; lo manejamos manualmente.
 */
import { Platform } from "react-native";

import { backendBaseUrl, getAdminAccessToken } from "@/src/api";

type Result = { ok: boolean; filename: string; bytes: number };

function buildFilename(prefix = "padelappretas-security"): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate(),
  )}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${stamp}.csv`;
}

export async function downloadAdminCsv(path: string): Promise<Result> {
  const token = await getAdminAccessToken();
  if (!token) throw new Error("Sin sesión admin activa.");
  const base = backendBaseUrl();
  // El cliente ya antepone /api en `request`; aquí lo añadimos manualmente
  // porque estamos haciendo fetch directo al endpoint.
  const url = `${base}/api${path}`;
  const filename = buildFilename();

  if (Platform.OS === "web") {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include",
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const bytes = blob.size;
    // DOM only — solo se ejecuta en plataforma web.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w: any = globalThis as any;
    const objUrl = w.URL.createObjectURL(blob);
    const a = w.document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    w.document.body.appendChild(a);
    a.click();
    w.document.body.removeChild(a);
    w.URL.revokeObjectURL(objUrl);
    return { ok: true, filename, bytes };
  }

  // Native (iOS/Android) — descargar a cache + share sheet.
  // Import dinámico para evitar overhead en web.
  const FileSystem = await import("expo-file-system");
  const Sharing = await import("expo-sharing");

  // expo-file-system v19+: API namespaced bajo `legacy` para compat.
  // Pero `downloadAsync` sigue exportado en root también.
  const fs: any = (FileSystem as any).legacy ?? FileSystem;

  const dest = `${fs.cacheDirectory}${filename}`;
  const result = await fs.downloadAsync(url, dest, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!result.uri) throw new Error("Falló la descarga.");

  const isAvail = await Sharing.isAvailableAsync();
  if (isAvail) {
    await Sharing.shareAsync(result.uri, {
      mimeType: "text/csv",
      dialogTitle: "Compartir audit log CSV",
      UTI: "public.comma-separated-values-text",
    });
  }
  return { ok: true, filename, bytes: 0 };
}
