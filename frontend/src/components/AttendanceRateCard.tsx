/**
 * AttendanceRateCard — Feedback visual del rate de asistencia (P2 Anti-Flake).
 *
 * Visible **sólo** cuando la reta tiene `requiere_alta_asistencia=true`.
 * Hace un fetch debounced (450ms) al endpoint `/asistencia-check` cuando el
 * teléfono tiene ≥ 10 caracteres (E.164 corto mínimo) y muestra uno de 4
 * estados visuales:
 *
 *   • idle    — sin teléfono aún → CTA informativo del filtro activo.
 *   • loading — fetch en curso → spinner.
 *   • pass    — rate ≥ threshold → bandeja VERDE con check.
 *   • exempt  — sample < 3 retas → bandeja ÁMBAR (jugador nuevo, exento).
 *   • fail    — rate < threshold → bandeja ROJA, no podrá inscribirse.
 *
 * Estética premium: superficie crema sutil, borde categórico de 1px,
 * tipografía Plus Jakarta Sans (heredada del sistema), iconografía Lucide.
 */
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { AlertCircle, CheckCircle2, Sparkles, ShieldAlert } from "lucide-react-native";

import { api } from "@/src/api";
import { colors, radii, spacing, typography } from "@/src/theme";

const DEBOUNCE_MS = 450;
const MIN_PHONE_LEN = 10;

type CheckResponse = {
  gate_on: boolean;
  threshold: number;
  rate_pct: number;
  sample_size: number;
  exento: boolean;
  passes: boolean;
  min_sample: number;
};

type Props = {
  /** ID de la reta para el endpoint. */
  retaId: string;
  /** Teléfono actual del input (raw, no normalizado). */
  telefono: string;
  /** Threshold del organizador (default 90). Solo informativo. */
  threshold?: number;
  /** Sólo se renderiza si la reta tiene el filtro activo. */
  enabled: boolean;
  /** Etiqueta opcional para distinguir cuando hay varias tarjetas (ej. "Tu compañero/a"). */
  label?: string;
};

export const AttendanceRateCard: React.FC<Props> = ({
  retaId,
  telefono,
  threshold = 90,
  enabled,
  label,
}) => {
  const [data, setData] = useState<CheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const tel = (telefono || "").trim();
    if (tel.length < MIN_PHONE_LEN) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const reqId = ++reqRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.asistenciaCheck(retaId, tel);
        // Sólo aplicamos respuesta si es la última petición disparada.
        if (reqRef.current === reqId) setData(res);
      } catch (e: any) {
        if (reqRef.current === reqId) {
          setError(e?.message?.includes("400") ? "Teléfono incompleto" : "No pudimos verificar");
          setData(null);
        }
      } finally {
        if (reqRef.current === reqId) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [telefono, enabled, retaId]);

  if (!enabled) return null;

  // Helper para anteponer la etiqueta cuando se renderizan varias tarjetas.
  // Ej: label="Tu compañero/a" → "Tu compañero/a · Pasas el filtro · 100% asistencia"
  const tagged = (s: string) => (label ? `${label} · ${s}` : s);

  // === Estado: idle (sin teléfono aún) ===
  const tel = (telefono || "").trim();
  if (tel.length < MIN_PHONE_LEN) {
    return (
      <View style={[s.card, s.idleCard]}>
        <View style={s.iconWrap}>
          <ShieldAlert size={20} color={colors.brand.azure} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{tagged("Filtro Anti-Flake activo")}</Text>
          <Text style={s.subtitle}>
            {label
              ? `Confirma la elegibilidad de tu compañero/a al ingresar su teléfono. Requisito: ≥${threshold}% asistencia.`
              : `Esta reta requiere ≥${threshold}% de asistencia histórica. Te confirmamos tu elegibilidad al ingresar tu teléfono.`}
          </Text>
        </View>
      </View>
    );
  }

  // === Estado: loading ===
  if (loading || (!data && !error)) {
    return (
      <View style={[s.card, s.idleCard]}>
        <ActivityIndicator size="small" color={colors.brand.azure} />
        <View style={{ flex: 1, marginLeft: spacing.sm }}>
          <Text style={s.title}>{tagged("Verificando asistencia…")}</Text>
          <Text style={s.subtitle}>Consultando el historial reciente.</Text>
        </View>
      </View>
    );
  }

  // === Estado: error ===
  if (error || !data) {
    return (
      <View style={[s.card, s.amberCard]}>
        <View style={s.iconWrap}>
          <AlertCircle size={20} color={colors.status.amberText} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: colors.status.amberText }]}>{tagged(error || "Verificación no disponible")}</Text>
          <Text style={[s.subtitle, { color: colors.status.amberText }]}>Continúa tu inscripción normalmente.</Text>
        </View>
      </View>
    );
  }

  // === Estado: exempt (nuevo jugador) ===
  if (data.exento) {
    return (
      <View style={[s.card, s.amberCard]} testID="antiflake-exempt">
        <View style={s.iconWrap}>
          <Sparkles size={20} color={colors.status.amberText} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: colors.status.amberText }]}>{tagged("Bienvenido — exento")}</Text>
          <Text style={[s.subtitle, { color: colors.status.amberText }]}>
            {label ? "Aún" : "Aún no tienes"} suficiente historial ({data.sample_size}/{data.min_sample} retas).
            {label ? " Tu compañero/a recibe el beneficio de la duda · podrá inscribirse." : " Te damos el beneficio de la duda · podrás inscribirte."}
          </Text>
        </View>
      </View>
    );
  }

  // === Estado: pass ===
  if (data.passes) {
    return (
      <View style={[s.card, s.passCard]} testID="antiflake-pass">
        <View style={s.iconWrap}>
          <CheckCircle2 size={22} color={colors.status.greenText} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: colors.status.greenText }]}>
            {tagged(`Pasa el filtro · ${data.rate_pct}% asistencia`)}
          </Text>
          <Text style={[s.subtitle, { color: colors.status.greenText }]}>
            Mínimo requerido: {data.threshold}% · {data.sample_size} retas en historial.
            {label ? " Tu compañero/a es confiable." : " ¡Eres jugador confiable!"}
          </Text>
        </View>
      </View>
    );
  }

  // === Estado: fail ===
  return (
    <View style={[s.card, s.failCard]} testID="antiflake-fail">
      <View style={s.iconWrap}>
        <AlertCircle size={22} color={colors.status.redText} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.title, { color: colors.status.redText }]}>
          {tagged(`No cumple el filtro · ${data.rate_pct}%`)}
        </Text>
        <Text style={[s.subtitle, { color: colors.status.redText }]}>
          El organizador exige mínimo {data.threshold}% de asistencia.
          {label ? " Tu compañero/a tiene " : " Tu historial: "}{data.sample_size} retas pasadas.
          {label
            ? " La pareja no podrá completar el checkout. Cambia de compañero/a."
            : " No podrás completar el checkout en esta reta."}
        </Text>
      </View>
    </View>
  );
};

export default AttendanceRateCard;

const s = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.base,
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: spacing.base,
  },
  iconWrap: {
    width: 32,
    alignItems: "center",
    paddingTop: 2,
  },
  title: {
    ...typography.h6,
    color: colors.text.primary,
    fontWeight: "700",
    marginBottom: 2,
    fontSize: 15,
  },
  subtitle: {
    ...typography.body,
    color: colors.text.secondary,
    fontSize: 13,
    lineHeight: 18,
  },
  // === variantes de color ===
  idleCard: {
    backgroundColor: "#F8FAFC",
    borderColor: colors.border.default,
  },
  passCard: {
    backgroundColor: colors.status.greenBg,
    borderColor: colors.status.greenBorder,
  },
  amberCard: {
    backgroundColor: colors.status.amberBg,
    borderColor: colors.status.amberBorder,
  },
  failCard: {
    backgroundColor: colors.status.redBg,
    borderColor: colors.status.redBorder,
  },
});
