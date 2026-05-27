/**
 * Barra de búsqueda híbrida — texto libre + botón GPS al extremo derecho.
 *
 * Diseño "Club Pro Clean":
 * - Container: bg-white, border-slate-200, esquinas suaves.
 * - Input: placeholder limpio, font Inter regular.
 * - Botón GPS:
 *    - Activo:  bg-emerald-600 + texto blanco + animación de pulso sutil.
 *    - Inactivo / denegado: bg-slate-100 + texto slate-500 (sin afectar el resto).
 *
 * Sanitización: el componente NO sanitiza — el caller usa `api.buscarRetas` que
 * aplica `.trim().toLowerCase()` antes de la petición y el backend ignora
 * queries vacíos. Así evitamos consultas redundantes al backend al teclear.
 */
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LocateFixed, Search } from "lucide-react-native";
import { colors, fonts, radii, spacing } from "@/src/theme";

type GpsState = "idle" | "active" | "loading" | "denied";

type Props = {
  value: string;
  onChangeText: (v: string) => void;
  onSubmit?: () => void;
  gpsState: GpsState;
  onTogglePress: () => void;
  placeholder?: string;
  testID?: string;
};

export function SearchBar({
  value,
  onChangeText,
  onSubmit,
  gpsState,
  onTogglePress,
  placeholder = "Buscar por reta o club…",
  testID = "search-bar",
}: Props) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    if (gpsState === "active") {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(pulse, {
            toValue: 0,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
      );
      loop.start();
    } else {
      pulse.setValue(0);
    }
    return () => {
      if (loop) loop.stop();
    };
  }, [gpsState, pulse]);

  const gpsBg = gpsState === "active" ? colors.brand.primary : colors.bg.elevated;
  const gpsColor = gpsState === "active" ? colors.text.inverse : colors.text.secondary;
  const halo = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: ["rgba(5,150,105,0.0)", "rgba(5,150,105,0.35)"],
  });
  const scale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.inputRow}>
        <Search size={16} color={colors.text.tertiary} />
        <TextInput
          testID="search-input"
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={colors.text.tertiary}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          returnKeyType="search"
          autoCorrect={false}
          maxLength={80}
        />
      </View>
      <Animated.View
        style={[
          styles.gpsHalo,
          { backgroundColor: halo, transform: [{ scale }] },
        ]}
        pointerEvents="none"
      />
      <TouchableOpacity
        testID="gps-toggle-btn"
        activeOpacity={0.85}
        onPress={onTogglePress}
        disabled={gpsState === "loading"}
        style={[
          styles.gpsBtn,
          { backgroundColor: gpsBg },
        ]}
      >
        <LocateFixed size={18} color={gpsColor} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
  },
  inputRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.bg.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  input: {
    flex: 1,
    fontFamily: fonts.sansRegular,
    fontSize: 14,
    color: colors.text.primary,
    paddingVertical: 0,
  },
  gpsHalo: {
    position: "absolute",
    right: 0,
    width: 44,
    height: 44,
    borderRadius: radii.md,
  },
  gpsBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border.default,
  },
});
