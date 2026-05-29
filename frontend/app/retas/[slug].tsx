/** Vista detalle pública de una reta + Pago (individual / dúo / free-agent). */
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
  ArrowLeft, Calendar, MapPin, Trophy, DollarSign, Users, Clock, BarChart2,
  UserPlus, Search, CheckCircle2, XCircle, Gift, PartyPopper, Hourglass, Heart, Map as MapIcon,
} from "lucide-react-native";

import { api, Reta } from "@/src/api";
import { TrafficLight } from "@/src/components/TrafficLight";
import { Button } from "@/src/components/Button";
import { Input } from "@/src/components/Input";
import { buildPagoReturnUrl } from "@/src/utils/deepLink";
import { openInMaps, buildGoogleMapsUrl } from "@/src/utils/mapsDeepLink";
import { LifeBuoySupport } from "@/src/components/LifeBuoySupport";
import { colors, radii, spacing, typography } from "@/src/theme";

export default function RetaDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug: string; pago?: string; session_id?: string; inscripcion?: string; provider?: string }>();
  const { slug } = params;
  const [reta, setReta] = useState<Reta | null>(null);
  const [loading, setLoading] = useState(true);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [parejaNombre, setParejaNombre] = useState("");
  const [parejaTelefono, setParejaTelefono] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verifyingPago, setVerifyingPago] = useState(false);
  const [regMode, setRegMode] = useState("solo"); // "solo" | "duo" | "free_agent"

  // ===== Estado del cupón =====
  // codigo: input del usuario, cuponState: resultado de la validación.
  const [cuponCodigo, setCuponCodigo] = useState("");
  const [cuponValidando, setCuponValidando] = useState(false);
  const [cuponState, setCuponState] = useState<
    null | { ok: true; codigo: string; descripcion: string } | { ok: false; razon: string }
  >(null);

  // ===== Estado RSVP (Retas Gratis / Entre Amigos) =====
  const [rsvpResult, setRsvpResult] = useState<
    | null
    | { tipo: "aceptado"; mensaje: string }
    | { tipo: "lista_espera"; mensaje: string; posicion?: number }
    | { tipo: "rechazado"; mensaje: string; promoted?: string | null }
  >(null);
  const [rsvpAction, setRsvpAction] = useState<"aceptar" | "rechazar" | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const r = await api.getRetaBySlug(slug);
      setReta(r);
      // Auto-seleccionar modo "duo" si la reta es de parejas (UX por defecto).
      const m = r.modalidad_registro ?? "individual";
      if (m === "parejas_libres" || m === "parejas_mixtas") {
        setRegMode("duo");
      } else {
        setRegMode("solo");
      }
    } catch (e) {
      Alert.alert("Error", "No se pudo cargar la reta");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Manejo de retorno desde Mercado Pago / Stripe: poll del status hasta confirmación.
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
              Alert.alert("¡Inscripción confirmada!", "Tu pago se procesó correctamente. Nos vemos en cancha.");
              await load();
            }
            return;
          }
          if (s.estatus_pago === "Cancelado" || s.estatus_pago === "Expirado") {
            if (!cancelled) {
              Alert.alert("Pago no confirmado", "No pudimos validar tu pago. Inténtalo de nuevo.");
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
    return () => { cancelled = true; };
  }, [params.pago, params.inscripcion, params.provider, load]);

  // Modalidad de la reta (memoizada para condicionales UI).
  const modalidad = reta?.modalidad_registro ?? "individual";
  const esRetaParejas = modalidad !== "individual";
  const permiteIndiv = !!reta?.permitir_individual_en_parejas;

  // Fase A — ¿Es reta gratis (entre amigos)? Activa flujo RSVP en lugar de pago.
  const esGratisAmigos = reta?.tipo_acceso === "gratis_amigos";

  // Flag derivado de cuponState — se declara ANTES de costoTotal para evitar
  // ReferenceError por TDZ de const.
  const cuponAplicado = cuponState?.ok === true;

  // Costo total estimado a mostrar en el CTA según modo.
  const costoTotal = useMemo(() => {
    if (!reta) return 0;
    if (cuponAplicado) return 0; // Cupón 100% → muestra $0
    return regMode === "duo" ? reta.costo_inscripcion * 2 : reta.costo_inscripcion;
  }, [reta, regMode, cuponAplicado]);

  // Cupos requeridos según modo — informativo (no se usa en validación directa).
  // const cuposRequeridos = regMode === "duo" ? 2 : 1;

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

  // ===== Handlers RSVP (Retas Gratis) =====
  const handleRsvpAceptar = async () => {
    if (!reta) return;
    if (!nombre.trim() || !telefono.trim()) {
      Alert.alert("Datos incompletos", "Ingresa tu nombre y teléfono para confirmar.");
      return;
    }
    setRsvpAction("aceptar");
    try {
      const res = await api.rsvpAceptar(reta.id, {
        nombre: nombre.trim(),
        telefono: telefono.trim(),
      });
      if (res.estatus_confirmacion === "aceptado") {
        setRsvpResult({ tipo: "aceptado", mensaje: res.mensaje });
      } else {
        setRsvpResult({
          tipo: "lista_espera",
          mensaje: res.mensaje,
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

  const handleResetRsvp = () => {
    setRsvpResult(null);
  };

  const handleAction = async () => {
    if (!reta) return;
    if (!nombre.trim() || !telefono.trim()) {
      Alert.alert("Datos incompletos", "Ingresa tu nombre y teléfono");
      return;
    }

    // ===== FLUJO CUPÓN (express, sin pasarela) =====
    if (cuponAplicado) {
      setSubmitting(true);
      try {
        const res = await api.canjearCupon(reta.id, {
          nombre: nombre.trim(),
          telefono: telefono.trim(),
          codigo: cuponState!.ok ? cuponState!.codigo : cuponCodigo.trim().toUpperCase(),
        });
        Alert.alert(
          "¡Asistencia confirmada! 🎉",
          `Tu lugar está reservado en ${reta.nombre}. ¡Nos vemos en cancha!`,
        );
        // Limpiamos y refrescamos.
        setNombre("");
        setTelefono("");
        setCuponCodigo("");
        setCuponState(null);
        await load();
      } catch (e: any) {
        // Si la reta se llenó entre apply y canje, mostramos copy específico.
        const msg = e.message ?? "No se pudo canjear";
        Alert.alert("No se pudo canjear", msg);
        // Si el cupón ya no es válido, limpiamos estado.
        if (/redimid|llen|cupos|otro club|exclusiv/i.test(msg)) {
          setCuponState({ ok: false, razon: msg });
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Validaciones específicas para dúo.
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
      if (reta.semaforo === "ROJO") {
        // En lista de espera no soportamos dúo atómico (sumamos solo al jugador principal).
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

        // Construcción del body con los campos pareja-aware (solo si aplica).
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
                Alert.alert("¡Inscripción confirmada!", "Tu pago se procesó correctamente.");
                await load();
                return;
              }
              if (s.estatus_pago === "Cancelado") return;
              if (intentos < 30) setTimeout(tick, 3000);
            } catch { /* silencioso */ }
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
      Alert.alert("Error", e.message ?? "No se pudo procesar");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !reta) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const fecha = new Date(reta.fecha_evento);
  const fechaStr = fecha.toLocaleDateString("es-MX", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const horaStr = fecha.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  const lleno = reta.semaforo === "ROJO";

  // Texto del CTA (botón de pago) según modo.
  const ctaText = lleno
    ? "Unirse a Lista de Espera"
    : cuponAplicado
      ? "Confirmar Asistencia con Cupón Gratis 🎉"
      : regMode === "duo"
        ? `Pagar $${costoTotal} (2 lugares) e Inscribir Pareja`
        : `Pagar $${costoTotal} e Inscribirme`;

  // Etiqueta de la modalidad de inscripción para chip informativo.
  const modalidadLabel = modalidad === "parejas_mixtas"
    ? "Parejas mixtas"
    : modalidad === "parejas_libres" ? "Parejas" : "Individual";

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

          <View style={styles.heroRow}>
            <View style={styles.logoBox}>
              {reta.organizador_logo_url ? (
                <Image source={{ uri: reta.organizador_logo_url }} style={styles.logo} />
              ) : (
                <Text style={styles.logoFallback}>PR</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.hero} numberOfLines={2}>{reta.nombre}</Text>
              <TouchableOpacity
                onPress={() => {
                  // Helper centralizado: maneja iOS (Apple Maps), Android (Google Maps),
                  // y web (window.open) con fallback robusto. Si no hay datos suficientes,
                  // openInMaps devuelve false silenciosamente.
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
                // Si no hay club ni dirección ni coords, no es clickable (no destino).
                disabled={!buildGoogleMapsUrl({
                  nombre: reta.club,
                  direccion: (reta as any).club_direccion,
                  lat: reta.latitud,
                  lng: reta.longitud,
                })}
              >
                <MapPin size={13} color={colors.brand.primary} />
                <Text style={styles.clubText} numberOfLines={2}>
                  {reta.club || "Ubicación por confirmar"}
                  {(reta as any).club_direccion ? (
                    <Text style={styles.clubAddrText}>{" · "}{(reta as any).club_direccion}</Text>
                  ) : null}
                </Text>
                {/* Chip MAPA — solo si tenemos destino válido (coords O texto). */}
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
              {/* Chip de modalidad — visible solo si es reta de parejas. */}
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
            <StatBlock icon={<DollarSign size={16} color={colors.brand.primary} />} label="Costo" value={esGratisAmigos ? "Gratis" : `$${reta.costo_inscripcion}`} />
            <StatBlock icon={<Users size={16} color={colors.brand.primary} />} label="Cupo" value={`${reta.inscritos_count}/${reta.max_jugadores}`} />
            <StatBlock icon={<Trophy size={16} color={colors.brand.primary} />} label="Rondas" value={String(reta.num_rondas)} />
          </View>

          {/* ===== Fase A — Tarjeta RSVP (Retas Gratis / Entre Amigos) ===== */}
          {esGratisAmigos ? (
            <View style={styles.rsvpCard} testID="rsvp-card">
              {/* Banner "evento gratuito" */}
              <View style={styles.rsvpBadge}>
                <Heart size={12} color="#047857" />
                <Text style={styles.rsvpBadgeText}>Evento gratuito · sin cargo</Text>
              </View>

              {rsvpResult ? (
                /* ===== Estado de respuesta confirmada ===== */
                <View style={styles.rsvpStateBox} testID={`rsvp-state-${rsvpResult.tipo}`}>
                  {rsvpResult.tipo === "aceptado" ? (
                    <>
                      <View style={[styles.rsvpStateIcon, { backgroundColor: "#ECFDF5", borderColor: "#10B98155" }]}>
                        <PartyPopper size={28} color="#047857" />
                      </View>
                      <Text style={[styles.rsvpStateTitle, { color: "#047857" }]}>¡Asistencia confirmada!</Text>
                      <Text style={styles.rsvpStateMsg}>{rsvpResult.mensaje}</Text>
                    </>
                  ) : rsvpResult.tipo === "lista_espera" ? (
                    <>
                      <View style={[styles.rsvpStateIcon, { backgroundColor: "#FFFBEB", borderColor: "#F59E0B55" }]}>
                        <Hourglass size={28} color="#B45309" />
                      </View>
                      <Text style={[styles.rsvpStateTitle, { color: "#B45309" }]}>Quedaste en lista de espera</Text>
                      <Text style={styles.rsvpStateMsg}>{rsvpResult.mensaje}</Text>
                      {rsvpResult.posicion ? (
                        <View style={styles.rsvpPosBadge}>
                          <Text style={styles.rsvpPosBadgeText}>Posición #{rsvpResult.posicion}</Text>
                        </View>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <View style={[styles.rsvpStateIcon, { backgroundColor: "#F1F5F9", borderColor: colors.border.default }]}>
                        <XCircle size={28} color={colors.text.secondary} />
                      </View>
                      <Text style={[styles.rsvpStateTitle, { color: colors.text.primary }]}>Respuesta registrada</Text>
                      <Text style={styles.rsvpStateMsg}>{rsvpResult.mensaje}</Text>
                    </>
                  )}
                  <TouchableOpacity
                    onPress={handleResetRsvp}
                    style={styles.rsvpResetBtn}
                    testID="rsvp-reset-btn"
                  >
                    <Text style={styles.rsvpResetBtnText}>Cambiar respuesta</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                /* ===== Formulario RSVP ===== */
                <>
                  <Text style={styles.rsvpTitle}>
                    {lleno ? "La reta ya está llena" : "¿Te apuntas?"}
                  </Text>
                  <Text style={styles.rsvpSubtitle}>
                    {lleno
                      ? "Puedes registrarte y te dejaremos en lista de espera. Si alguien cancela, te avisamos."
                      : "Confirma tu nombre y teléfono. Un toque para aceptar o rechazar la invitación."}
                  </Text>

                  <Input
                    label="Tu nombre completo"
                    placeholder="Ej. Andrés Sánchez"
                    value={nombre}
                    onChangeText={setNombre}
                    autoCapitalize="words"
                    testID="rsvp-nombre-input"
                  />
                  <Input
                    label="Tu teléfono (WhatsApp)"
                    placeholder="+5215512345678"
                    value={telefono}
                    onChangeText={setTelefono}
                    keyboardType="phone-pad"
                    testID="rsvp-telefono-input"
                  />

                  {/* Botones grandes ACEPTAR / RECHAZAR */}
                  <View style={styles.rsvpBtnRow}>
                    <TouchableOpacity
                      onPress={handleRsvpAceptar}
                      disabled={rsvpAction !== null}
                      activeOpacity={0.85}
                      style={[
                        styles.rsvpAcceptBtn,
                        rsvpAction !== null && { opacity: 0.5 },
                      ]}
                      testID="rsvp-aceptar-btn"
                    >
                      {rsvpAction === "aceptar" ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <>
                          <CheckCircle2 size={20} color="#fff" />
                          <Text style={styles.rsvpAcceptBtnText}>
                            {lleno ? "Unirme a lista de espera" : "Aceptar"}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={handleRsvpRechazar}
                      disabled={rsvpAction !== null}
                      activeOpacity={0.85}
                      style={[
                        styles.rsvpRejectBtn,
                        rsvpAction !== null && { opacity: 0.5 },
                      ]}
                      testID="rsvp-rechazar-btn"
                    >
                      {rsvpAction === "rechazar" ? (
                        <ActivityIndicator color={colors.text.secondary} />
                      ) : (
                        <>
                          <XCircle size={18} color={colors.text.secondary} />
                          <Text style={styles.rsvpRejectBtnText}>Rechazar</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.rsvpFinePrint}>
                    Sin pagos. Sin cargos ocultos. El organizador te confirmará por WhatsApp.
                  </Text>
                </>
              )}
            </View>
          ) : null}

          {/* ===== Tarjeta de inscripción / pago (solo si NO es gratis_amigos) ===== */}
          {!esGratisAmigos ? (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>
              {lleno ? "Únete a la lista de espera" : "Asegura tu lugar"}
            </Text>
            <Text style={styles.formSubtitle}>
              {lleno
                ? "Te notificaremos por WhatsApp cuando se libere un cupo (5 min para confirmar)."
                : regMode === "duo"
                  ? "Reservamos 2 lugares atómicamente. Tu pareja queda inscrita con el mismo pago."
                  : "Tu lugar se bloquea por 5 minutos mientras procesamos tu pago."}
            </Text>

            {/* Selector ¿Solo o con pareja? — visible solo si la reta es de parejas y no está llena. */}
            {esRetaParejas && !lleno ? (
              <View style={styles.modeSelector} testID="reg-mode-selector">
                <ModeChip
                  active={regMode === "duo"}
                  onPress={() => setRegMode("duo")}
                  icon={<UserPlus size={14} color={regMode === "duo" ? "#fff" : colors.text.primary} />}
                  label="Con mi pareja"
                  testID="mode-duo"
                />
                {permiteIndiv ? (
                  <ModeChip
                    active={regMode === "free_agent"}
                    onPress={() => setRegMode("free_agent")}
                    icon={<Search size={14} color={regMode === "free_agent" ? "#fff" : colors.text.primary} />}
                    label="Busco pareja"
                    testID="mode-free-agent"
                  />
                ) : null}
              </View>
            ) : null}

            {/* Info contextual para modo busco-pareja. */}
            {regMode === "free_agent" ? (
              <View style={styles.infoFreeAgent}>
                <Text style={styles.infoFreeAgentText}>
                  Te inscribirás como “free-agent”. El organizador te emparejará
                  manualmente con otro jugador antes de que arranque la reta.
                </Text>
              </View>
            ) : null}

            <Input
              label="Tu nombre completo"
              placeholder="Ej. Andrés Sánchez"
              value={nombre}
              onChangeText={setNombre}
              autoCapitalize="words"
              testID="checkout-nombre-input"
            />
            <Input
              label="Tu teléfono (WhatsApp)"
              placeholder="+5215512345678"
              value={telefono}
              onChangeText={setTelefono}
              keyboardType="phone-pad"
              testID="checkout-telefono-input"
            />

            {/* Inputs dinámicos solo si modo dúo. */}
            {regMode === "duo" && !lleno ? (
              <View style={styles.duoBox} testID="duo-fields">
                <View style={styles.duoHeader}>
                  <UserPlus size={14} color={colors.brand.primary} />
                  <Text style={styles.duoHeaderText}>Datos de tu pareja</Text>
                </View>
                <Input
                  label="Nombre completo de tu pareja"
                  placeholder="Ej. Sofía Ramírez"
                  value={parejaNombre}
                  onChangeText={setParejaNombre}
                  autoCapitalize="words"
                  testID="checkout-pareja-nombre-input"
                />
                <Input
                  label="Teléfono de tu pareja (WhatsApp)"
                  placeholder="+5215587654321"
                  value={parejaTelefono}
                  onChangeText={setParejaTelefono}
                  keyboardType="phone-pad"
                  testID="checkout-pareja-telefono-input"
                />
                <Text style={styles.duoHint}>
                  Reservamos 2 cupos y cobramos {`$${reta.costo_inscripcion} x 2 = $${reta.costo_inscripcion * 2}`} en un solo pago.
                </Text>
              </View>
            ) : null}

            {/* ===== Card de Cupón (Marketing) — bloqueado si reta llena ===== */}
            {!lleno ? (
              <View
                style={[
                  styles.cuponCard,
                  cuponAplicado && styles.cuponCardApplied,
                ]}
                testID="cupon-card"
              >
                <Text style={styles.cuponLabel}>¿Tienes un cupón de regalo?</Text>
                <View style={styles.cuponRow}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label=""
                      placeholder="PROPLAYER100"
                      value={cuponCodigo}
                      onChangeText={(t) => {
                        setCuponCodigo(t.toUpperCase());
                        if (cuponState) setCuponState(null);
                      }}
                      autoCapitalize="characters"
                      editable={!cuponAplicado && !submitting}
                      testID="cupon-input"
                    />
                  </View>
                  {cuponAplicado ? (
                    <TouchableOpacity
                      onPress={handleRemoveCupon}
                      style={styles.cuponRemoveBtn}
                      testID="cupon-remove-btn"
                    >
                      <Text style={styles.cuponRemoveTxt}>Quitar</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={handleValidateCupon}
                      style={[styles.cuponApplyBtn, (!cuponCodigo.trim() || cuponValidando) && { opacity: 0.5 }]}
                      disabled={!cuponCodigo.trim() || cuponValidando}
                      testID="cupon-apply-btn"
                    >
                      {cuponValidando ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.cuponApplyTxt}>Aplicar</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
                {cuponState?.ok === true ? (
                  <View style={styles.cuponSuccessRow} testID="cupon-success">
                    <Text style={styles.cuponSuccessTxt}>
                      ✓ Cupón <Text style={styles.cuponSuccessCode}>{cuponState.codigo}</Text> aplicado · {cuponState.descripcion}
                    </Text>
                    <Text style={styles.cuponSuccessAmount} testID="cupon-monto">
                      $0
                    </Text>
                  </View>
                ) : cuponState?.ok === false ? (
                  <Text style={styles.cuponErrorTxt} testID="cupon-error">
                    ⚠️ {cuponState.razon}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Button
              title={ctaText}
              onPress={handleAction}
              variant={lleno ? "danger" : "primary"}
              size="lg"
              brandIcon
              loading={submitting}
              testID={lleno ? "waitlist-btn" : "pay-button"}
            />
          </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      {/* FAB de soporte (Fase B) — flotante sobre toda la vista */}
      <LifeBuoySupport slug={String(slug)} retaNombre={reta.nombre} />
    </SafeAreaView>
  );
}

function StatBlock({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.statBlock}>
      <View style={styles.statHead}>{icon}<Text style={styles.statLabel}>{label}</Text></View>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function ModeChip({
  active, onPress, icon, label, testID,
}: { active: boolean; onPress: () => void; icon: React.ReactNode; label: string; testID?: string }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.modeChip, active && styles.modeChipActive]}
      testID={testID}
      activeOpacity={0.85}
    >
      {icon}
      <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>{label}</Text>
    </TouchableOpacity>
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
  heroRow: { flexDirection: "row", gap: spacing.md, alignItems: "center", marginBottom: spacing.lg },
  logoBox: {
    width: 64, height: 64, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.brand.primaryBorder,
    backgroundColor: colors.brand.primarySoft,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
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
    borderWidth: 1, borderColor: colors.brand.primaryBorder,
    backgroundColor: colors.brand.primarySoft,
    borderRadius: radii.md, padding: spacing.md,
    borderStyle: "dashed", marginBottom: spacing.lg,
  },
  obsLabel: { ...typography.label, color: colors.brand.primary, fontSize: 10, marginBottom: 6 },
  obsText: { color: colors.text.primary, lineHeight: 20 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  statBlock: {
    flexBasis: "48%", flexGrow: 1,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md, padding: spacing.md,
  },
  statHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  statLabel: { ...typography.label, color: colors.text.secondary, fontSize: 10 },
  statValue: { color: colors.text.primary, fontWeight: "700", fontSize: 15 },
  formCard: {
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.lg, padding: spacing.lg,
  },
  formTitle: { ...typography.h3, color: colors.text.primary, marginBottom: 4 },
  formSubtitle: { color: colors.text.secondary, fontSize: 13, marginBottom: spacing.md, lineHeight: 18 },
  // Selector dúo / free-agent.
  modeSelector: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
    flexWrap: "wrap",
  },
  modeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.app,
    minHeight: 44,
  },
  modeChipActive: {
    backgroundColor: colors.brand.primary,
    borderColor: colors.brand.primary,
  },
  modeChipText: { color: colors.text.primary, fontWeight: "600", fontSize: 13 },
  modeChipTextActive: { color: "#fff" },
  // Free-agent informativo.
  infoFreeAgent: {
    borderWidth: 1,
    borderColor: colors.border.default,
    borderStyle: "dashed",
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.bg.app,
  },
  infoFreeAgentText: { color: colors.text.secondary, fontSize: 12, lineHeight: 17 },
  // Bloque de inputs de pareja.
  duoBox: {
    marginTop: 6,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
  },
  duoHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: spacing.sm,
  },
  duoHeaderText: {
    ...typography.label,
    color: colors.brand.primary,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  duoHint: {
    color: colors.text.secondary,
    fontSize: 12,
    fontStyle: "italic",
    marginTop: -4,
    marginBottom: spacing.sm,
  },

  // ===== Cupón card (Marketing) — Club Pro Clean v2 =====
  cuponCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default, // border-slate-200
    padding: spacing.sm + 2,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.bg.card,
  },
  cuponCardApplied: {
    backgroundColor: "#ECFDF5",          // bg-emerald-50
    borderColor: "#10B981" + "60",       // emerald-500 alpha
  },
  cuponLabel: {
    ...typography.label,
    color: colors.text.secondary,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  cuponRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  cuponApplyBtn: {
    backgroundColor: colors.brand.primary,
    paddingHorizontal: 16,
    height: 44,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 80,
    marginBottom: 0,
  },
  cuponApplyTxt: { color: "#fff", fontWeight: "800", fontSize: 13 },
  cuponRemoveBtn: {
    paddingHorizontal: 14,
    height: 44,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.card,
    marginBottom: 0,
  },
  cuponRemoveTxt: { color: colors.text.secondary, fontWeight: "700", fontSize: 12 },
  cuponSuccessRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    gap: 8,
    flexWrap: "wrap",
  },
  cuponSuccessTxt: {
    color: "#047857",                     // text-emerald-700
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  cuponSuccessCode: {
    fontFamily: "monospace",
    fontSize: 13,
    letterSpacing: 1,
    fontWeight: "900",
  },
  cuponSuccessAmount: {
    fontFamily: "monospace",
    color: "#047857",
    fontSize: 18,
    fontWeight: "900",
  },
  cuponErrorTxt: {
    color: colors.status.red,
    fontSize: 12,
    marginTop: 6,
    fontWeight: "600",
  },

  // ===== Fase A — Tarjeta RSVP (Retas Gratis) =====
  rsvpCard: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: "#10B98140", // emerald-500 alpha
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  rsvpBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.sm,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#10B98140",
    marginBottom: spacing.md,
  },
  rsvpBadgeText: {
    color: "#047857",
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  rsvpTitle: {
    ...typography.h3,
    color: colors.text.primary,
    marginBottom: 4,
  },
  rsvpSubtitle: {
    color: colors.text.secondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  rsvpBtnRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  rsvpAcceptBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: "#059669", // emerald-600
    shadowColor: "#10B981",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  rsvpAcceptBtnText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 15,
    letterSpacing: 0.3,
  },
  rsvpRejectBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.bg.app,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  rsvpRejectBtnText: {
    color: colors.text.secondary,
    fontWeight: "700",
    fontSize: 13,
  },
  rsvpFinePrint: {
    color: colors.text.secondary,
    fontSize: 11,
    textAlign: "center",
    marginTop: spacing.md,
    lineHeight: 16,
  },
  // Estado post-respuesta
  rsvpStateBox: {
    alignItems: "center",
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  rsvpStateIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  rsvpStateTitle: {
    ...typography.h3,
    fontSize: 18,
    textAlign: "center",
  },
  rsvpStateMsg: {
    color: colors.text.secondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    paddingHorizontal: spacing.sm,
  },
  rsvpPosBadge: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radii.md,
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#F59E0B55",
  },
  rsvpPosBadgeText: {
    color: "#B45309",
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 0.5,
  },
  rsvpResetBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.app,
  },
  rsvpResetBtnText: {
    color: colors.text.secondary,
    fontWeight: "700",
    fontSize: 12,
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
