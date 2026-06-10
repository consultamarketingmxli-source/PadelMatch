/** PadelPaddleIcon — pala estilizada para uso in-app (tabs, tiles, cards).
 *
 * NOTA: este NO es el isotipo de App Store. Es una versión simplificada
 * y limpia para íconos pequeños (16-48 px). Usa `currentColor` por defecto
 * para heredar el color del padre vía la prop `color`.
 */
import React from "react";
import Svg, { Path, Circle } from "react-native-svg";

export function PadelPaddleIcon({
  size = 22,
  color = "currentColor",
  style,
}: {
  size?: number;
  color?: string;
  style?: any;
}) {
  return (
    <Svg width={size} height={size * 1.55} viewBox="0 0 100 155" fill="none" style={style}>
      {/* Cabeza teardrop */}
      <Path
        d="M50 4 C75 4 92 22 92 48 C92 72 76 92 56 96 L56 105 L60 110 L40 110 L44 105 L44 96 C24 92 8 72 8 48 C8 22 25 4 50 4 Z"
        fill={color}
      />
      {/* Handle */}
      <Path
        d="M42 110 L42 145 Q42 152 50 152 Q58 152 58 145 L58 110 Z"
        fill={color}
      />
      {/* Agujeros (white dots para contraste sobre el fill) */}
      <Circle cx="38" cy="32" r="3" fill="white" fillOpacity="0.85" />
      <Circle cx="50" cy="32" r="3" fill="white" fillOpacity="0.85" />
      <Circle cx="62" cy="32" r="3" fill="white" fillOpacity="0.85" />
      <Circle cx="32" cy="46" r="3" fill="white" fillOpacity="0.85" />
      <Circle cx="44" cy="46" r="3" fill="white" fillOpacity="0.85" />
      <Circle cx="56" cy="46" r="3" fill="white" fillOpacity="0.85" />
      <Circle cx="68" cy="46" r="3" fill="white" fillOpacity="0.85" />
      <Circle cx="38" cy="60" r="3" fill="white" fillOpacity="0.85" />
      <Circle cx="50" cy="60" r="3" fill="white" fillOpacity="0.85" />
      <Circle cx="62" cy="60" r="3" fill="white" fillOpacity="0.85" />
      <Circle cx="32" cy="74" r="3" fill="white" fillOpacity="0.75" />
      <Circle cx="44" cy="74" r="3" fill="white" fillOpacity="0.75" />
      <Circle cx="56" cy="74" r="3" fill="white" fillOpacity="0.75" />
      <Circle cx="68" cy="74" r="3" fill="white" fillOpacity="0.75" />
    </Svg>
  );
}
