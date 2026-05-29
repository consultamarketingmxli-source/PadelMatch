/**
 * Pantalla de retorno tras pago exitoso (Mercado Pago / Stripe).
 *
 * Recibe deep-link `padelappretas://pago/exito?inscripcion_id=...&provider=mp&reta_slug=...`
 * y consulta el estado real al backend (no confía solo en la URL).
 *
 * El usuario puede llegar acá desde:
 *  - Web: redirect del navegador (success_url absoluto)
 *  - Native: scheme `padelappretas://` cuando vuelve de la app de MP/Stripe
 */
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCircle2, Calendar, Home } from "lucide-react-native";

import { api } from "@/src/api";
import { BrandHeader } from "@/src/components/BrandHeader";
import { PadelBallLoader } from "@/src/components/loaders";
import { colors, radii, spacing, typography } from "@/src/theme";

type PollStatus = "loading" | "approved" | "pending" | "failed";

export default function PagoExitoScreen() {
  const router = useRouter();
  const { inscripcion_id, provider, reta_slug } = useLocalSearchParams<{
    inscripcion_id?: string;
    provider?: string;
    reta_slug?: string;
  }>();

  const [status, setStatus] = useState<PollStatus>("loading");
  const [intentos, setIntentos] = useState(0);

  useEffect(() => {
    if (!inscripcion_id) {
      setStatus("failed");
      return;
    }
    let cancelled = false;

    const poll = async () => {
      try {
        const s =
          provider === "stripe"
            ? await api.paymentStatus(String(inscripcion_id))
            : await api.mpPaymentStatus(String(inscripcion_id));
        if (cancelled) return;

        const estatus = (s as any).estatus_pago ?? "";
        if (estatus === "Aprobado") {
          setStatus("approved");
        } else if (estatus === "Pendiente") {
          // El webhook todavía no confirma. Reintentamos hasta 10 veces.
          if (intentos < 10) {
            setIntentos((x) => x + 1);
            setTimeout(poll, 2000);
          } else {
            setStatus("pending");
          }
        } else {
          setStatus("failed");
        }
      } catch (e) {
        if (cancelled) return;
        if (intentos < 5) {
          setIntentos((x) => x + 1);
          setTimeout(poll, 2500);
        } else {
          setStatus("failed");
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inscripcion_id, provider]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <BrandHeader testID="pago-exito-header" wordmarkSize="sm" logoSize={26} />

      <View style={styles.body}>
        {status === "loading" && (
          <View style={styles.center}>
            <PadelBallLoader
              size={72}
              label={`Confirmando tu pago con ${provider === "stripe" ? "Stripe" : "Mercado Pago"}…`}
            />
          </View>
        )}

        {status === "approved" && (
          <View style={styles.center} testID="pago-exito-approved">
            <View style={styles.iconWrap}>
              <CheckCircle2 size={56} color={colors.brand.primary} />
            </View>
            <Text style={styles.title}>¡Inscripción confirmada!</Text>
            <Text style={styles.subtitle}>
              Te enviaremos los detalles por WhatsApp. Llega 10 min antes.
            </Text>
          </View>
        )}

        {status === "pending" && (
          <View style={styles.center} testID="pago-exito-pending">
            <View style={[styles.iconWrap, { backgroundColor: colors.status.amberBg }]}>
              <Calendar size={48} color={colors.status.amberText} />
            </View>
            <Text style={styles.title}>Tu pago está procesándose</Text>
            <Text style={styles.subtitle}>
              En cuanto tu banco lo confirme, tu lugar quedará reservado automáticamente.
              Te avisaremos por WhatsApp.
            </Text>
          </View>
        )}

        {status === "failed" && (
          <View style={styles.center} testID="pago-exito-failed">
            <Text style={styles.title}>No pudimos verificar el pago</Text>
            <Text style={styles.subtitle}>
              Revisa tu cuenta de {provider === "stripe" ? "Stripe" : "Mercado Pago"} o
              intenta de nuevo desde la reta.
            </Text>
          </View>
        )}

        <View style={styles.ctaRow}>
          {reta_slug ? (
            <TouchableOpacity
              testID="pago-volver-reta"
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => router.replace(`/retas/${reta_slug}` as any)}
            >
              <Text style={styles.btnPrimaryText}>Ver mi reta</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            testID="pago-ir-home"
            style={[styles.btn, styles.btnGhost]}
            onPress={() => router.replace("/")}
          >
            <Home size={16} color={colors.brand.primary} />
            <Text style={styles.btnGhostText}>Volver al inicio</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.app },
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
  },
  center: { alignItems: "center", gap: spacing.md },
  iconWrap: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.brand.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h1,
    textAlign: "center",
  },
  subtitle: {
    ...typography.bodyRelaxed,
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
  bodyText: {
    ...typography.body,
    marginTop: spacing.md,
  },
  ctaRow: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.base,
    borderRadius: radii.md,
  },
  btnPrimary: {
    backgroundColor: colors.brand.primary,
  },
  btnPrimaryText: {
    ...typography.buttonLg,
    color: colors.brand.onPrimary,
  },
  btnGhost: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  btnGhostText: {
    ...typography.button,
    color: colors.brand.primary,
  },
});
