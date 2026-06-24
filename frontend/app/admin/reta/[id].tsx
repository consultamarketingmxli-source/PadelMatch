/**
 * Formulario crear / editar reta — Fase B "Club Pro Clean".
 *
 * Cambios respecto a versión legacy:
 *   • Capacidad elástica: 4, 8, 12, 16, 20, 24, 28, 32 (chips)
 *     con auto-sugerencia si el organizador escribe un impar.
 *   • Formato de juego elástico (FormatoScore):
 *       PUNTOS+juegos (clásico) / PUNTOS+sets / TIEMPO+minutos.
 *   • Acceso al panel "Compartir" (QR, WhatsApp, copiar link).
 *   • Hint UX permanente: "El pádel se juega en parejas (múltiplos de 4)".
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
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
  BarChart2,
  Clock,
  Download,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  Share2,
  Shuffle,
  Trophy,
  Users,
} from "lucide-react-native";

import { FormatoScore, api } from "@/src/api";
import { Button } from "@/src/components/Button";
import { ClubAutocomplete } from "@/src/components/ClubAutocomplete";
import { Input } from "@/src/components/Input";
import { useSubscription } from "@/src/hooks/useSubscription";
import { gateAntiFlake, gateExport } from "@/src/utils/premiumGate";
import { colors, radii, spacing, typography } from "@/src/theme";

type Modo = "PUNTOS" | "TIEMPO";
type Rondas = 5 | 6 | 7;
type Unidad = FormatoScore["unidad"];

// Múltiplos de 4 permitidos (4..32). Visible como chips.
const CAPACIDADES = [4, 6, 8, 12, 16, 20, 24, 28, 32];

/** Conjunto curado de capacidades válidas — mantén sincronizado con
 *  backend/core/validators._validate_jugadores_par4 (set permitidas). */
const CAPACIDADES_SET = new Set(CAPACIDADES);

// Valores rápidos por unidad para el FormatoScore.
const VALORES_POR_UNIDAD: Record<Unidad, number[]> = {
  juegos: [6, 9, 11, 15],
  sets: [1, 3, 5],
  minutos: [15, 20, 30, 45, 60],
};

function snapMultiplo4(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 4;
  if (n < 4) return 4;
  if (n > 32) return 32;
  return Math.round(n / 4) * 4 || 4;
}

export default function RetaForm() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";
  const { isPro } = useSubscription();

  const [loading, setLoading] = useState(!isNew);
  const [submitting, setSubmitting] = useState(false);

  // Identidad
  const [nombre, setNombre] = useState("");
  const [club, setClub] = useState("");
  // Selector Inteligente de Clubes (Fase B)
  const [clubId, setClubId] = useState<string | null>(null);
  const [clubDireccion, setClubDireccion] = useState<string>("");
  const [fechaStr, setFechaStr] = useState("");
  const [horaStr, setHoraStr] = useState("");

  // Capacidad elástica
  const [maxJugadores, setMaxJugadores] = useState<number>(8);
  const [costo, setCosto] = useState("250");
  const [modo, setModo] = useState<Modo>("PUNTOS");
  const [rondas, setRondas] = useState<Rondas>(7);

  // FormatoScore
  const [fsTipo, setFsTipo] = useState<"PUNTOS" | "TIEMPO">("PUNTOS");
  const [fsUnidad, setFsUnidad] = useState<Unidad>("juegos");
  const [fsValor, setFsValor] = useState<number>(9);

  // Branding
  const [logoUrl, setLogoUrl] = useState("");
  const [obs, setObs] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [retaIdReal, setRetaIdReal] = useState<string | null>(null);

  // Modalidad de Registro (Fase 1 — soporte parejas)
  const [modalidadRegistro, setModalidadRegistro] = useState<
    "individual" | "parejas_libres" | "parejas_mixtas"
  >("individual");
  const [permitirIndividualEnParejas, setPermitirIndividualEnParejas] = useState(false);

  // Tipo de acceso (Fase A — Retas Gratis / Entre Amigos)
  const [tipoAcceso, setTipoAcceso] = useState<"paga" | "gratis_amigos">("paga");
  const esGratis = tipoAcceso === "gratis_amigos";

  // ====== Fase 1 (Sección 1) — Parametrización extendida ======
  // 1 = ganador absoluto, 2 = podio, 3 = top-3 por cancha.
  const [numGanadoresPorCancha, setNumGanadoresPorCancha] = useState<1 | 2 | 3>(1);
  // A = Puntos netos individual · B = Puntos netos por pareja · C = Ratio favor/contra
  const [criterioDesempate, setCriterioDesempate] = useState<"A" | "B" | "C">("A");
  // Jugadores por cancha (default 4 = pádel clásico)
  const [jugadoresPorCancha, setJugadoresPorCancha] = useState<number>(4);
  // KO 3-0 (solo aplicable a formato PUNTOS con cap=5)
  const [koEnabled, setKoEnabled] = useState<boolean>(false);

  // Filtro Anti-Flake (+90% asistencia) — FEATURE PRO (Sandbox Monetization)
  // Solo visualmente activable si el organizador es Pro. Local state (sin
  // persistir aún en backend; sólo demostración del gating).
  const [antiFlakeEnabled, setAntiFlakeEnabled] = useState<boolean>(false);

  const esParejas = modalidadRegistro !== "individual";

  useEffect(() => {
    if (isNew) {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      const yyyy = t.getFullYear();
      const mm = String(t.getMonth() + 1).padStart(2, "0");
      const dd = String(t.getDate()).padStart(2, "0");
      setFechaStr(`${yyyy}-${mm}-${dd}`);
      setHoraStr("19:00");
      return;
    }
    // Cleanup flag — previene setState en componente desmontado
    let alive = true;
    (async () => {
      try {
        const r = await api.getRetaAdmin(id as string);
        if (!alive) return;
        setRetaIdReal(r.id);
        setNombre(r.nombre);
        setClub(r.club);
        setClubId(r.club_id ?? null);
        setClubDireccion(r.club_direccion ?? "");
        const d = new Date(r.fecha_evento);
        setFechaStr(
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        );
        setHoraStr(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
        setMaxJugadores(r.max_jugadores);
        setCosto(String(r.costo_inscripcion));
        setModo(r.modalidad_juego);
        setRondas(r.num_rondas);
        if (r.formato_score) {
          setFsTipo(r.formato_score.tipo);
          setFsUnidad(r.formato_score.unidad);
          setFsValor(r.formato_score.valor);
        }
        setLogoUrl(r.organizador_logo_url ?? "");
        setObs(r.observaciones_publicas);
        setLat(r.latitud != null ? String(r.latitud) : "");
        setLng(r.longitud != null ? String(r.longitud) : "");
        setModalidadRegistro(r.modalidad_registro ?? "individual");
        setPermitirIndividualEnParejas(!!r.permitir_individual_en_parejas);
        setTipoAcceso(r.tipo_acceso ?? "paga");
        setNumGanadoresPorCancha((r.num_ganadores_por_cancha ?? 1) as 1 | 2 | 3);
        setCriterioDesempate((r.criterio_desempate ?? "A") as "A" | "B" | "C");
        setJugadoresPorCancha(r.jugadores_por_cancha ?? 4);
        setKoEnabled(!!r.formato_score?.ko_enabled);
        // Anti-Flake Filter (Sandbox Monetization) — leer flag persistido.
        setAntiFlakeEnabled(!!(r as any).requiere_alta_asistencia);
      } catch (e: any) {
        if (!alive) return;
        Alert.alert("Error", e.message ?? "No se pudo cargar");
        router.back();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, isNew, router]);

  // Cuando cambia tipo (PUNTOS/TIEMPO), ajusta unidad coherente.
  useEffect(() => {
    if (fsTipo === "TIEMPO") {
      setFsUnidad("minutos");
      if (![15, 20, 30, 45, 60].includes(fsValor)) setFsValor(20);
    } else if (fsTipo === "PUNTOS") {
      if (fsUnidad === "minutos") {
        setFsUnidad("juegos");
        setFsValor(9);
      }
    }
    // Mantener `modo` sincronizado con tipo (compat con scoreboard).
    setModo(fsTipo);
  }, [fsTipo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Canchas estimadas según capacidad (visual feedback al organizador)
  const canchasEstimadas = useMemo(() => Math.ceil(maxJugadores / 8), [maxJugadores]);

  const save = async () => {
    if (!nombre.trim() || !club.trim() || !fechaStr || !horaStr) {
      Alert.alert("Faltan datos", "Nombre, club, fecha y hora son obligatorios");
      return;
    }
    if (!CAPACIDADES_SET.has(maxJugadores)) {
      // Encontrar el más cercano dentro del set curado.
      const sugerido = [...CAPACIDADES_SET].reduce((prev, curr) =>
        Math.abs(curr - maxJugadores) < Math.abs(prev - maxJugadores) ? curr : prev,
      );
      Alert.alert(
        "Capacidad inválida",
        `Las capacidades soportadas son: ${CAPACIDADES.join(", ")}. ¿Cambiamos a ${sugerido} jugadores?`,
        [
          { text: "Cancelar", style: "cancel" },
          { text: `Usar ${sugerido}`, onPress: () => setMaxJugadores(sugerido) },
        ],
      );
      return;
    }
    setSubmitting(true);
    const tzOffsetMin = -new Date().getTimezoneOffset();
    const body = {
      nombre: nombre.trim(),
      club: club.trim(),
      club_id: clubId,
      club_direccion: clubDireccion.trim() || null,
      fecha_str: fechaStr,
      hora_str: horaStr,
      tz_offset_minutes: tzOffsetMin,
      canchas_disponibles: canchasEstimadas,
      max_jugadores: maxJugadores,
      costo_inscripcion: parseFloat(costo) || 0,
      modalidad_juego: fsTipo, // espejo del FormatoScore.tipo
      num_rondas: rondas,
      formato_score: {
        tipo: fsTipo,
        valor: fsValor,
        unidad: fsUnidad,
        // Fase 1 (Sección 1) — KO 3-0 sólo aplicable a PUNTOS.
        // Si KO está activo en PUNTOS, fijamos cap_total al `valor`
        // (umbral de cierre del partido). Para TIEMPO ignoramos.
        cap_total: fsTipo === "PUNTOS" && koEnabled ? fsValor : null,
        ko_enabled: fsTipo === "PUNTOS" ? koEnabled : false,
      },
      modalidad_registro: modalidadRegistro,
      permitir_individual_en_parejas: esParejas ? permitirIndividualEnParejas : false,
      tipo_acceso: tipoAcceso,
      organizador_logo_url: logoUrl || null,
      observaciones_publicas: obs.slice(0, 140),
      latitud: lat ? parseFloat(lat) : null,
      longitud: lng ? parseFloat(lng) : null,
      // ===== Fase 1 (Sección 1) — Parametrización extendida =====
      num_ganadores_por_cancha: numGanadoresPorCancha,
      criterio_desempate: criterioDesempate,
      jugadores_por_cancha: jugadoresPorCancha,
      // ===== Anti-Flake Filter (PRO feature · Sandbox Monetization) =====
      requiere_alta_asistencia: antiFlakeEnabled,
      asistencia_minima_pct: 90,
    };
    try {
      if (isNew) {
        const r = await api.createReta(body);
        Alert.alert(
          "✓ Reta creada",
          `Slug: ${r.url_slug}\n¿Quieres compartirla ya?`,
          [
            {
              text: "Después",
              style: "cancel",
              onPress: () => router.replace(`/admin/reta/${r.id}` as any),
            },
            {
              text: "Compartir",
              onPress: () => router.replace(`/admin/reta/compartir/${r.id}` as any),
            },
          ],
        );
      } else {
        await api.updateReta(id as string, body);
        Alert.alert("✓ Reta actualizada");
      }
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo guardar");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteReta = async () => {
    Alert.alert("Eliminar reta", "Esto eliminará la reta y todas sus inscripciones. ¿Continuar?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          await api.deleteReta(id as string);
          router.replace("/admin");
        },
      },
    ]);
  };

  const downloadPdf = async () => {
    if (isNew || !retaIdReal) {
      Alert.alert("Guarda primero", "Crea la reta antes de generar el PDF");
      return;
    }
    // Premium gate: exportar Rol PDF es feature Pro (Sandbox Monetization)
    if (!gateExport(isPro, router)) return;
    try {
      const url = await api.generatePdfUrl(retaIdReal, [], rondas);
      if (Platform.OS === "web") {
        const a = document.createElement("a");
        a.href = url;
        a.download = `rol-${nombre.replace(/\s+/g, "-")}.pdf`;
        a.target = "_blank";
        a.click();
      } else {
        Alert.alert("PDF generado", "Abre el PDF desde el navegador para descargarlo.");
      }
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo generar el PDF");
    }
  };

  /**
   * Descarga genérica de blobs (CSV / PDF clasificación / CSV rol).
   * En web abre directo la descarga; en mobile muestra alerta + abre URL.
   */
  const triggerBlobDownload = async (
    fetcher: () => Promise<string>,
    filename: string,
    successMsg = "Archivo generado",
  ) => {
    if (isNew || !retaIdReal) {
      Alert.alert("Guarda primero", "Crea la reta antes de exportar");
      return;
    }
    // Premium gate: exportar CSV/PDF es feature Pro (Sandbox Monetization)
    if (!gateExport(isPro, router)) return;
    try {
      const url = await fetcher();
      if (Platform.OS === "web") {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.target = "_blank";
        a.click();
      } else {
        Alert.alert(successMsg, "Abre el archivo desde el navegador para descargarlo.");
      }
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "No se pudo descargar");
    }
  };

  const slug = nombre.replace(/\s+/g, "-").toLowerCase() || "reta";

  const downloadRolCsv = () =>
    triggerBlobDownload(
      () => api.exportRolCsvUrl(retaIdReal!),
      `rol-${slug}.csv`,
      "CSV del rol generado",
    );

  const downloadClasificacionCsv = () =>
    triggerBlobDownload(
      () => api.exportClasificacionCsvUrl(retaIdReal!),
      `clasificacion-${slug}.csv`,
      "CSV de clasificación generado",
    );

  const downloadClasificacionPdf = () =>
    triggerBlobDownload(
      () => api.exportClasificacionPdfUrl(retaIdReal!),
      `clasificacion-${slug}.pdf`,
      "PDF de clasificación generado",
    );

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={{ color: colors.text.secondary }}>Cargando…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const valoresActuales = VALORES_POR_UNIDAD[fsUnidad];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
              <ArrowLeft size={18} color={colors.text.primary} />
            </TouchableOpacity>
            <Text style={styles.title}>{isNew ? "Nueva Reta" : "Editar Reta"}</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* IDENTIDAD */}
          <Input label="Nombre de la reta" value={nombre} onChangeText={setNombre} testID="form-nombre" placeholder="Ej. Torneo Verano" />
          <ClubAutocomplete
            value={club}
            onChange={(texto, picked) => {
              setClub(texto);
              if (picked) {
                // Selección del directorio: hidratamos id + dirección + coords.
                setClubId(picked.id);
                setClubDireccion(picked.direccion_completa ?? "");
                if (picked.latitud != null) setLat(String(picked.latitud));
                if (picked.longitud != null) setLng(String(picked.longitud));
              } else {
                // El user deshizo la selección (escribió texto libre o tipeó después).
                // Si SE TENÍA un club_id antes, ahora se vacía → limpiamos también la
                // dirección y coords que se habían heredado del club anterior, para
                // evitar persistir datos de un club distinto al texto actual.
                if (clubId) {
                  setClubDireccion("");
                  setLat("");
                  setLng("");
                }
                setClubId(null);
              }
            }}
            label="Lugar / Club"
            testID="form-club-autocomplete"
          />
          {/* Dirección opcional (visible si seleccionó del directorio O escribió a mano).
              Permite editarla sin perder la selección. */}
          <Input
            label="Dirección (opcional)"
            value={clubDireccion}
            onChangeText={setClubDireccion}
            placeholder="Ej. Av. Reforma 100, CDMX"
            testID="form-club-direccion"
          />

          <View style={styles.row}>
            <Input label="Fecha (YYYY-MM-DD)" value={fechaStr} onChangeText={setFechaStr} testID="form-fecha" placeholder="2026-06-15" />
            <Input label="Hora (HH:mm)" value={horaStr} onChangeText={setHoraStr} testID="form-hora" placeholder="19:00" />
          </View>

          {/* CAPACIDAD ELÁSTICA */}
          <Text style={styles.sectionLabel}>CAPACIDAD DE JUGADORES</Text>
          <Text style={styles.hintText}>
            <Users size={11} color={colors.text.secondary} />
            {"  "}En pádel clásico se juega en parejas (4, 8, 12…). La variante{" "}
            <Text style={{ fontWeight: "700", color: colors.brand.azure }}>6 jugadores</Text>
            {" "}admite rotación con 2 en banca por cancha (formato Mexicano).
          </Text>
          <View style={styles.chipsRow}>
            {CAPACIDADES.map((n) => {
              const active = maxJugadores === n;
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => {
                    setMaxJugadores(n);
                    // UX nudge: si el organizador elige capacidad 6, asumimos
                    // formato Mexicano (1 cancha · 6 jug. con 2 en banca).
                    if (n === 6 && jugadoresPorCancha !== 6) {
                      setJugadoresPorCancha(6);
                    }
                  }}
                  style={[styles.chip, active && styles.chipActive]}
                  activeOpacity={0.7}
                  testID={`form-cap-${n}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.estimText} testID="form-canchas-estim">
            Canchas estimadas: <Text style={{ fontWeight: "800", color: colors.text.primary }}>{canchasEstimadas}</Text>
            {"  ·  "}Cancha estándar = 8 jugadores · 6 jug. (rotación) = 1 cancha mini con banca.
          </Text>

          {/* MODALIDAD DE REGISTRO — Fase 1: soporte parejas */}
          <Text style={styles.sectionLabel}>MODALIDAD DE REGISTRO</Text>
          <Text style={styles.hintText}>
            Define cómo se inscriben los jugadores en esta reta.
          </Text>
          <View style={styles.segGroup}>
            {(
              [
                { key: "individual", label: "Individual", hint: "Cada jugador se inscribe solo" },
                { key: "parejas_libres", label: "Parejas libres", hint: "Inscripción por dupla" },
                { key: "parejas_mixtas", label: "Parejas mixtas", hint: "Dupla mixta (validas tú)" },
              ] as const
            ).map((opt) => {
              const active = modalidadRegistro === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  testID={`form-modreg-${opt.key}`}
                  onPress={() => setModalidadRegistro(opt.key)}
                  activeOpacity={0.7}
                  style={[styles.seg, active && styles.segActive]}
                >
                  <Text style={[styles.segText, active && styles.segTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.subLabel}>
            {modalidadRegistro === "individual"
              ? "Round Robin individual clásico: todos juegan con todos cambiando de pareja."
              : modalidadRegistro === "parejas_libres"
                ? "Round Robin por duplas fijas. La pareja se inscribe y juega junta toda la reta."
                : "Round Robin por duplas fijas. Tú validas que cada dupla sea mixta (Hombre + Mujer)."}
          </Text>

          {esParejas ? (
            <TouchableOpacity
              testID="form-permitir-indiv"
              onPress={() => setPermitirIndividualEnParejas((v) => !v)}
              activeOpacity={0.7}
              style={[
                styles.toggleRow,
                permitirIndividualEnParejas && styles.toggleRowActive,
              ]}
            >
              <View style={[styles.toggleBox, permitirIndividualEnParejas && styles.toggleBoxActive]}>
                {permitirIndividualEnParejas ? (
                  <Text style={styles.toggleCheck}>✓</Text>
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleTitle}>Permitir inscripción individual</Text>
                <Text style={styles.toggleSub}>
                  Los jugadores pueden registrarse solos a la bolsa de libres; tú los emparejas
                  manualmente desde el panel del admin.
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}

          <Input label="Costo de inscripción $" value={costo} onChangeText={setCosto} keyboardType="decimal-pad" testID="form-costo" editable={!esGratis} />

          {/* TIPO DE ACCESO — Fase A: Retas Gratis/Entre Amigos */}
          <Text style={styles.sectionLabel}>TIPO DE ACCESO</Text>
          <Text style={styles.hintText}>
            Elige si esta reta requiere pago o es de invitación entre amigos (sin cobro).
          </Text>
          <View style={styles.segGroup}>
            {(
              [
                { key: "paga", label: "Con cobro", hint: "Pasarela Stripe/Mercado Pago" },
                { key: "gratis_amigos", label: "Gratis · Entre amigos", hint: "Invitación 1-clic, sin pasarela" },
              ] as const
            ).map((opt) => {
              const active = tipoAcceso === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  testID={`form-tipo-acceso-${opt.key}`}
                  onPress={() => {
                    setTipoAcceso(opt.key);
                    if (opt.key === "gratis_amigos") setCosto("0");
                  }}
                  activeOpacity={0.7}
                  style={[styles.seg, active && styles.segActive]}
                >
                  <Text style={[styles.segText, active && styles.segTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {esGratis ? (
            <Text style={styles.subLabel}>
              ⚡ Costo forzado a $0. El link de la reta abrirá una landing con
              botones <Text style={{ color: "#10B981", fontWeight: "800" }}>Aceptar</Text> /
              <Text style={{ color: "#F43F5E", fontWeight: "800" }}> Rechazar</Text> en 1 clic.
            </Text>
          ) : null}

          {/* FORMATO DE JUEGO (elástico) */}
          <Text style={styles.sectionLabel}>FORMATO DE JUEGO</Text>
          <View style={styles.segGroup}>
            {(["PUNTOS", "TIEMPO"] as const).map((t) => {
              const active = fsTipo === t;
              return (
                <TouchableOpacity
                  key={t}
                  testID={`form-fs-tipo-${t.toLowerCase()}`}
                  onPress={() => setFsTipo(t)}
                  activeOpacity={0.7}
                  style={[styles.seg, active && styles.segActive]}
                >
                  {t === "PUNTOS" ? (
                    <Trophy size={14} color={active ? colors.text.inverse : colors.text.primary} />
                  ) : (
                    <Clock size={14} color={active ? colors.text.inverse : colors.text.primary} />
                  )}
                  <Text style={[styles.segText, active && styles.segTextActive]}>
                    {t === "PUNTOS" ? "Por Puntos" : "Por Tiempo"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Unidad — sólo cuando PUNTOS */}
          {fsTipo === "PUNTOS" ? (
            <View style={styles.segGroup}>
              {(["juegos", "sets"] as Unidad[]).map((u) => {
                const active = fsUnidad === u;
                return (
                  <TouchableOpacity
                    key={u}
                    testID={`form-fs-unidad-${u}`}
                    onPress={() => {
                      setFsUnidad(u);
                      const def = VALORES_POR_UNIDAD[u][1] ?? VALORES_POR_UNIDAD[u][0];
                      setFsValor(def);
                    }}
                    style={[styles.seg, active && styles.segActive]}
                  >
                    <Text style={[styles.segText, active && styles.segTextActive]}>
                      {u === "juegos" ? "A juegos" : "A sets"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          <Text style={styles.subLabel}>
            {fsUnidad === "minutos"
              ? "Duración por partido (min)"
              : fsUnidad === "sets"
                ? "Al mejor de N sets"
                : "Primer equipo en llegar a N juegos gana"}
          </Text>
          <View style={styles.chipsRow}>
            {valoresActuales.map((v) => {
              const active = fsValor === v;
              return (
                <TouchableOpacity
                  key={v}
                  onPress={() => setFsValor(v)}
                  style={[styles.chipSmall, active && styles.chipActive]}
                  activeOpacity={0.7}
                  testID={`form-fs-valor-${v}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{v}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* KO 3-0 — solo PUNTOS. Fase 1 (Sección 1). */}
          {fsTipo === "PUNTOS" ? (
            <TouchableOpacity
              testID="form-ko-toggle"
              onPress={() => setKoEnabled((v) => !v)}
              activeOpacity={0.7}
              style={[styles.toggleRow, koEnabled && styles.toggleRowActive]}
            >
              <View style={[styles.toggleBox, koEnabled && styles.toggleBoxActive]}>
                {koEnabled ? <Text style={styles.toggleCheck}>✓</Text> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleTitle}>Regla KO {fsValor}-0 (Knock-Out)</Text>
                <Text style={styles.toggleSub}>
                  Si un equipo llega a {Math.floor(fsValor / 2) + 1} juegos y el rival a 0,
                  el partido se cierra automáticamente. El marcador se bloquea y se
                  marca como terminado por KO en la captura de resultados.
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}

          {/* Filtro Anti-Flake (+90% asistencia) — Pro feature (Sandbox Monetization) */}
          <TouchableOpacity
            testID="form-antiflake-toggle"
            onPress={() => {
              // Si NO es Pro → abre paywall, no toggle.
              if (!antiFlakeEnabled) {
                if (!gateAntiFlake(isPro, router)) return;
              }
              setAntiFlakeEnabled((v) => !v);
            }}
            activeOpacity={0.7}
            style={[styles.toggleRow, antiFlakeEnabled && styles.toggleRowActive]}
          >
            <View style={[styles.toggleBox, antiFlakeEnabled && styles.toggleBoxActive]}>
              {antiFlakeEnabled ? <Text style={styles.toggleCheck}>✓</Text> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleTitle}>
                Filtro Anti-Flake (+90% asistencia){"  "}
                <Text style={{ color: colors.brand.azure, fontSize: 10 }}>PRO</Text>
              </Text>
              <Text style={styles.toggleSub}>
                Sólo permite inscribirse a jugadores con ≥90% de asistencia histórica.
                Reduce las cancelaciones de último minuto y garantiza retas completas.
                {isPro ? "" : " · Exclusivo para Miembros Fundadores."}
              </Text>
            </View>
          </TouchableOpacity>

          {/* ====== Fase 1 (Sección 1) — Parametrización extendida ====== */}
          <Text style={styles.sectionLabel}>JUGADORES POR CANCHA</Text>
          <Text style={styles.hintText}>
            <Users size={11} color={colors.text.secondary} />
            {"  "}En pádel clásico son 4 (2 vs 2). Configurable si juegas en variantes.
          </Text>
          <View style={styles.chipsRow}>
            {[2, 4, 6, 8].map((n) => {
              const active = jugadoresPorCancha === n;
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => setJugadoresPorCancha(n)}
                  style={[styles.chipSmall, active && styles.chipActive]}
                  activeOpacity={0.7}
                  testID={`form-jpc-${n}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>GANADORES POR CANCHA</Text>
          <Text style={styles.hintText}>
            Cuántos jugadores ascienden / se reconocen por cancha al cierre de la reta.
          </Text>
          <View style={styles.segGroup}>
            {(
              [
                { key: 1, label: "1 · Solo el ganador", hint: "Top 1" },
                { key: 2, label: "2 · Podio", hint: "Top 2" },
                { key: 3, label: "3 · Top-3", hint: "Top 3" },
              ] as const
            ).map((opt) => {
              const active = numGanadoresPorCancha === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  testID={`form-ngc-${opt.key}`}
                  onPress={() => setNumGanadoresPorCancha(opt.key)}
                  activeOpacity={0.7}
                  style={[styles.seg, active && styles.segActive]}
                >
                  <Text style={[styles.segText, active && styles.segTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>CRITERIO DE DESEMPATE</Text>
          <Text style={styles.hintText}>
            Cuando dos jugadores quedan empatados en puntos al final del torneo.
          </Text>
          <View style={styles.segGroup}>
            {(
              [
                { key: "A", label: "A · Puntos netos individuales", hint: "Σ (Juegos ganados − perdidos)" },
                { key: "B", label: "B · Puntos netos por pareja", hint: "Net por dupla acumulado" },
                { key: "C", label: "C · Rendimiento técnico", hint: "Juegos a favor / en contra" },
              ] as const
            ).map((opt) => {
              const active = criterioDesempate === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  testID={`form-cd-${opt.key}`}
                  onPress={() => setCriterioDesempate(opt.key)}
                  activeOpacity={0.7}
                  style={[styles.seg, active && styles.segActive]}
                >
                  <Text style={[styles.segText, active && styles.segTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.subLabel}>
            {criterioDesempate === "A"
              ? "Suma de juegos ganados menos perdidos por jugador individual."
              : criterioDesempate === "B"
                ? "Suma de juegos ganados menos perdidos por pareja fija."
                : "Ratio de juegos a favor sobre juegos en contra."}
          </Text>

          {/* EXTENSIÓN */}
          <Text style={styles.sectionLabel}>EXTENSIÓN DEL TORNEO</Text>
          <View style={styles.segGroup}>
            {([5, 6, 7] as Rondas[]).map((n) => {
              const active = rondas === n;
              const ideal = n === 7;
              return (
                <TouchableOpacity
                  key={n}
                  testID={`form-rondas-${n}`}
                  onPress={() => setRondas(n)}
                  activeOpacity={0.7}
                  style={[styles.seg, active && styles.segActive, ideal && !active && styles.segRecommended]}
                >
                  <Text style={[styles.segText, active && styles.segTextActive]}>
                    {n} Rondas{ideal ? "  ★ Ideal" : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* BRANDING */}
          <Text style={styles.sectionLabel}>IDENTIDAD VISUAL</Text>
          <Input
            label="Logo URL (opcional, base64 data:image o https) — se comprime a WebP"
            value={logoUrl}
            onChangeText={setLogoUrl}
            testID="form-logo"
            placeholder="https://…"
            autoCapitalize="none"
          />
          <Input
            label={`Observaciones públicas (${obs.length}/140)`}
            value={obs}
            onChangeText={(v) => setObs(v.slice(0, 140))}
            multiline
            testID="form-obs"
            placeholder="Trae tu mejor energía y…"
            style={{ minHeight: 80, textAlignVertical: "top" }}
          />

          <Text style={styles.sectionLabel}>GEOLOCALIZACIÓN (opcional)</Text>
          <View style={styles.row}>
            <Input label="Latitud" value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation" testID="form-lat" placeholder="19.4326" />
            <Input label="Longitud" value={lng} onChangeText={setLng} keyboardType="numbers-and-punctuation" testID="form-lng" placeholder="-99.1332" />
          </View>

          <Button
            title={isNew ? "Crear reta" : "Guardar cambios"}
            onPress={save}
            loading={submitting}
            testID="form-save-btn"
          />

          {!isNew ? (
            <>
              <View style={{ height: spacing.md }} />
              <Button
                title="Compartir reta (QR + WhatsApp)"
                onPress={() => router.push(`/admin/reta/compartir/${retaIdReal}` as any)}
                variant="secondary"
                icon={<Share2 size={14} color={colors.brand.primary} />}
                testID="form-share-btn"
              />
              <View style={{ height: spacing.md }} />
              <Button
                title="Distribuir jugadores por cancha"
                onPress={() => router.push(`/admin/reta/jugadores/${retaIdReal}` as any)}
                variant="secondary"
                icon={<Shuffle size={14} color={colors.brand.primary} />}
                testID="form-jugadores-btn"
              />
              <View style={{ height: spacing.md }} />
              <Button
                title="Capturar resultados de partidos"
                onPress={() => router.push(`/admin/reta/resultados/${retaIdReal}` as any)}
                variant="secondary"
                icon={<BarChart2 size={14} color={colors.brand.primary} />}
                testID="form-resultados-btn"
              />
              {modalidadRegistro !== "individual" ? (
                <>
                  <View style={{ height: spacing.md }} />
                  <Button
                    title="Gestionar parejas y free-agents"
                    onPress={() => router.push(`/admin/reta/parejas/${retaIdReal}` as any)}
                    variant="secondary"
                    icon={<Users size={14} color={colors.brand.primary} />}
                    testID="form-parejas-btn"
                  />
                </>
              ) : null}
              <View style={{ height: spacing.md }} />
              <Button
                title="Generar Rol & Descargar PDF A4"
                onPress={downloadPdf}
                variant="secondary"
                icon={<ImageIcon size={14} color={colors.brand.primary} />}
                testID="form-pdf-btn"
              />
              <View style={{ height: spacing.md }} />
              <Button
                title="Notificaciones WhatsApp (Twilio)"
                onPress={() => router.push(`/admin/reta/notificaciones/${retaIdReal}` as any)}
                variant="secondary"
                icon={<MessageCircle size={14} color={colors.brand.primary} />}
                testID="form-notify-btn"
              />
              <View style={{ height: spacing.md }} />
              <Button
                title="Descargar Rol (CSV)"
                onPress={downloadRolCsv}
                variant="secondary"
                icon={<Download size={14} color={colors.brand.primary} />}
                testID="form-rol-csv-btn"
              />
              <View style={{ height: spacing.md }} />
              <Button
                title="Descargar Clasificación (CSV)"
                onPress={downloadClasificacionCsv}
                variant="secondary"
                icon={<Download size={14} color={colors.brand.primary} />}
                testID="form-clasif-csv-btn"
              />
              <View style={{ height: spacing.md }} />
              <Button
                title="Descargar Clasificación (PDF A4)"
                onPress={downloadClasificacionPdf}
                variant="secondary"
                icon={<FileText size={14} color={colors.brand.primary} />}
                testID="form-clasif-pdf-btn"
              />
              <View style={{ height: spacing.md }} />
              <Button title="Eliminar reta" onPress={deleteReta} variant="danger" testID="form-delete-btn" />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  iconBtn: {
    width: 40, height: 40, borderRadius: radii.md,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    alignItems: "center", justifyContent: "center",
  },
  title: { ...typography.h2, color: colors.text.primary },
  row: { flexDirection: "row", gap: spacing.sm },
  sectionLabel: { ...typography.label, color: colors.text.secondary, marginTop: spacing.md, marginBottom: spacing.sm, fontSize: 11 },
  subLabel: { color: colors.text.secondary, fontSize: 11, marginBottom: spacing.sm, marginTop: spacing.xs },
  hintText: { color: colors.text.secondary, fontSize: 11, lineHeight: 16, marginBottom: spacing.sm },
  estimText: { color: colors.text.secondary, fontSize: 11, marginBottom: spacing.md, marginTop: 6 },
  chipsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: spacing.sm },
  chip: {
    minWidth: 52, paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md, alignItems: "center",
  },
  chipSmall: {
    minWidth: 40, paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md, alignItems: "center",
  },
  chipActive: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  chipText: { color: colors.text.primary, fontWeight: "700", fontSize: 13 },
  chipTextActive: { color: colors.text.inverse },
  segGroup: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm, flexWrap: "wrap" },
  seg: {
    flex: 1, minWidth: 100,
    flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
    paddingVertical: 12, paddingHorizontal: 12,
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radii.md,
  },
  segActive: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  segRecommended: { borderColor: colors.brand.primaryBorder, borderStyle: "dashed" },
  segText: { color: colors.text.primary, fontWeight: "700", fontSize: 13 },
  segTextActive: { color: colors.text.inverse },
  toggleRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    padding: spacing.md,
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
  },
  toggleRowActive: {
    borderColor: colors.brand.primary,
    backgroundColor: "#F0FDE7",
  },
  toggleBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  toggleBoxActive: {
    backgroundColor: colors.brand.primary,
    borderColor: colors.brand.primary,
  },
  toggleCheck: {
    color: colors.text.inverse,
    fontWeight: "900",
    fontSize: 13,
    lineHeight: 14,
  },
  toggleTitle: {
    color: colors.text.primary,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 2,
  },
  toggleSub: {
    color: colors.text.secondary,
    fontSize: 11,
    lineHeight: 15,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
