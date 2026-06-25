/**
 * Player Match Finder · Buscar Reta (Showcase 6).
 *
 * Interfaz dedicada de descubrimiento con mapa SVG estilizado en el header,
 * chips de filtros (nivel · día · precio) y lista de retas cercanas con CTA
 * "Unirme a la Reta" en cada tarjeta.
 *
 * Nota: el mapa es ilustrativo (SVG abstracto navy/azure) — no integra
 * Google Maps real para mantener el showcase visual sin dependencias
 * nativas adicionales.
 */
import React, { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect, Defs, RadialGradient, Stop } from "react-native-svg";
import { Calendar, ChevronRight, MapPin, Sparkles, Users, Wallet } from "lucide-react-native";

import { colors, spacing } from "@/src/theme";

const NAVY = "#0F172A";
const ELECTRIC = "#2563EB";
const AZURE_LIGHT = "#60A5FA";

type RetaCard = {
  id: string;
  club: string;
  ubicacion: string;
  nombre: string;
  faltan: number;
  hora: string;
  fecha: string;
  nivel: "Principiante" | "Intermedio" | "Avanzado";
  precio_mxn: number;
};

const DEMO: RetaCard[] = [
  { id: "r1", club: "Club de Pádel El Murallón", ubicacion: "Polanco · 1.2 km", nombre: "Reta Dobles Intermedio", faltan: 2, hora: "7:00 PM", fecha: "Hoy", nivel: "Intermedio", precio_mxn: 350 },
  { id: "r2", club: "Sapphire Padel Club",      ubicacion: "Roma Norte · 2.4 km", nombre: "Reta Mexicana Mixta",  faltan: 3, hora: "8:30 PM", fecha: "Hoy", nivel: "Principiante", precio_mxn: 250 },
  { id: "r3", club: "Speed Club Pádel",         ubicacion: "Condesa · 3.1 km",  nombre: "Doble Premium Nocturno", faltan: 1, hora: "9:00 PM", fecha: "Mañana", nivel: "Avanzado", precio_mxn: 450 },
];

function MapHeader() {
  // Markers (x, y, label)
  const markers = [
    { x: 110, y: 70 },
    { x: 200, y: 110 },
    { x: 290, y: 90 },
    { x: 250, y: 160 },
  ];
  return (
    <View style={m.wrap}>
      <Svg width={"100%"} height={180} viewBox="0 0 390 180" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <RadialGradient id="bgG" cx="50%" cy="50%" r="80%">
            <Stop offset="0%" stopColor="#1E3A8A" stopOpacity="1" />
            <Stop offset="100%" stopColor="#0F172A" stopOpacity="1" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="390" height="180" fill="url(#bgG)" />
        {/* Grid lines */}
        {[30, 60, 90, 120, 150].map((y) => (
          <Path key={`h${y}`} d={`M0 ${y} L390 ${y}`} stroke="#1E40AF22" strokeWidth={1} />
        ))}
        {[60, 120, 180, 240, 300, 360].map((x) => (
          <Path key={`v${x}`} d={`M${x} 0 L${x} 180`} stroke="#1E40AF22" strokeWidth={1} />
        ))}
        {/* Streets */}
        <Path d="M-10 100 Q120 60 220 130 T420 90" stroke="#3B82F660" strokeWidth={3.5} fill="none" strokeLinecap="round" />
        <Path d="M-10 50 Q150 90 280 40 T420 50" stroke="#3B82F640" strokeWidth={2.5} fill="none" strokeLinecap="round" />
        <Path d="M50 -10 L130 180" stroke="#60A5FA33" strokeWidth={2} fill="none" />
        <Path d="M270 -10 L340 180" stroke="#60A5FA33" strokeWidth={2} fill="none" />
        {/* Markers */}
        {markers.map((mk, i) => (
          <React.Fragment key={i}>
            <Circle cx={mk.x} cy={mk.y} r={14} fill="#2563EB55" />
            <Circle cx={mk.x} cy={mk.y} r={7}  fill="#2563EB" />
            <Circle cx={mk.x} cy={mk.y} r={3}  fill="#FFFFFF" />
          </React.Fragment>
        ))}
        {/* Center "you" */}
        <Circle cx={180} cy={120} r={20} fill="#60A5FA22" />
        <Circle cx={180} cy={120} r={9}  fill="#60A5FA" />
        <Circle cx={180} cy={120} r={4}  fill="#FFFFFF" />
      </Svg>
      <View style={m.overlay}>
        <View style={m.eyebrowChip}>
          <MapPin size={12} color={AZURE_LIGHT} strokeWidth={2.5} />
          <Text style={m.eyebrowText}>BUSCAR RETA · CERCA DE TI</Text>
        </View>
        <Text style={m.title}>Encuentra retas{"\n"}al instante</Text>
        <Text style={m.subtitle}>4 canchas activas en 5 km · 12 retas abiertas hoy</Text>
      </View>
    </View>
  );
}

function FilterChips() {
  const [active, setActive] = useState("hoy");
  const filters = [
    { id: "hoy",   label: "Hoy" },
    { id: "manana", label: "Mañana" },
    { id: "dobles", label: "Dobles" },
    { id: "interm", label: "Intermedio" },
    { id: "<400",   label: "< $400" },
  ];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: spacing.base, paddingVertical: spacing.sm, gap: 8 }}
    >
      {filters.map((f) => {
        const sel = f.id === active;
        return (
          <Pressable
            key={f.id}
            onPress={() => setActive(f.id)}
            style={[chip.base, sel && chip.active]}
            testID={`filter-${f.id}`}
          >
            <Text style={[chip.text, sel && chip.textActive]}>{f.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function NivelBadge({ nivel }: { nivel: RetaCard["nivel"] }) {
  const palette = nivel === "Avanzado"
    ? { bg: "#FEF3C7", text: "#92400E" }
    : nivel === "Intermedio"
    ? { bg: "#DBEAFE", text: "#1E40AF" }
    : { bg: "#DCFCE7", text: "#166534" };
  return (
    <View style={[c.nivelBadge, { backgroundColor: palette.bg }]}>
      <Text style={[c.nivelText, { color: palette.text }]}>{nivel}</Text>
    </View>
  );
}

function RetaCardItem({ r }: { r: RetaCard }) {
  return (
    <View style={c.card} testID={`reta-card-${r.id}`}>
      <View style={c.thumb}>
        <Sparkles size={22} color={ELECTRIC} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <View style={c.clubRow}>
          <Text style={c.club} numberOfLines={1}>{r.club}</Text>
          <NivelBadge nivel={r.nivel} />
        </View>
        <View style={c.metaRow}>
          <MapPin size={11} color={colors.text.secondary} strokeWidth={2.3} />
          <Text style={c.meta}>{r.ubicacion}</Text>
        </View>
        <Text style={c.retaName}>{r.nombre}</Text>
        <View style={c.statsRow}>
          <View style={c.statCell}>
            <Users size={12} color="#DC2626" strokeWidth={2.4} />
            <Text style={[c.statText, { color: "#DC2626", fontWeight: "700" }]}>Faltan {r.faltan}</Text>
          </View>
          <View style={c.statCell}>
            <Calendar size={12} color={colors.text.secondary} strokeWidth={2.3} />
            <Text style={c.statText}>{r.fecha} · {r.hora}</Text>
          </View>
          <View style={c.statCell}>
            <Wallet size={12} color={colors.text.secondary} strokeWidth={2.3} />
            <Text style={c.statText}>${r.precio_mxn} MXN</Text>
          </View>
        </View>
        <Pressable style={({ pressed }) => [c.joinBtn, pressed && { opacity: 0.92 }]} testID={`join-${r.id}`}>
          <Text style={c.joinText}>Unirme a la Reta</Text>
          <ChevronRight size={16} color="#FFFFFF" strokeWidth={2.6} />
        </Pressable>
      </View>
    </View>
  );
}

export default function BuscarReta() {
  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl }}>
        <MapHeader />
        <FilterChips />
        <View style={s.section}>
          <Text style={s.sectionLabel}>RETAS DISPONIBLES CERCA</Text>
          {DEMO.map((r) => (
            <RetaCardItem key={r.id} r={r} />
          ))}
          <Text style={s.footerHint}>
            <Sparkles size={11} color={ELECTRIC} strokeWidth={2.4} />
            {"  "}Encontrar y unirse a retas disponibles al instante.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  section: { paddingHorizontal: spacing.base, gap: spacing.sm },
  sectionLabel: { color: colors.text.secondary, fontSize: 11, fontWeight: "800", letterSpacing: 0.7, marginBottom: spacing.sm },
  footerHint: { textAlign: "center", color: colors.text.secondary, fontSize: 12, marginTop: spacing.base, fontWeight: "500" },
});

const m = StyleSheet.create({
  wrap: { position: "relative", overflow: "hidden", borderBottomLeftRadius: 24, borderBottomRightRadius: 24, marginBottom: 4 },
  overlay: { position: "absolute", left: spacing.base, right: spacing.base, top: spacing.lg, gap: 6 },
  eyebrowChip: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: "rgba(96,165,250,0.18)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  eyebrowText: { color: AZURE_LIGHT, fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  title: { color: "#FFFFFF", fontSize: 22, fontWeight: "800", letterSpacing: -0.4, marginTop: 4, lineHeight: 26 },
  subtitle: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "500" },
});

const chip = StyleSheet.create({
  base: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#FFFFFF", borderRadius: 999, borderWidth: 1, borderColor: "#E2E8F0" },
  active: { backgroundColor: NAVY, borderColor: NAVY },
  text: { fontSize: 12, fontWeight: "700", color: colors.text.primary },
  textActive: { color: "#FFFFFF" },
});

const c = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    ...Platform.select({
      ios: { shadowColor: NAVY, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10 },
      android: { elevation: 2 },
    }),
  },
  thumb: { width: 52, height: 52, borderRadius: 14, backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center" },
  clubRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  club: { flex: 1, color: colors.text.primary, fontWeight: "800", fontSize: 14.5, letterSpacing: -0.2 },
  nivelBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  nivelText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  meta: { color: colors.text.secondary, fontSize: 11, fontWeight: "500" },
  retaName: { color: colors.text.primary, fontSize: 13, fontWeight: "600", marginBottom: 2 },
  statsRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 2 },
  statCell: { flexDirection: "row", alignItems: "center", gap: 4 },
  statText: { color: colors.text.secondary, fontSize: 11, fontWeight: "600" },
  joinBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: ELECTRIC,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 6,
    ...Platform.select({
      ios: { shadowColor: ELECTRIC, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8 },
      android: { elevation: 3 },
    }),
  },
  joinText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", letterSpacing: -0.1 },
});
