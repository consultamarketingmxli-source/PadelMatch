/** Vista detalle pública de una reta + Pago (individual / dúo / free-agent).
 *
 * Refactor Fase 4 — Auditoría Routing: el archivo solía tener ~1200 líneas
 * mezclando UI de RSVP, checkout, cupón, y deep-link a maps. Ahora la UI
 * grande vive en componentes presentacionales dedicados:
 *
 *   - <RsvpCard />     (retas gratis "entre amigos")
 *   - <CheckoutCard /> (pago MP / waitlist / cupón / dúo / free-agent)
 *
 * Este archivo se queda solo con:
 *   1. Carga + estado de la reta
 *   2. Handlers de negocio (RSVP, validación cupón, checkout, polling pago)
 *   3. Composición del layout (hero + stats + cards + LifeBuoy)
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Trophy,
  DollarSign,
  Users,
  Clock,
  BarChart2,
  Map as MapIcon,
} from "lucide-react-native";

import { api, Reta } from "@/src/api";
import { AttendanceRateCard } from "@/src/components/AttendanceRateCard";
import { TrafficLight } from "@/src/components/TrafficLight";
import { buildPagoReturnUrl } from "@/src/utils/deepLink";
import { openInMaps, buildGoogleMapsUrl } from "@/src/utils/mapsDeepLink";
import { LifeBuoySupport } from "@/src/components/LifeBuoySupport";
import { RsvpCard, type RsvpResult } from "@/src/components/retas/RsvpCard";
import { CheckoutCard, type RegMode, type CuponState } from "@/src/components/retas/CheckoutCard";
import { WaitlistFullModal } from "@/src/components/retas/WaitlistFullModal";
import { HeroBanner } from "@/src/components/brand/HeroBanner";
import { SmartLoader, Skeleton } from "@/src/components/loaders";
import { colors, radii, shadows, spacing, typography } from "@/src/theme";

export default function RetaDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    slug: string;
    pago?: string;
    session_id?: string;
    inscripcion?: string;
    provider?: string;
  }>();
  const { slug } = params;

  const [reta, setReta] = useState<Reta | null>(null);
  const [loading, setLoading] = useState(true);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [parejaNombre, setParejaNombre] = useState("");
  const [parejaTelefono, setParejaTelefono] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verifyingPago, setVerifyingPago] = useState(false);
  const [regMode, setRegMode] = useState<RegMode>("solo");

  // ===== Cupón =====
  const [cuponCodigo, setCuponCodigo] = useState("");
  const [cuponValidando, setCuponValidando] = useState(false);
  const [cuponState, setCuponState] = useState<CuponState>(null);

  // ===== RSVP (retas gratis) =====
  const [rsvpResult, setRsvpResult] = useState<RsvpResult>(null);
  const [rsvpAction, setRsvpAction] = useState<"aceptar" | "rechazar" | null>(null);

  // ===== Fase 5 (Sección 2) — Anti-Oversell Waitlist Modal =====
  const [waitlistPrompt, setWaitlistPrompt] = useState<{
    open: boolean;
    joining?: boolean;
  }>({ open: false });

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const r = await api.getRetaBySlug(slug);
      setReta(r);
      // Auto-seleccionar modo "duo" si la reta es de parejas (UX por defecto).
      const m = r.modalidad_registro ?? "individual";
      if (m === "parejas_libres" || m === "parejas_mixtas") setRegMode("duo");
      else setRegMode("solo");
    } catch {
      Alert.alert("Error", "No se pudo cargar la reta");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Manejo de retorno desde Mercado Pago / Stripe.
  useEffect(() => {
    if (params.pago === "cancelado") {
      Alert.alert("Pago cancelado", "No se realizó el cobro. Tu lugar quedó liberado.");
      return;
    }
    if (params.pago !== "ok" || !params.inscripcion) return;
    let cancelled = false;
    let intentos = 0;
    setVerifyingPago(true);
    const isMp = params.provider === "mp";
    const poll = async () => {
      try {
        while (!cancelled && intentos < 15) {
          intentos++;
          const s = isMp
            ? await api.mpPaymentStatus(params.inscripcion as string)
            : await api.paymentStatus(params.inscripcion as string);
          if (s.estatus_pago === "Aprobado") {
            if (!cancelled) {
              Alert.alert(
                "¡Inscripción confirmada!",
                "Tu pago se procesó correctamente. Nos vemos en cancha.",
              );
              await load();
            }
            return;
          }
          if (s.estatus_pago === "Cancelado" || s.estatus_pago === "Expirado") {
            if (!cancelled) {
              Alert.alert(
                "Pago no confirmado",
                "No pudimos validar tu pago. Inténtalo de nuevo.",
              );
            }
            return;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch {
        // silencioso
      } finally {
        if (!cancelled) setVerifyingPago(false);
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [params.pago, params.inscripcion, params.provider, load]);

  // ===== Derivados =====
  const modalidad = reta?.modalidad_registro ?? "individual";
  const esRetaParejas = modalidad !== "individual";
  const permiteIndiv = !!reta?.permitir_individual_en_parejas;
  const esGratisAmigos = reta?.tipo_acceso === "gratis_amigos";
  const cuponAplicado = cuponState?.ok === true;

  const lleno = reta?.semaforo === "ROJO";

  const costoTotal = useMemo(() => {
    if (!reta) return 0;
    if (cuponAplicado) return 0;
    return regMode === "duo" ? reta.costo_inscripcion * 2 : reta.costo_inscripcion;
  }, [reta, regMode, cuponAplicado]);

  // ===== Handlers Cupón =====
  const handleValidateCupon = async () => {
    if (!reta || !cuponCodigo.trim()) return;
    setCuponValidando(true);
    setCuponState(null);
    try {
      const res = await api.validarCupon(reta.id, cuponCodigo.trim().toUpperCase());
      if (res.valido && res.cupon) {
        setCuponState({ ok: true, codigo: res.cupon.codigo, descripcion: res.cupon.descripcion });
      } else {
        setCuponState({ ok: false, razon: res.razon ?? "Cupón no válido" });
      }
    } catch (e: any) {
      setCuponState({ ok: false, razon: e.message ?? "Error validando cupón" });
    } finally {
      setCuponValidando(false);
    }
  };

  const handleRemoveCupon = () => {
    setCuponCodigo("");
    setCuponState(null);
  };

  const handleChangeCuponCodigo = (t: string) => {
    setCuponCodigo(t.toUpperCase());
    if (cuponState) setCuponState(null);
  };

  // ===== Handlers RSVP =====
  const handleRsvpAceptar = async () => {
    if (!reta) return;
    if (!nombre.trim() || !telefono.trim()) {
      Alert.alert("Datos incompletos", "Ingresa tu nombre y teléfono para confirmar.");
      return;
    }
    setRsvpAction("aceptar");
    const llenoPreClick = lleno;
    try {
      const res = await api.rsvpAceptar(reta.id, {
        nombre: nombre.trim(),
        telefono: telefono.trim(),
      });
      if (res.estatus_confirmacion === "aceptado") {
        setRsvpResult({ tipo: "aceptado", mensaje: res.mensaje });
      } else {
        const baseMsg = res.mensaje || "";
        const lateFillPrefix = !llenoPreClick
          ? "¡Ups! La reta se acaba de llenar mientras escribías. "
          : "";
        setRsvpResult({
          tipo: "lista_espera",
          mensaje: lateFillPrefix + baseMsg,
          posicion: res.posicion_lista_espera ?? undefined,
        });
      }
      await load();
    } catch (e: any) {
      Alert.alert("No se pudo confirmar", e.message ?? "Inténtalo de nuevo.");
    } finally {
      setRsvpAction(null);
    }
  };

  const handleRsvpRechazar = async () => {
    if (!reta) return;
    if (!nombre.trim() || !telefono.trim()) {
      Alert.alert("Datos incompletos", "Ingresa tu nombre y teléfono para responder.");
      return;
    }
    setRsvpAction("rechazar");
    try {
      const res = await api.rsvpRechazar(reta.id, {
        nombre: nombre.trim(),
        telefono: telefono.trim(),
      });
      setRsvpResult({
        tipo: "rechazado",
        mensaje: res.promoted
          ? `Listo, no asistirás. Liberamos tu lugar y avisamos a ${res.promoted_player ?? "la siguiente persona"} en la lista de espera.`
          : "Listo, registramos que no podrás asistir. ¡Gracias por avisar!",
        promoted: res.promoted_player,
      });
      await load();
    } catch (e: any) {
      Alert.alert("No se pudo registrar", e.message ?? "Inténtalo de nuevo.");
    } finally {
      setRsvpAction(null);
    }
  };

  const handleResetRsvp = () => setRsvpResult(null);

  // ===== Handler principal de inscripción / checkout / cupón =====
  const handleAction = async () => {
    if (!reta) return;
    if (!nombre.trim() || !telefono.trim()) {
      Alert.alert("Datos incompletos", "Ingresa tu nombre y teléfono");
      return;
    }

    // Cupón 100% (sin pasarela).
    if (cuponAplicado) {
      setSubmitting(true);
      try {
        await api.canjearCupon(reta.id, {
          nombre: nombre.trim(),
          telefono: telefono.trim(),
          codigo: cuponState!.ok ? cuponState!.codigo : cuponCodigo.trim().toUpperCase(),
        });
        Alert.alert(
          "¡Asistencia confirmada! 🎉",
          `Tu lugar está reservado en ${reta.nombre}. ¡Nos vemos en cancha!`,
        );
        setNombre("");
        setTelefono("");
        setCuponCodigo("");
        setCuponState(null);
        await load();
      } catch (e: any) {
        const msg = e.message ?? "No se pudo canjear";
        // Fase 5 (Sección 2) — Anti-Oversell también aplica al canje de cupón
        // (un cupón 100% sigue reservando un cupo real).
        const isFull =
          msg.startsWith("409:") || /Reta llena/i.test(msg) || /cupos/i.test(msg);
        if (isFull) {
          setWaitlistPrompt({ open: true });
        } else {
          Alert.alert("No se pudo canjear", msg);
        }
        if (/redimid|llen|cupos|otro club|exclusiv/i.test(msg)) {
          setCuponState({ ok: false, razon: msg });
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Validaciones dúo.
    if (regMode === "duo") {
      if (!parejaNombre.trim() || !parejaTelefono.trim()) {
        Alert.alert("Falta tu pareja", "Ingresa el nombre y teléfono de tu pareja.");
        return;
      }
      if (telefono.trim() === parejaTelefono.trim()) {
        Alert.alert("Teléfonos iguales", "Tu teléfono y el de tu pareja no pueden ser iguales.");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (lleno) {
        // Lista de espera (no soporta dúo atómico).
        const wl = await api.joinWaitlist(reta.id, {
          reta_id: reta.id,
          nombre: nombre.trim(),
          telefono: telefono.trim(),
        });
        Alert.alert(
          "Listo",
          `Estás en la lista de espera en posición #${wl.posicion_fila}. Te notificaremos por WhatsApp en cuanto se libere un cupo.`,
        );
      } else {
        const successUrl = buildPagoReturnUrl("exito", { provider: "mp", reta_slug: slug });
        const cancelUrl = buildPagoReturnUrl("fallo", { provider: "mp", reta_slug: slug });

        const checkoutBody: any = {
          nombre: nombre.trim(),
          telefono: telefono.trim(),
          success_url: `${successUrl}${successUrl.includes("?") ? "&" : "?"}inscripcion_id=`,
          cancel_url: cancelUrl,
        };
        if (regMode === "duo") {
          checkoutBody.pareja_nombre = parejaNombre.trim();
          checkoutBody.pareja_telefono = parejaTelefono.trim();
        } else if (regMode === "free_agent") {
          checkoutBody.es_free_agent = true;
        }

        const mpSession = await api.checkoutMercadoPago(reta.id, checkoutBody);
        const url = mpSession.init_point;
        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.location.href = url;
          return;
        } else {
          const Linking = require("expo-linking");
          await Linking.openURL(url);
          Alert.alert(
            "Pago en proceso",
            regMode === "duo"
              ? "Termina el pago en Mercado Pago. Al volver, los DOS lugares quedarán confirmados automáticamente."
              : "Termina el pago en Mercado Pago. Al volver, tu lugar quedará confirmado automáticamente.",
          );
          let intentos = 0;
          const tick = async () => {
            intentos++;
            try {
              const s = await api.mpPaymentStatus(mpSession.inscripcion_id);
              if (s.estatus_pago === "Aprobado") {
                Alert.alert(
                  "¡Inscripción confirmada!",
                  "Tu pago se procesó correctamente.",
                );
                await load();
                return;
              }
              if (s.estatus_pago === "Cancelado") return;
              if (intentos < 30) setTimeout(tick, 3000);
            } catch {
              /* silencioso */
            }
          };
          setTimeout(tick, 5000);
        }
      }
      setNombre("");
      setTelefono("");
      setParejaNombre("");
      setParejaTelefono("");
      await load();
    } catch (e: any) {
      // Fase 5 (Sección 2) — Anti-Oversell.
      // Si el backend devolvió 409 (cupos llenos durante el checkout),
      // ofrecemos sumarse a lista de espera con 1 clic, en vez de un Alert genérico.
      const msg = String(e?.message ?? "");
      const isFull =
        msg.startsWith("409:") ||
        /llen[ao]/i.test(msg) ||
        /lista de espera/i.test(msg);
      if (isFull) {
        setWaitlistPrompt({ open: true });
      } else {
        Alert.alert("Error", e.message ?? "No se pudo procesar");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ===== Fase 5 (Sección 2) — Confirmar unión a waitlist desde modal =====
  const handleJoinWaitlistFromModal = async () => {
    if (!reta) return;
    if (!nombre.trim() || !telefono.trim()) {
      Alert.alert(
        "Datos incompletos",
        "Necesitamos tu nombre y teléfono para sumarte a la lista de espera.",
      );
      setWaitlistPrompt({ open: false });
      return;
    }
    setWaitlistPrompt((s) => ({ ...s, joining: true }));
    try {
      const wl = await api.joinWaitlist(reta.id, {
        reta_id: reta.id,
        nombre: nombre.trim(),
        telefono: telefono.trim(),
      });
      setWaitlistPrompt({ open: false });
      Alert.alert(
        "¡Listo, eres #" + wl.posicion_fila + " en la fila!",
        "Te avisaremos por WhatsApp en cuanto se libere un cupo.",
      );
      await load();
    } catch (e: any) {
      setWaitlistPrompt({ open: false });
      Alert.alert("No se pudo unir", e?.message ?? "Intenta de nuevo en unos segundos.");
    }
  };

  if (loading || !reta) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <SmartLoader loading={true} skeleton={<Skeleton.RetaDetail />} />
      </SafeAreaView>
    );
  }

  const fecha = new Date(reta.fecha_evento);
  const fechaStr = fecha.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const horaStr = fecha.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

  const ctaText = lleno
    ? "Unirse a Lista de Espera"
    : cuponAplicado
      ? "Confirmar Asistencia con Cupón Gratis 🎉"
      : regMode === "duo"
        ? `Pagar $${costoTotal} (2 lugares) e Inscribir Pareja`
        : `Pagar $${costoTotal} e Inscribirme`;

  const modalidadLabel =
    modalidad === "parejas_mixtas"
      ? "Parejas mixtas"
      : modalidad === "parejas_libres"
        ? "Parejas"
        : "Individual";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} testID="back-btn" style={styles.iconBtn}>
              <ArrowLeft size={18} color={colors.text.primary} />
            </TouchableOpacity>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <TouchableOpacity
                onPress={() => router.push(`/retas/tabla/${reta.id}` as any)}
                style={styles.iconBtn}
                testID="ver-tabla-btn"
              >
                <BarChart2 size={18} color={colors.brand.primary} />
              </TouchableOpacity>
              <TrafficLight status={reta.semaforo} capacidadPct={reta.capacidad_pct} />
            </View>
          </View>

          <HeroBanner
            eyebrow={`PADELAPPRETAS · ${(reta.modalidad_juego || "RETA").toUpperCase()}`}
            title={reta.nombre}
            subtitle={`${reta.club} · ${fechaStr} · ${horaStr}`}
            height={188}
            style={{ marginBottom: spacing.lg }}
          />

          <View style={styles.heroRow}>
            <View style={styles.logoBox}>
              {reta.organizador_logo_url ? (
                <Image source={{ uri: reta.organizador_logo_url }} style={styles.logo} />
              ) : (
                <Text style={styles.logoFallback}>PR</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hero} numberOfLines={2}>
                {reta.nombre}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  void openInMaps({
                    nombre: reta.club,
                    direccion: (reta as any).club_direccion,
                    lat: reta.latitud,
                    lng: reta.longitud,
                  });
                }}
                activeOpacity={0.7}
                style={styles.metaRow}
                testID="club-deeplink-maps"
                accessibilityLabel="Abrir ubicación en Google Maps"
                accessibilityRole="link"
                disabled={
                  !buildGoogleMapsUrl({
                    nombre: reta.club,
                    direccion: (reta as any).club_direccion,
                    lat: reta.latitud,
                    lng: reta.longitud,
                  })
                }
              >
                <MapPin size={13} color={colors.brand.primary} />
                <Text style={styles.clubText} numberOfLines={2}>
                  {reta.club || "Ubicación por confirmar"}
                  {(reta as any).club_direccion ? (
                    <Text style={styles.clubAddrText}>{" · "}{(reta as any).club_direccion}</Text>
                  ) : null}
                </Text>
                {buildGoogleMapsUrl({
                  nombre: reta.club,
                  direccion: (reta as any).club_direccion,
                  lat: reta.latitud,
                  lng: reta.longitud,
                }) ? (
                  <View style={styles.mapsCta} testID="club-deeplink-cta">
                    <MapIcon size={12} color={colors.brand.primary} />
                    <Text style={styles.mapsCtaText}>Mapa</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
              {esRetaParejas ? (
                <View style={styles.modalidadChip} testID="modalidad-chip">
                  <Users size={11} color={colors.brand.primary} />
                  <Text style={styles.modalidadChipText}>{modalidadLabel}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {reta.observaciones_publicas ? (
            <View style={styles.obsBox} testID="observaciones-box">
              <Text style={styles.obsLabel}>NOTA DEL ORGANIZADOR</Text>
              <Text style={styles.obsText}>{reta.observaciones_publicas}</Text>
            </View>
          ) : null}

          <View style={styles.statsGrid}>
            <StatBlock icon={<Calendar size={16} color={colors.brand.primary} />} label="Fecha" value={fechaStr} />
            <StatBlock icon={<Clock size={16} color={colors.brand.primary} />} label="Hora" value={horaStr} />
            <StatBlock icon={<Trophy size={16} color={colors.brand.primary} />} label="Modalidad" value={reta.modalidad_juego} />
            <StatBlock
              icon={<DollarSign size={16} color={colors.brand.primary} />}
              label="Costo"
              value={esGratisAmigos ? "Gratis" : `$${reta.costo_inscripcion}`}
            />
            <StatBlock
              icon={<Users size={16} color={colors.brand.primary} />}
              label="Cupo"
              value={`${reta.inscritos_count}/${reta.max_jugadores}`}
            />
            <StatBlock
              icon={<Trophy size={16} color={colors.brand.primary} />}
              label="Rondas"
              value={String(reta.num_rondas)}
            />
          </View>

          {verifyingPago ? (
            <View style={styles.verifyBox} testID="verifying-pago">
              <ActivityIndicator color={colors.brand.primary} />
              <Text style={styles.verifyTxt}>Confirmando tu pago…</Text>
            </View>
          ) : null}

          {/* Feedback visual P2 — sólo si la reta tiene Anti-Flake activado. */}
          <AttendanceRateCard
            retaId={reta.id}
            telefono={telefono}
            threshold={(reta as any).asistencia_minima_pct ?? 90}
            enabled={!!(reta as any).requiere_alta_asistencia}
            label="Tú"
          />

          {/* Feedback visual P3 — mismo gate para el compañero/a en retas de parejas. */}
          {esRetaParejas && regMode === "duo" ? (
            <AttendanceRateCard
              retaId={reta.id}
              telefono={parejaTelefono}
              threshold={(reta as any).asistencia_minima_pct ?? 90}
              enabled={!!(reta as any).requiere_alta_asistencia}
              label="Tu compañero/a"
            />
          ) : null}

          {/* Fase A — Tarjeta RSVP para retas gratuitas. */}
          {esGratisAmigos ? (
            <RsvpCard
              lleno={!!lleno}
              nombre={nombre}
              telefono={telefono}
              onChangeNombre={setNombre}
              onChangeTelefono={setTelefono}
              rsvpAction={rsvpAction}
              onAceptar={handleRsvpAceptar}
              onRechazar={handleRsvpRechazar}
              rsvpResult={rsvpResult}
              onReset={handleResetRsvp}
            />
          ) : (
            <CheckoutCard
              lleno={!!lleno}
              esRetaParejas={esRetaParejas}
              permiteIndiv={permiteIndiv}
              regMode={regMode}
              onChangeRegMode={setRegMode}
              nombre={nombre}
              telefono={telefono}
              parejaNombre={parejaNombre}
              parejaTelefono={parejaTelefono}
              onChangeNombre={setNombre}
              onChangeTelefono={setTelefono}
              onChangeParejaNombre={setParejaNombre}
              onChangeParejaTelefono={setParejaTelefono}
              costoUnitario={reta.costo_inscripcion}
              cuponCodigo={cuponCodigo}
              cuponState={cuponState}
              cuponValidando={cuponValidando}
              cuponAplicado={cuponAplicado}
              onChangeCuponCodigo={handleChangeCuponCodigo}
              onValidateCupon={handleValidateCupon}
              onRemoveCupon={handleRemoveCupon}
              ctaText={ctaText}
              submitting={submitting}
              onAction={handleAction}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {/* FAB de soporte (Fase B) — flotante sobre toda la vista */}
      <LifeBuoySupport slug={String(slug)} retaNombre={reta.nombre} />

      {/* Fase 5 (Sección 2) — Anti-Oversell Waitlist Modal */}
      <WaitlistFullModal
        visible={waitlistPrompt.open}
        retaNombre={reta?.nombre}
        loading={!!waitlistPrompt.joining}
        esDuo={regMode === "duo"}
        onConfirm={handleJoinWaitlistFromModal}
        onClose={() => setWaitlistPrompt({ open: false })}
      />
    </SafeAreaView>
  );
}

function StatBlock({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.statBlock}>
      <View style={styles.statHead}>
        {icon}
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    alignItems: "center",
    justifyContent: "center",
  },
  heroRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  logoBox: {
    width: 64,
    height: 64,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
    backgroundColor: colors.brand.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logo: { width: 64, height: 64 },
  logoFallback: { color: colors.brand.primary, fontWeight: "900", fontSize: 16 },
  hero: { ...typography.h1, color: colors.text.primary, fontSize: 26 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  clubText: { color: colors.text.secondary, fontSize: 13, flex: 1 },
  clubAddrText: { color: colors.text.secondary, fontSize: 11, opacity: 0.7 },
  mapsCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: colors.brand.primarySoft,
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
  },
  mapsCtaText: {
    color: colors.brand.primary,
    fontWeight: "800",
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  modalidadChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.sm,
    backgroundColor: colors.brand.primarySoft,
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
    marginTop: 6,
  },
  modalidadChipText: {
    color: colors.brand.primary,
    fontWeight: "700",
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  obsBox: {
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
    backgroundColor: colors.brand.primarySoft,
    borderRadius: radii.md,
    padding: spacing.md,
    borderStyle: "dashed",
    marginBottom: spacing.lg,
  },
  obsLabel: { ...typography.label, color: colors.brand.primary, fontSize: 10, marginBottom: 6 },
  obsText: { color: colors.text.primary, lineHeight: 20 },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  statBlock: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  statHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  statLabel: { ...typography.label, color: colors.text.secondary, fontSize: 10 },
  statValue: { color: colors.text.primary, fontWeight: "700", fontSize: 15 },
  verifyBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brand.primarySoft,
    borderWidth: 1,
    borderColor: colors.brand.primaryBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  verifyTxt: { color: colors.brand.primary, fontWeight: "700", fontSize: 13 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
