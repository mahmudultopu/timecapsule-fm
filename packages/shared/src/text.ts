// Unicode bidi embedding/override/isolate controls. They are stripped from
// user text because they can visually reorder a string (e.g. disguise a URL
// or a name). LRM/RLM marks (U+200E/U+200F) are kept: they are harmless and
// legitimately needed in mixed-direction place names.
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;
// C0/C1 control characters except tab and newline.
// eslint-disable-next-line no-control-regex -- matching control chars is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/**
 * Normalises contributor-supplied plain text before it is stored.
 * This is NOT an HTML sanitiser: user text is only ever rendered as text
 * nodes (React escapes it); nothing user-supplied is rendered as HTML.
 */
export function cleanPlainText(input: string): string {
  return input.normalize('NFC').replace(CONTROL_CHARS, '').replace(BIDI_CONTROLS, '').trim();
}
