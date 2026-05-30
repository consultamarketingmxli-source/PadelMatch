/**
 * Hub de Bifurcación — Selección de Ingreso (Auditoría Routing).
 *
 * Pantalla central del flujo de navegación:
 *
 *   Login (OTP/Email) ─→ /seleccion ─→ {/admin | /}
 *
 * Diseño v3 — Blue Club Pro (Director de Arte):
 *   • Top block: bg-slate-50 (#F8FAFC), BrandLockup PadelAppRetas centrado,
 *     tagline minimalista, dos CTAs grandes con micro-interacciones.
 *   • Botón Organizador: bg-slate-900, text-white → `/admin` (corporativo).
 *   • Botón Jugador:     bg-emerald-600, text-white → `/` (intencional —
 *     conserva esmeralda como contrapeso visual al cobalto del organizador,
 *     spec del Director de Arte: "el verde puede mantenerse para los CTAs
 *     del jugador como acento de semáforo positivo").
 *   • Bottom block: foto angular de cancha de pádel AZUL VIBRANTE
 *     (Blue Club Pro v3), gradient mask top→transparent.
 *
 * Reglas de redirección:
 *   • Si el usuario no es organizador, NUNCA llegamos aquí (saltamos
 *     directo a `/` desde login). El guard lo hace explícito al cargar:
 *     si `is_organizer === false` o no hay token de player, redirige.
 *   • Persistimos la elección en AsyncStorage para skip inteligente.
 *   • Botón "Cerrar sesión" para volver al login limpio.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LogOut, ShieldCheck, User } from "lucide-react-native";

import { BrandLogo } from "@/src/components/BrandLogo";
import { BrandWordmark } from "@/src/components/BrandWordmark";
import { api } from "@/src/api";
import { clearLastRole, setLastRole } from "@/src/utils/roleSelection";
import { colors, radii, shadows, spacing, typography } from "@/src/theme";
import { playerTokenStore } from "@/src/utils/playerTokenStore";

const COURT_IMAGE_URI =
  "https://images.pexels.com/photos/31012869/pexels-photo-31012869.jpeg?auto=compress&cs=tinysrgb&w=1600&fit=crop";

const PLAYER_TOKEN_KEY = "padelappretas.player.token";
const PLAYER_INFO_KEY = "padelappretas.player.info";

type RoleCardProps = {
  testID: string;
  label: string;
  sub: string;
  tone: "slate" | "emerald";
  onPress: () => void;
  icon: React.ReactNode;
};

function RoleCard({ testID, label, sub, tone, onPress, icon }: RoleCardProps) {
  // Micro-interacción "hover:scale-[1.02]" mapeada a press scale en RN.
  const scale = useRef(new Animated.Value(1)).current;
  const onIn = () => Animated.spring(scale, { toValue: 1.02, useNativeDriver: true, friction: 6 }).start();
  const onOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }).start();
  const bg = tone === "slate" ? "#0F172A" : "#059669"; // slate-900 / emerald-600
  const bgPressed = tone === "slate" ? "#1E293B" : "#047857";
  return (
    <Animated.View style={{ transform: [{ scale }], width: "100%" }}>
      <Pressable
        testID={testID}
        onPress={onPress}
        onPressIn={onIn}
        onPressOut={onOut}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.roleCard,
          { backgroundColor: pressed ? bgPressed : bg },
        ]}
      >
        <View style={styles.roleIcon}>{icon}</View>
        <View style={{ flex: 1 }}>
          <Text style={styles.roleLabel}>{label}</Text>
          <Text style={styles.roleSub}>{sub}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function SeleccionScreen() {
  const router = useRouter();
  const [bootChecking, setBootChecking] = useState(true);
  const [hasAdminToken, setHasAdminToken] = useState(false);
  const [hasPlayerToken, setHasPlayerToken] = useState(false);
  const [playerName, setPlayerName] = useState<string | null>(null);

  // Boot guard: si no hay NINGÚN token, mandamos a login. Si sólo hay
  // player token y NO es organizer, lo mandamos a /. (Doble-check de UX).
  useEffect(() => {
    (async () => {
      const adminTok = await api.getToken();
      const playerTok = await playerTokenStore.get();
      const infoRaw = await AsyncStorage.getItem(PLAYER_INFO_KEY);
      setHasAdminToken(!!adminTok);
      setHasPlayerToken(!!playerTok);
      if (infoRaw) {
        try {
          setPlayerName(JSON.parse(infoRaw)?.nombre ?? null);
        } catch {
          /* no-op */
        }
      }

      if (!adminTok && !playerTok) {
        // Sin sesión: el hub no aplica.
        router.replace("/login");
        return;
      }

      // Si SÓLO hay token de player, verificamos roles silenciosamente.
      // Si no es organizer, lo mandamos directo a / (no mostrar hub).
      if (!adminTok && playerTok) {
        try {
          const roles = await api.playerMyRoles(playerTok);
          if (!roles.is_organizer) {
            router.replace("/");
            return;
          }
        } catch {
          // Si falla, asumimos que SÍ puede ver el hub (mejor mostrar
          // el menú que dejar al usuario varado).
        }
      }

      setBootChecking(false);
    })();
  }, [router]);

  const goAdmin = async () => {
    await setLastRole("admin");
    router.replace("/admin");
  };
  const goPlayer = async () => {
    await setLastRole("player");
    router.replace("/");
  };

  const cerrarSesion = async () => {
    await api.logout();
    await Promise.all([playerTokenStore.remove(), AsyncStorage.multiRemove([PLAYER_INFO_KEY])]);
    await clearLastRole();
    router.replace("/login");
  };

  if (bootChecking) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root} testID="seleccion-screen">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* =========================================================
            BLOQUE SUPERIOR — Hub con CTAs.
            ========================================================= */}
        <View style={styles.topBlock}>
          <SafeAreaView edges={["top"]} style={styles.topInner}>
            {/* Header brand */}
            <View style={styles.brandHeader}>
              <BrandLogo size={56} />
              <View style={styles.wordmarkSpace}>
                <BrandWordmark size="xl" />
              </View>
              <Text style={styles.tag}>· SELECCIONA TU AMBIENTE</Text>
            </View>

            {/* Saludo + descripción */}
            <View style={styles.greetWrap}>
              <Text style={styles.greetHi}>
                {playerName ? `Hola, ${playerName}.` : "Hola."}
              </Text>
              <Text style={styles.greetSub}>
                Tienes acceso a dos ambientes. Elige cómo quieres ingresar:
              </Text>
            </View>

            {/* CTAs */}
            <View style={styles.ctaStack}>
              <RoleCard
                testID="seleccion-organizador"
                tone="slate"
                label="Ingresar como Organizador"
                sub="Crear retas, controlar marcadores, gestionar pagos."
                onPress={goAdmin}
                icon={<ShieldCheck size={22} color="#fff" />}
              />
              <RoleCard
                testID="seleccion-jugador"
                tone="emerald"
                label="Ingresar como Jugador"
                sub="Buscar retas cerca, aceptar invitaciones y jugar."
                onPress={goPlayer}
                icon={<User size={22} color="#fff" />}
              />
            </View>

            <Pressable
              onPress={cerrarSesion}
              style={styles.logoutBtn}
              testID="seleccion-logout"
              hitSlop={8}
            >
              <LogOut size={12} color={colors.text.muted} />
              <Text style={styles.logoutTxt}>Cerrar sesión</Text>
            </Pressable>

            <Text style={styles.diag}>
              {hasAdminToken && hasPlayerToken
                ? "Sesión dual activa"
                : hasAdminToken
                ? "Sesión organizador"
                : "Sesión de jugador"}
            </Text>
          </SafeAreaView>
        </View>

        {/* =========================================================
            BLOQUE INFERIOR — Foto angular cancha (continuidad con login).
            ========================================================= */}
        <View style={styles.bottomBlock}>
          <Image
            source={{ uri: COURT_IMAGE_URI }}
            style={styles.heroPhoto}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
            accessibilityLabel="Cancha de pádel"
          />
          <LinearGradient
            colors={["#F8FAFC", "rgba(248, 250, 252, 0.85)", "rgba(248, 250, 252, 0)"]}
            locations={[0, 0.35, 1]}
            style={styles.bottomGradient}
            pointerEvents="none"
          />
          <View style={styles.footerStrip} pointerEvents="none">
            <View style={styles.footerBadge}>
              <BrandLogo size={18} />
              <BrandWordmark size="sm" />
            </View>
            <Text style={styles.footerKicker}>· Tournament OS · 2026</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F8FAFC" },
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  topBlock: {
    minHeight: 540,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: spacing.lg,
  },
  topInner: { flex: 1, alignItems: "center", paddingTop: spacing.lg },
  brandHeader: { alignItems: "center", marginBottom: spacing.md },
  wordmarkSpace: { marginTop: spacing.sm },
  tag: {
    ...typography.label,
    color: colors.brand.primary,
    fontSize: 10,
    marginTop: spacing.xs,
    letterSpacing: 2,
  },

  greetWrap: {
    alignItems: "center",
    maxWidth: 440,
    width: "100%",
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  greetHi: {
    ...typography.h2,
    color: colors.text.primary,
    fontSize: 22,
    textAlign: "center",
  },
  greetSub: {
    color: colors.text.secondary,
    fontSize: 13,
    textAlign: "center",
    marginTop: spacing.xs,
    lineHeight: 19,
  },

  ctaStack: {
    width: "100%",
    maxWidth: 440,
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  roleCard: {
    width: "100%",
    minHeight: 84,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    ...(shadows.premium as object),
  },
  roleIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  roleLabel: { color: "#fff", fontWeight: "800", fontSize: 16, letterSpacing: 0.2 },
  roleSub: { color: "rgba(255,255,255,0.78)", fontSize: 12, marginTop: 2, lineHeight: 17 },

  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  logoutTxt: { color: colors.text.muted, fontSize: 12, fontWeight: "600" },
  diag: {
    color: colors.text.muted,
    fontSize: 10,
    letterSpacing: 1.5,
    marginTop: spacing.xs,
    textTransform: "uppercase",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },

  bottomBlock: { height: 320, position: "relative", overflow: "hidden" },
  heroPhoto: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  bottomGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 140,
  },
  footerStrip: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingBottom: spacing.lg,
    gap: 6,
  },
  footerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: colors.border.hairline,
    ...(shadows.premium as object),
  },
  footerKicker: {
    ...typography.label,
    fontSize: 9,
    color: "#FFFFFF",
    letterSpacing: 2,
    ...Platform.select({
      web: { textShadow: "0px 1px 2px rgba(15,23,42,0.4)" } as any,
      default: {
        textShadowColor: "rgba(15,23,42,0.4)",
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 2,
      },
    }),
  },
});
