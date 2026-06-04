/**
 * AdminPanicButton — "Asistente de Operación" para organizadores.
 *
 * FAB rojo flotante (abajo-derecha) en pantallas admin que despliega un
 * bottom-sheet con accesos rápidos para resolver problemas en cancha:
 *
 *   1. 💬 Soporte PadelappRetas (WhatsApp humano)
 *   2. 📋 Mesa de Control (resultados en vivo) — si hay una reta activa
 *   3. 🎯 Crear nueva convocatoria (atajo)
 *
 * Pensado para que el organizador, en plena ejecución de un evento, pueda
 * pedir ayuda o saltar a la pantalla crítica con un solo tap.
 *
 * Sin permisos especiales, sin dependencias del slug — vive en el admin.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Platform,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import {
  ShieldAlert,
  X,
  MessageCircle,
  ClipboardList,
  Plus,
  HelpCircle,
} from "lucide-react-native";
import { colors, radii, spacing, typography } from "@/src/theme";

const SUPPORT_WHATSAPP_NUMBER =
  process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP || "+5215512345678";

type Props = {
  /** Si está presente, habilita el atajo "Mesa de Control". */
  activeRetaId?: string;
  /** Texto a mandar al soporte. Default: contexto genérico. */
  supportContext?: string;
};

export function AdminPanicButton({ activeRetaId, supportContext }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  const openSupport = () => {
    const text = encodeURIComponent(
      supportContext ||
        "Hola, soy organizador en PadelappRetas y necesito ayuda urgente.",
    );
    const url = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER.replace(/\D/g, "")}?text=${text}`;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      Linking.openURL(url).catch(() => {});
    }
    close();
  };

  const goMesaControl = () => {
    if (!activeRetaId) return;
    close();
    router.push(`/admin/reta/resultados/${activeRetaId}` as any);
  };

  const goNuevaConvocatoria = () => {
    close();
    router.push("/admin/reta/new" as any);
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={styles.fab}
        accessibilityLabel="Asistente de Operación"
        accessibilityRole="button"
        activeOpacity={0.85}
        testID="admin-panic-fab"
      >
        <ShieldAlert size={22} color="#FFFFFF" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={close}>
          <TouchableOpacity
            activeOpacity={1}
            style={styles.sheet}
            onPress={(e) => e.stopPropagation?.()}
          >
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderInfo}>
                <ShieldAlert size={20} color={colors.status.red} />
                <Text style={styles.sheetTitle}>Asistente de Operación</Text>
              </View>
              <TouchableOpacity onPress={close} style={styles.iconBtn} testID="admin-panic-close">
                <X size={20} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.sheetContent}>
              <Text style={styles.helperText}>
                ¿Algo se complicó en cancha? Aquí están los atajos críticos.
              </Text>

              <Action
                icon={<MessageCircle size={20} color="#10B981" />}
                title="Soporte por WhatsApp"
                subtitle="Habla con un humano de PadelappRetas"
                onPress={openSupport}
                testID="admin-panic-support"
              />

              {activeRetaId ? (
                <Action
                  icon={<ClipboardList size={20} color={colors.brand.primary} />}
                  title="Mesa de Control"
                  subtitle="Captura resultados en vivo de la reta actual"
                  onPress={goMesaControl}
                  testID="admin-panic-mesa"
                />
              ) : null}

              <Action
                icon={<Plus size={20} color={colors.brand.primary} />}
                title="Nueva Convocatoria"
                subtitle="Crea una nueva reta desde cero"
                onPress={goNuevaConvocatoria}
                testID="admin-panic-nueva"
              />

              <View style={styles.tipBox}>
                <HelpCircle size={14} color={colors.text.secondary} />
                <Text style={styles.tipText}>
                  Tip: este botón está disponible en todas las pantallas admin
                  para que no pierdas tiempo navegando si algo urge.
                </Text>
              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function Action({
  icon,
  title,
  subtitle,
  onPress,
  testID,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      style={styles.actionBtn}
      onPress={onPress}
      activeOpacity={0.7}
      testID={testID}
    >
      <View style={styles.actionIconWrap}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSub}>{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.status.red,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0px 4px 8px rgba(0,0,0,0.25)",
    elevation: 6,
    zIndex: 1000,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bg.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
    paddingBottom: Platform.OS === "ios" ? 24 : 16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  sheetHeaderInfo: { flexDirection: "row", alignItems: "center", gap: 8 },
  sheetTitle: { ...typography.h3, color: colors.text.primary, fontSize: 16, fontWeight: "800" },
  iconBtn: { padding: 6 },
  sheetContent: { paddingHorizontal: spacing.lg, paddingVertical: 16, gap: 12 },
  helperText: {
    ...typography.body,
    color: colors.text.secondary,
    fontSize: 13,
    marginBottom: 4,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.bg.app,
  },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg.card,
  },
  actionTitle: { ...typography.body, color: colors.text.primary, fontWeight: "700", fontSize: 14 },
  actionSub: { color: colors.text.secondary, fontSize: 12, marginTop: 2 },
  tipBox: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderRadius: radii.sm,
    backgroundColor: colors.bg.app,
    marginTop: 8,
    alignItems: "flex-start",
  },
  tipText: { color: colors.text.secondary, fontSize: 11, flex: 1, lineHeight: 16 },
});
