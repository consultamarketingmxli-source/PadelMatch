/**
 * SectionHeader — Encabezado con título + acción "Ver todas" opcional.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "@/src/theme";

export type SectionHeaderProps = {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
};

export function SectionHeader({ title, actionLabel, onActionPress }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {actionLabel && onActionPress && (
        <Pressable onPress={onActionPress} hitSlop={8}>
          <Text style={styles.action}>{actionLabel} →</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    color: colors.brand.ink,
    fontFamily: fonts.sansExtraBold,
    fontSize: 17,
    letterSpacing: -0.4,
  },
  action: {
    color: colors.brand.azure,
    fontFamily: fonts.sansSemiBold,
    fontSize: 13,
    letterSpacing: -0.2,
  },
});
