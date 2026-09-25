import { useRef, type RefObject } from "react";
import { Platform, type NativeSyntheticEvent, type TextInput, type TextInputEndEditingEventData } from "react-native";

/**
 * Send what the keyboard has COMMITTED, not what the field shows.
 *
 * iOS, pinyin (any composing keyboard): the syllables still being composed —
 * UIKit's "marked text" — are already in `draft` (RN reports the field's text,
 * marked part included), yet the keyboard has not committed them. Sending
 * `draft` would send them as they stand. So the send key first has the field
 * resign: UIKit commits the marked text on the way out, and `onEndEditing`
 * then reports the committed text — that is what is sent. The field takes
 * focus straight back, so the keyboard stays for the next letter.
 * Android reports composing text the same way, but the handoff asked for iOS.
 *
 * Spread `onEndEditing` onto the field; call `press` from the send control.
 * `allowEmpty`: an empty draft still sends (a circle post with images and no text).
 */
export function useCommittedSend(
  input: RefObject<TextInput | null>,
  draft: string,
  onSend: (text: string) => void,
  allowEmpty = false
) {
  const committing = useRef(false);
  const press = () => {
    if (!draft.trim() && !allowEmpty) return;
    if (Platform.OS !== "ios" || !input.current?.isFocused()) return onSend(draft);
    committing.current = true;
    input.current.blur();
    input.current.focus();
  };
  const onEndEditing = (e: NativeSyntheticEvent<TextInputEndEditingEventData>) => {
    if (!committing.current) return;
    committing.current = false;
    onSend(e.nativeEvent.text);
  };
  return { press, onEndEditing };
}
