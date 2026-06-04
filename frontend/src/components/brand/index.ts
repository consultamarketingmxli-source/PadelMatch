/**
 * Barrel — Formas canónicas y componentes premium de marca (rebrand v3).
 *
 * IMPORTANTE:
 *  • Formas SVG (PadelBallShape, PadelPalaShape) son el Single Source of Truth.
 *  • Componentes UI premium (HeroBanner, Chip, FilterPill, CTAButton, etc.)
 *    encapsulan los tokens Sapphire/Azure. Úsalos en lugar de re-estilar.
 */
export { PadelBallShape } from "./PadelBallShape";
export type { PadelBallShapeProps } from "./PadelBallShape";
export { PadelPalaShape } from "./PadelPalaShape";
export type { PadelPalaShapeProps } from "./PadelPalaShape";

// Componentes premium rebrand v3
export { HeroBanner } from "./HeroBanner";
export type { HeroBannerProps } from "./HeroBanner";
export { Chip } from "./Chip";
export type { ChipProps, ChipVariant } from "./Chip";
export { QuickActionTile } from "./QuickActionTile";
export type { QuickActionTileProps } from "./QuickActionTile";
export { FilterPill } from "./FilterPill";
export type { FilterPillProps } from "./FilterPill";
export { CTAButton } from "./CTAButton";
export type {
  CTAButtonProps,
  CTAButtonVariant,
  CTAButtonSize,
} from "./CTAButton";
export { SectionHeader } from "./SectionHeader";
export type { SectionHeaderProps } from "./SectionHeader";
export { SearchInput } from "./SearchInput";
export type { SearchInputProps } from "./SearchInput";
export { RetaCardPremium } from "./RetaCardPremium";
