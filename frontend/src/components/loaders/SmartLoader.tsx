/**
 * <SmartLoader /> — Wrapper declarativo que aplica la lógica del brief:
 *   - <300ms:  no muestra nada (children directo si !loading).
 *   - 300–800: muestra `skeleton`.
 *   - >=800:   muestra `criticalLoader` (default: <PadelBallLoader />).
 *
 * Uso mínimo:
 *   <SmartLoader loading={isLoading} skeleton={<Skeleton.RetaCard />}>
 *     <Feed data={data} />
 *   </SmartLoader>
 *
 * Uso avanzado (override crítico):
 *   <SmartLoader loading={isLoading}
 *                skeleton={<MiSkeleton/>}
 *                criticalLoader={<PadelBallLoader label="Procesando pago..." />}>
 *     ...
 *   </SmartLoader>
 */
import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";

import { useSmartLoader } from "@/src/hooks/useSmartLoader";
import { PadelBallLoader } from "./PadelBallLoader";

export type SmartLoaderProps = {
  loading: boolean;
  skeleton?: React.ReactNode;
  criticalLoader?: React.ReactNode;
  /** Si se entrega, se renderiza cuando loading=false. */
  children?: React.ReactNode;
  /** Si true, mantiene `children` visible debajo del loader cuando aparece. */
  keepChildrenWhileLoading?: boolean;
  containerStyle?: ViewStyle;
};

export function SmartLoader({
  loading,
  skeleton,
  criticalLoader,
  children,
  keepChildrenWhileLoading = false,
  containerStyle,
}: SmartLoaderProps) {
  const { showSkeleton, showCriticalLoader } = useSmartLoader(loading);

  // No loading: render directo (cero gates).
  if (!loading) {
    return <>{children}</>;
  }

  // Loading rápido (<300ms) o no hemos cruzado el debounce: render fluido.
  if (!showSkeleton && !showCriticalLoader) {
    return keepChildrenWhileLoading ? <>{children}</> : null;
  }

  // 300–800ms: skeleton.
  if (showSkeleton && !showCriticalLoader) {
    return (
      <View style={[styles.wrap, containerStyle]}>
        {keepChildrenWhileLoading && children}
        {skeleton ?? <DefaultSkeleton />}
      </View>
    );
  }

  // >=800ms: loader crítico (pelota).
  return (
    <View style={[styles.wrap, styles.centered, containerStyle]}>
      {keepChildrenWhileLoading && children}
      {criticalLoader ?? <PadelBallLoader label="Cargando..." />}
    </View>
  );
}

function DefaultSkeleton() {
  // Fallback genérico cuando el caller no pasa uno.
  return (
    <View style={styles.defaultSkeleton}>
      <View style={styles.placeholderLine} />
      <View style={[styles.placeholderLine, { width: "75%" }]} />
      <View style={[styles.placeholderLine, { width: "55%" }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: "100%" },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  defaultSkeleton: { padding: 16, gap: 8 },
  placeholderLine: {
    backgroundColor: "#E2E8F0",
    height: 12,
    borderRadius: 6,
    width: "100%",
  },
});
