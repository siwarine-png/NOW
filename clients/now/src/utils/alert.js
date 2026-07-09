/**
 * react-native-web's Alert.alert is a literal no-op (confirmed:
 * `static alert() {}` in react-native-web/src/exports/Alert) -- any error
 * path relying on it fails completely silently on web, with zero visible
 * feedback ("click -> nothing"). This mirrors Alert.alert's real signature
 * (title, message, buttons) but actually shows something on every platform.
 */
import { Platform, Alert } from 'react-native';

export function showAlert(title, message, buttons) {
  if (Platform.OS !== 'web') return Alert.alert(title, message, buttons);

  const text = message ? `${title}\n\n${message}` : title;
  if (!buttons || buttons.length <= 1) {
    window.alert(text);
    buttons?.[0]?.onPress?.();
    return;
  }
  // Multi-button (e.g. Cancel/Delete) -- window.confirm only gives two
  // outcomes, so this covers the common 2-button confirm/cancel case.
  const destructive = buttons.find(b => b.style === 'destructive') || buttons[buttons.length - 1];
  const cancel = buttons.find(b => b.style === 'cancel');
  if (window.confirm(text)) destructive?.onPress?.();
  else cancel?.onPress?.();
}
