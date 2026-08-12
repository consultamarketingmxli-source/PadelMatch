/**
 * GoogleGIcon — Official multi-colored Google 'G' logo (SVG).
 *
 * Path data extraído del asset oficial de Google Identity Brand Guidelines
 * (viewBox 0 0 48 48). Los 4 colores son los brand-safe de Google:
 *   • Blue   #4285F4  (arc superior/derecho)
 *   • Green  #34A853  (arc inferior)
 *   • Yellow #FBBC05  (arc izquierdo)
 *   • Red    #EA4335  (arc superior)
 *
 * Reglas de uso (Google Sign-In guidelines):
 *   - Padding mínimo alrededor del logo ≥ 1/6 del tamaño.
 *   - No aplicar filtros, sombras, ni recolorear.
 *   - Tamaño mínimo recomendado 18×18pt.
 */
import React from "react";
import Svg, { Path } from "react-native-svg";

type Props = {
  size?: number;
};

export function GoogleGIcon({ size = 20 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      {/* Blue */}
      <Path
        fill="#4285F4"
        d="M47.532 24.552c0-1.638-.148-3.213-.42-4.727H24.48v8.94h12.928c-.557 3-2.254 5.542-4.807 7.243v6.017h7.775c4.549-4.194 7.156-10.377 7.156-17.473z"
      />
      {/* Green */}
      <Path
        fill="#34A853"
        d="M24.48 48c6.48 0 11.917-2.148 15.89-5.815l-7.774-6.017c-2.153 1.44-4.913 2.296-8.116 2.296-6.244 0-11.532-4.213-13.418-9.883H3.03v6.202C6.987 42.62 15.132 48 24.48 48z"
      />
      {/* Yellow */}
      <Path
        fill="#FBBC05"
        d="M11.062 28.581C10.583 27.14 10.31 25.6 10.31 24s.273-3.14.752-4.581V13.217H3.03A23.977 23.977 0 0 0 .48 24c0 3.877.926 7.54 2.55 10.783l8.032-6.202z"
      />
      {/* Red */}
      <Path
        fill="#EA4335"
        d="M24.48 9.535c3.523 0 6.687 1.212 9.176 3.59l6.884-6.884C36.386 2.375 30.95 0 24.48 0 15.132 0 6.987 5.38 3.03 13.217l8.032 6.202c1.886-5.67 7.174-9.884 13.418-9.884z"
      />
    </Svg>
  );
}
