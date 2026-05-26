/** Formulario crear / editar reta. */
import React, { useEffect, useState } from "react";
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
import { ArrowLeft, Trophy, Clock, Image as ImageIcon } from "lucide-react-native";

import { api } from "@/src/api";
import { Button } from "@/src/components/Button";
import { Input } from "@/src/components/Input";
import { colors, radii, spacing, typography } from "@/src/theme";

type Modo = "PUNTOS" | "TIEMPO";
type Rondas = 5 | 6 | 7;

export default function RetaForm() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";

  const [loading, setLoading] = useState(!isNew);
  const [submitting, setSubmitting] = useState(false);
  const [nombre, setNombre] = useState("");
  const [club, setClub] = useState("");
  const [fechaStr, setFechaStr] = useState("");
  const [horaStr, setHoraStr] = useState("");
  const [canchas, setCanchas] = useState("1");
  const [costo, setCosto] = useState("250");
  const [modo, setModo] = useState<Modo>("PUNTOS");
  const [rondas, setRondas] = useState<Rondas>(7);
  const [logoUrl, setLogoUrl] = useState("");
  const [obs, setObs] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [retaIdReal, setRetaIdReal] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) {
      // defaults: mañana 19:00
      const t = new Date();
      t.setDate(t.getDate() + 1);
      const yyyy = t.getFullYear();
      const mm = String(t.getMonth() + 1).padStart(2, "0");
      const dd = String(t.getDate()).padStart(2, "0");
      setFechaStr(`${yyyy}-${mm}-${dd}`);
      setHoraStr("19:00");
      return;
    }
    (async () => {
      try {
        const r = await api.getRetaAdmin(id as string);
        setRetaIdReal(r.id);
        setNombre(r.nombre);
        setClub(r.club);
        const d = new Date(r.fecha_evento);
        setFechaStr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
        setHoraStr(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
        setCanchas(String(r.canchas_disponibles));
        setCosto(String(r.costo_inscripcion));
        setModo(r.modalidad_juego);
        setRondas(r.num_rondas);
        setLogoUrl(r.organizador_logo_url ?? "");
        setObs(r.observaciones_publicas);
        setLat(r.latitud != null ? String(r.latitud) : "");
        setLng(r.longitud != null ? String(r.longitud) : "");
      } catch (e: any) {
        Alert.alert("Error", e.message ?? "No se pudo cargar");
        router.back();
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isNew, router]);

  const save = async () => {
    if (!nombre.trim() || !club.trim() || !fechaStr || !horaStr) {
      Alert.alert("Faltan datos", "Nombre, club, fecha y hora son obligatorios");
      return;
    }
    setSubmitting(true);
    const tzOffsetMin = -new Date().getTimezoneOffset();
    const body = {
      nombre: nombre.trim(),
      club: club.trim(),
      fecha_str: fechaStr,
      hora_str: horaStr,
      tz_offset_minutes: tzOffsetMin,
      canchas_disponibles: parseInt(canchas, 10) || 1,
      costo_inscripcion: parseFloat(costo) || 0,
      modalidad_juego: modo,
      num_rondas: rondas,
      organizador_logo_url: logoUrl || null,
      observaciones_publicas: obs.slice(0, 140),
      latitud: lat ? parseFloat(lat) : null,
      longitud: lng ? parseFloat(lng) : null,
    };
    try {
      if (isNew) {
        const r = await api.createReta(body);
        Alert.alert("Reta creada", `Slug: ${r.url_slug}`);
        router.replace(`/admin/reta/${r.id}` as any);
      } else {
        await api.updateReta(id as string, body);
        Alert.alert("Reta actualizada");
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
    try {
      // Auto-genera con placeholders si no hay 8 jugadores aún
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

  if (loading) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}><Text style={{ color: colors.text.secondary }}>Cargando…</Text></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="back-btn">
              <ArrowLeft size={18} color={colors.text.primary} />
            </TouchableOpacity>
            <Text style={styles.title}>{isNew ? "Nueva Reta" : "Editar Reta"}</Text>
            <View style={{ width: 40 }} />
          </View>

          <Input label="Nombre de la reta" value={nombre} onChangeText={setNombre} testID="form-nombre" placeholder="Ej. Torneo Verano" />
          <Input label="Club" value={club} onChangeText={setClub} testID="form-club" placeholder="Ej. Padel Club CDMX" />

          <View style={styles.row}>
            <Input label="Fecha (YYYY-MM-DD)" value={fechaStr} onChangeText={setFechaStr} testID="form-fecha" placeholder="2026-06-15" />
            <Input label="Hora (HH:mm)" value={horaStr} onChangeText={setHoraStr} testID="form-hora" placeholder="19:00" />
          </View>

          <View style={styles.row}>
            <Input label="Canchas" value={canchas} onChangeText={setCanchas} keyboardType="number-pad" testID="form-canchas" />
            <Input label="Costo $" value={costo} onChangeText={setCosto} keyboardType="decimal-pad" testID="form-costo" />
          </View>

          <Text style={styles.sectionLabel}>MODALIDAD</Text>
          <View style={styles.segGroup}>
            {(["PUNTOS", "TIEMPO"] as Modo[]).map((m) => (
              <TouchableOpacity
                key={m}
                testID={`form-modo-${m.toLowerCase()}`}
                onPress={() => setModo(m)}
                activeOpacity={0.7}
                style={[styles.seg, modo === m && styles.segActive]}
              >
                {m === "PUNTOS" ? <Trophy size={14} color={modo === m ? colors.text.inverse : colors.text.primary} /> : <Clock size={14} color={modo === m ? colors.text.inverse : colors.text.primary} />}
                <Text style={[styles.segText, modo === m && styles.segTextActive]}>{m === "PUNTOS" ? "Por Puntos" : "Por Tiempo"}</Text>
              </TouchableOpacity>
            ))}
          </View>

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
                  style={[
                    styles.seg,
                    active && styles.segActive,
                    ideal && !active && styles.segRecommended,
                  ]}
                >
                  <Text style={[styles.segText, active && styles.segTextActive]}>
                    {n} {n === 1 ? "Ronda" : "Rondas"}{ideal ? "  ★ Ideal" : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>IDENTIDAD VISUAL</Text>
          <Input
            label="Logo URL (opcional, base64 data:image o https)"
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

          <Button title={isNew ? "Crear reta" : "Guardar cambios"} onPress={save} loading={submitting} testID="form-save-btn" />

          {!isNew ? (
            <>
              <View style={{ height: spacing.md }} />
              <Button
                title="Generar Rol & Descargar PDF A4"
                onPress={downloadPdf}
                variant="secondary"
                icon={<ImageIcon size={14} color={colors.brand.primary} />}
                testID="form-pdf-btn"
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
  iconBtn: { width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default, alignItems: "center", justifyContent: "center" },
  title: { ...typography.h2, color: colors.text.primary },
  row: { flexDirection: "row", gap: spacing.sm },
  sectionLabel: { ...typography.label, color: colors.text.secondary, marginTop: spacing.md, marginBottom: spacing.sm, fontSize: 11 },
  segGroup: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md, flexWrap: "wrap" },
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
