/**
 * Chip — Tag semántico con 8 variantes del rebrand v3.
 *
 * Uso: <Chip variant="mid">Intermedio</Chip>
 *      <Chip variant="full">Lleno</Chip>
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { chipPalette, fonts } from "@/src/theme";

export type ChipVariant = keyof typeof chipPalette;

export type ChipProps = {
  variant: ChipVariant;
  children: React.ReactNode;
};

export function Chip({ variant, children }: ChipProps) {
  const { bg, text } = chipPalette[variant];
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color: text }]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  label: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
});
