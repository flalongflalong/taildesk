export const KEY = {
  meta: 0xffeb,
  ctrl: 0xffe3,
  alt: 0xffe9,
  shift: 0xffe1,
  tab: 0xff09,
  enter: 0xff0d,
  escape: 0xff1b,
  backspace: 0xff08,
  left: 0xff51,
  up: 0xff52,
  right: 0xff53,
  down: 0xff54,
  home: 0xff50,
  end: 0xff57,
  pageUp: 0xff55,
  pageDown: 0xff56,
  delete: 0xffff,
};
export type Modifier = 'meta' | 'ctrl' | 'alt' | 'shift';
const codes: Record<Modifier, string> = {
  meta: 'MetaLeft',
  ctrl: 'ControlLeft',
  alt: 'AltLeft',
  shift: 'ShiftLeft',
};
type Keyboard = { sendKey(keysym: number, code?: string, down?: boolean): void };

// A chord is one atomic UI action. Never leave a remote modifier held while
// waiting for another tap, a keyboard panel, a network reconnect, or app resume.
export function sendChord(client: Keyboard, keysym: number, modifiers: Modifier[] = []) {
  const pressed = [...new Set(modifiers)];
  try {
    for (const m of pressed) client.sendKey(KEY[m], codes[m], true);
    client.sendKey(keysym);
  } finally {
    for (const m of pressed.reverse()) client.sendKey(KEY[m], codes[m], false);
  }
}

export function textKeysyms(text: string): number[] {
  return Array.from(text.replace(/\r\n?/g, '\n'), (char) => {
    const cp = char.codePointAt(0)!;
    return cp === 10 ? KEY.enter : cp === 9 ? KEY.tab : cp <= 255 ? cp : 0x01000000 | cp;
  });
}
