/**
 * SearchInput — Input de búsqueda premium del rebrand v3.
 *
 * Estética:
 *   • Fondo blanco, radio 12, hairline azul, sin sombra prominente.
 *   • Ícono Search a la izquierda + slot derecho (filter / mic / clear).
 *   • Focus state: borde Azure + glow suave.
 *
 * Stateless: simplemente envuelve un TextInput. La lógica vive en el padre.
 */
import React from "react";
import {
  StyleSheet,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import { Search, X } from "lucide-react-native";
import { colors, radii, spacing, typography } from "@/src/theme";

export type SearchInputProps = TextInputProps & {
  trailing?: React.ReactNode;
  /** Si está activo, muestra una X que limpia el valor. */
  clearable?: boolean;
  onClear?: () => void;
  containerStyle?: ViewStyle;
};

export function SearchInput({
  trailing,
  clearable = true,
  onClear,
  containerStyle,
  value,
  onChangeText,
  placeholder = "Buscar…",
  ...rest
}: SearchInputProps) {
  const [focused, setFocused] = React.useState(false);
  const hasValue = typeof value === "string" && value.length > 0;

  return (
    <View
      style={[
        styles.wrapper,
        focused && styles.wrapperFocused,
        containerStyle,
      ]}
    >
      <Search
        size={16}
        color={focused ? colors.brand.azure : colors.text.secondary}
      />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.text.tertiary}
        style={styles.input}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        {...rest}
      />
      {clearable && hasValue ? (
        <TouchableOpacity
          accessibilityLabel="Limpiar búsqueda"
          onPress={() => {
            onChangeText?.("");
            onClear?.();
          }}
          hitSlop={8}
          style={styles.clearBtn}
        >
          <X size={14} color={colors.text.secondary} />
        </TouchableOpacity>
      ) : null}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.bg.card,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border.blueHairline,
  },
  wrapperFocused: {
    borderColor: colors.brand.azure,
    boxShadow: "0px 0px 0px 3px rgba(59,130,246,0.15)",
  } as any,
  input: {
    flex: 1,
    ...typography.body,
    color: colors.text.primary,
    paddingVertical: 0,
  },
  clearBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.bg.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  trailing: {
    alignItems: "center",
    justifyContent: "center",
  },
});
