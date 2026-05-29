/** Cross-platform confirmation dialog.
 *
 * `Alert.alert(title, msg, buttons)` con múltiples botones es **no-op** en
 * react-native-web (las versiones recientes ignoran los botones). En web
 * usamos `window.confirm` que es síncrono y nativo del navegador. En iOS/
 * Android usamos el `Alert.alert` nativo con los botones de siempre.
 *
 * Para confirmaciones de dos pasos (e.g. eliminar cuenta), encadena:
 *   confirmAlert({...}, () => confirmAlert({...}, deleteFn))
 */
import { Alert, Platform } from "react-native";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
};

export function confirmAlert(opts: ConfirmOptions): void {
  const {
    title,
    message,
    confirmText = "OK",
    cancelText = "Cancelar",
    destructive = false,
    onConfirm,
    onCancel,
  } = opts;

  if (Platform.OS === "web") {
    // window.confirm es sync — devuelve true si OK, false si Cancel.
    const fullText = `${title}\n\n${message}`;
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const accepted = window.confirm(fullText);
      if (accepted) {
        Promise.resolve(onConfirm()).catch(() => {
          /* swallow — caller debería manejar sus propios errores */
        });
      } else if (onCancel) {
        onCancel();
      }
      return;
    }
    // SSR / no window — directamente ejecuta (fail-safe).
    onConfirm();
    return;
  }

  // Native (iOS / Android / Expo Go)
  Alert.alert(title, message, [
    { text: cancelText, style: "cancel", onPress: onCancel },
    {
      text: confirmText,
      style: destructive ? "destructive" : "default",
      onPress: () => {
        Promise.resolve(onConfirm()).catch(() => {
          /* swallow */
        });
      },
    },
  ]);
}

/** Mensaje informativo simple (un solo botón "OK").
 *  Web: `window.alert`; native: `Alert.alert`. */
export function infoAlert(title: string, message: string, onClose?: () => void): void {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(`${title}\n\n${message}`);
    }
    onClose?.();
    return;
  }
  Alert.alert(title, message, [{ text: "OK", onPress: onClose }]);
}
