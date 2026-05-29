/**
 * CheckoutCard — Tarjeta de inscripción + pago para retas de pago.
 *
 * Extraído de `/app/retas/[slug].tsx` (Fase 4 — refactor de deuda técnica).
 *
 * Sub-flujos cubiertos por este componente:
 *   • Individual o Duo (parejas) o Free-agent (busco pareja)
 *   • Cupón de regalo (validar + remover + monto $0)
 *   • CTA único que dispara handleAction (checkout MP / waitlist / canje cupón)
 *
 * 100% presentacional. El padre orquesta la lógica de negocio y pasa
 * estado + handlers como props.
 */
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { UserPlus, Search } from "lucide-react-native";
import { Button } from "@/src/components/Button";
import { Input } from "@/src/components/Input";
import { colors, radii, spacing, typography } from "@/src/theme";

export type RegMode = "solo" | "duo" | "free_agent";

export type CuponState =
  | null
  | { ok: true; codigo: string; descripcion: string }
  | { ok: false; razon: string };

type Props = {
  lleno: boolean;
  esRetaParejas: boolean;
  permiteIndiv: boolean;
  regMode: RegMode;
  onChangeRegMode: (m: RegMode) => void;

  nombre: string;
  telefono: string;
  parejaNombre: string;
  parejaTelefono: string;
  onChangeNombre: (v: string) => void;
  onChangeTelefono: (v: string) => void;
  onChangeParejaNombre: (v: string) => void;
  onChangeParejaTelefono: (v: string) => void;

  costoUnitario: number;

  // Cupón
  cuponCodigo: string;
  cuponState: CuponState;
  cuponValidando: boolean;
  cuponAplicado: boolean;
  onChangeCuponCodigo: (v: string) => void;
  onValidateCupon: () => void;
  onRemoveCupon: () => void;

  // CTA
  ctaText: string;
  submitting: boolean;
  onAction: () => void;
};

export function CheckoutCard(props: Props) {
  const {
    lleno,
    esRetaParejas,
    permiteIndiv,
    regMode,
    onChangeRegMode,
    nombre,
    telefono,
    parejaNombre,
    parejaTelefono,
    onChangeNombre,
    onChangeTelefono,
    onChangeParejaNombre,
    onChangeParejaTelefono,
    costoUnitario,
    cuponCodigo,
    cuponState,
    cuponValidando,
    cuponAplicado,
    onChangeCuponCodigo,
    onValidateCupon,
    onRemoveCupon,
    ctaText,
    submitting,
    onAction,
  } = props;

  return (
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

      {esRetaParejas && !lleno ? (
        <View style={styles.modeSelector} testID="reg-mode-selector">
          <ModeChip
            active={regMode === "duo"}
            onPress={() => onChangeRegMode("duo")}
            icon={
              <UserPlus
                size={14}
                color={regMode === "duo" ? "#fff" : colors.text.primary}
              />
            }
            label="Con mi pareja"
            testID="mode-duo"
          />
          {permiteIndiv ? (
            <ModeChip
              active={regMode === "free_agent"}
              onPress={() => onChangeRegMode("free_agent")}
              icon={
                <Search
                  size={14}
                  color={regMode === "free_agent" ? "#fff" : colors.text.primary}
                />
              }
              label="Busco pareja"
              testID="mode-free-agent"
            />
          ) : null}
        </View>
      ) : null}

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
        onChangeText={onChangeNombre}
        autoCapitalize="words"
        testID="checkout-nombre-input"
      />
      <Input
        label="Tu teléfono (WhatsApp)"
        placeholder="+5215512345678"
        value={telefono}
        onChangeText={onChangeTelefono}
        keyboardType="phone-pad"
        testID="checkout-telefono-input"
      />

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
            onChangeText={onChangeParejaNombre}
            autoCapitalize="words"
            testID="checkout-pareja-nombre-input"
          />
          <Input
            label="Teléfono de tu pareja (WhatsApp)"
            placeholder="+5215587654321"
            value={parejaTelefono}
            onChangeText={onChangeParejaTelefono}
            keyboardType="phone-pad"
            testID="checkout-pareja-telefono-input"
          />
          <Text style={styles.duoHint}>
            Reservamos 2 cupos y cobramos {`$${costoUnitario} x 2 = $${costoUnitario * 2}`} en un solo pago.
          </Text>
        </View>
      ) : null}

      {!lleno ? (
        <View
          style={[styles.cuponCard, cuponAplicado && styles.cuponCardApplied]}
          testID="cupon-card"
        >
          <Text style={styles.cuponLabel}>¿Tienes un cupón de regalo?</Text>
          <View style={styles.cuponRow}>
            <View style={{ flex: 1 }}>
              <Input
                label=""
                placeholder="PROPLAYER100"
                value={cuponCodigo}
                onChangeText={onChangeCuponCodigo}
                autoCapitalize="characters"
                editable={!cuponAplicado && !submitting}
                testID="cupon-input"
              />
            </View>
            {cuponAplicado ? (
              <TouchableOpacity
                onPress={onRemoveCupon}
                style={styles.cuponRemoveBtn}
                testID="cupon-remove-btn"
              >
                <Text style={styles.cuponRemoveTxt}>Quitar</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={onValidateCupon}
                style={[
                  styles.cuponApplyBtn,
                  (!cuponCodigo.trim() || cuponValidando) && { opacity: 0.5 },
                ]}
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
        onPress={onAction}
        variant={lleno ? "danger" : "primary"}
        size="lg"
        brandIcon
        loading={submitting}
        testID={lleno ? "waitlist-btn" : "pay-button"}
      />
    </View>
  );
}

function ModeChip({
  active,
  onPress,
  icon,
  label,
  testID,
}: {
  active: boolean;
  onPress: () => void;
  icon: React.ReactNode;
  label: string;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.modeChip, active && styles.modeChipActive]}
      testID={testID}
      activeOpacity={0.85}
    >
      {icon}
      <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  formCard: {
    backgroundColor: colors.bg.card,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  formTitle: { ...typography.h3, color: colors.text.primary, marginBottom: 4 },
  formSubtitle: {
    color: colors.text.secondary,
    fontSize: 13,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
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
  cuponCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    padding: spacing.sm + 2,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.bg.card,
  },
  cuponCardApplied: {
    backgroundColor: "#ECFDF5",
    borderColor: "#10B98160",
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
    color: "#047857",
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
});
