/**
 * PadelPalaIcon — Wrapper público (compat) sobre `PadelPalaShape`.
 *
 * La geometría real de la pala vive en
 *   `@/src/components/brand/PadelPalaShape` (Single Source of Truth).
 *
 * Este archivo se mantiene SÓLO para preservar el contrato público antiguo
 * (`<PadelPalaIcon size color filled />`) usado en pantallas existentes.
 *
 * - filled=true  → cabezal coloreado + huecos blancos (default uso flat).
 * - filled=false → silueta monocromática (variante chips/breadcrumbs).
 */
import React from "react";
import { PadelPalaShape } from "@/src/components/brand";

type Props = {
  size?: number;
  color?: string;
  /** Conservado por compatibilidad (no influye en render: la silueta es la misma). */
  strokeWidth?: number;
  filled?: boolean;
};

const DEFAULT_BODY = "#1E1B4B"; // indigo-950
const DEFAULT_MONO = "#0F172A"; // slate-900

export function PadelPalaIcon({ size = 24, color, filled = true }: Props) {
  if (!filled) {
    // Variante mono: silueta sólida, huecos del mismo color del fondo
    // (para que la pala se lea como un chip lleno sin perforaciones visibles).
    const c = color ?? DEFAULT_MONO;
    return (
      <PadelPalaShape
        size={size}
        color={c}
        gripColor={c}
        cordColor={c}
        holeColor={c}
        opacity={0.95}
      />
    );
  }
  return (
    <PadelPalaShape
      size={size}
      color={color ?? DEFAULT_BODY}
      holeColor="#FFFFFF"
    />
  );
}
