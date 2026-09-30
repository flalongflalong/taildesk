export type Size = { width: number; height: number };
export type DisplayRegion = Size & { id: string; name: string; x: number; y: number };
export type Layout = Size & { screens: DisplayRegion[] };
export type DisplayPreferences = {
  mode: 'auto' | 'horizontal' | 'vertical' | 'custom';
  count: number;
  split: number;
  selected: string;
  custom: DisplayRegion[];
  customSize: Size;
};
export const defaultPreferences: DisplayPreferences = {
  mode: 'auto',
  count: 2,
  split: 50,
  selected: 'all',
  custom: [],
  customSize: { width: 0, height: 0 },
};
export function validRegion(r: DisplayRegion, size: Size): boolean {
  return (
    [r.x, r.y, r.width, r.height].every(Number.isInteger) &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.width > 0 &&
    r.height > 0 &&
    r.x + r.width <= size.width &&
    r.y + r.height <= size.height
  );
}

export function regionsFor(p: DisplayPreferences, layout: Layout): DisplayRegion[] {
  if (!layout.width || !layout.height) return [];
  if (p.mode === 'auto') return layout.screens.filter((r) => validRegion(r, layout));
  if (p.mode === 'custom') {
    // Pixel coordinates belong to one framebuffer size; never reuse stale
    // calibration after a resolution / display arrangement change.
    return p.customSize.width === layout.width && p.customSize.height === layout.height
      ? p.custom.filter((r) => validRegion(r, layout))
      : [];
  }
  const horizontal = p.mode === 'horizontal';
  const extent = horizontal ? layout.width : layout.height;
  const count = Math.max(2, Math.min(4, Math.round(p.count)));
  const cuts =
    count === 2
      ? [0, Math.round((extent * p.split) / 100), extent]
      : Array.from({ length: count + 1 }, (_, i) => Math.round((extent * i) / count));
  return Array.from({ length: count }, (_, i) => ({
    id: `manual-${i}`,
    name: `${horizontal ? '左右' : '上下'}屏 ${i + 1}`,
    x: horizontal ? cuts[i] : 0,
    y: horizontal ? 0 : cuts[i],
    width: horizontal ? cuts[i + 1] - cuts[i] : layout.width,
    height: horizontal ? layout.height : cuts[i + 1] - cuts[i],
  })).filter((r) => validRegion(r, layout));
}

export function readPreferences(deviceId: string): DisplayPreferences {
  try {
    const p = JSON.parse(localStorage.getItem(`taildesk.displays.${deviceId}`) || 'null');
    if (
      !p ||
      !['auto', 'horizontal', 'vertical', 'custom'].includes(p.mode) ||
      !Number.isInteger(p.count) ||
      p.count < 2 ||
      p.count > 4 ||
      !Number.isFinite(p.split) ||
      p.split < 10 ||
      p.split > 90 ||
      typeof p.selected !== 'string' ||
      !Array.isArray(p.custom) ||
      p.custom.length > 8 ||
      !p.customSize ||
      !Number.isInteger(p.customSize.width) ||
      !Number.isInteger(p.customSize.height) ||
      !p.custom.every(
        (r: DisplayRegion) =>
          r &&
          typeof r.id === 'string' &&
          typeof r.name === 'string' &&
          validRegion(r, p.customSize),
      )
    )
      return { ...defaultPreferences };
    return p;
  } catch {
    return { ...defaultPreferences };
  }
}

// Reads a complete ExtendedDesktopSize payload without consuming the receive
// queue; noVNC remains responsible for protocol framing / error handling.
export function decodeScreens(bytes: Uint8Array, size: Size): DisplayRegion[] {
  if (bytes.length < 4 || bytes.length < 4 + bytes[0] * 16) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const screens: DisplayRegion[] = [];
  for (let i = 0; i < bytes[0]; i++) {
    const offset = 4 + i * 16;
    const r = {
      id: `server-${view.getUint32(offset)}`,
      name: `屏幕 ${i + 1}`,
      x: view.getUint16(offset + 4),
      y: view.getUint16(offset + 6),
      width: view.getUint16(offset + 8),
      height: view.getUint16(offset + 10),
    };
    if (validRegion(r, size) && !screens.some((s) => s.id === r.id)) screens.push(r);
  }
  return screens;
}
