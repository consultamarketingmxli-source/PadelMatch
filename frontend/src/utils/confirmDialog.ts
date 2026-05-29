/**
 * confirmDialog — wrapper cross-platform para Alert.alert con botones.
 *
 * PROBLEMA: en react-native-web, Alert.alert(title, msg, [buttons]) ignora los
 * botones y solo muestra `window.alert(title + msg)`. Los callbacks de los
 * botones JAMÁS se ejecutan en web → bug silencioso.
 *
 * SOLUCIÓN: en web usamos `window.confirm()` que devuelve true/false; en
 * native usamos Alert.alert con su array de buttons.
 *
 * USO:
 *   const ok = await confirmDialog({
 *     title: "Confirmar cambio",
 *     message: "¿Estás seguro?",
 *     confirmText: "Sí, mover",
 *     cancelText: "Cancelar",
 *     destructive: false,
 *   });
 *   if (ok) doStuff();
 */
import { Alert, Platform } from "react-native";

export interface ConfirmDialogOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  /** Si true → en iOS marca el botón como destructive (rojo). */
  destructive?: boolean;
}

export function confirmDialog(opts: ConfirmDialogOptions): Promise<boolean> {
  const {
    title,
    message = "",
    confirmText = "Aceptar",
    cancelText = "Cancelar",
    destructive = false,
  } = opts;

  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const text = message ? `${title}\n\n${message}` : title;
      return Promise.resolve(window.confirm(text));
    }
    // Server-side fallback (no debería ocurrir en runtime).
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      {
        text: cancelText,
        style: "cancel",
        onPress: () => resolve(false),
      },
      {
        text: confirmText,
        style: destructive ? "destructive" : "default",
        onPress: () => resolve(true),
      },
    ]);
  });
}

/**
 * Variante "informativa" — un único botón OK, sin opción de cancelar.
 * Mismo problema en web (Alert.alert sin buttons SÍ funciona en web vía
 * window.alert, pero por consistencia exportamos un helper unificado).
 */
export function notifyDialog(title: string, message?: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.alert(message ? `${title}\n\n${message}` : title);
      resolve();
      return;
    }
    Alert.alert(title, message, [
      { text: "OK", onPress: () => resolve() },
    ]);
  });
}
