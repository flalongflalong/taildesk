import type RFB from '@novnc/novnc';

export type Point = { x: number; y: number };
export type PointerFrame = { x: number; y: number; w: number; h: number; scale: number };
type PointerInternals = {
  _rfbConnectionState: string;
  _display: {
    scale: number;
    _viewportLoc: { x: number; y: number; w: number; h: number };
    absX(x: number): number;
    absY(y: number): number;
    viewportChangePos(x: number, y: number): void;
  };
  _canvas: HTMLCanvasElement;
  _sendMouse(x: number, y: number, mask: number): void;
  _mouseMoveTimer: ReturnType<typeof setTimeout> | null;
  _mouseButtonMask: number;
  _mousePos: Point;
};

export function clampPointer(point: Point, frame: PointerFrame): Point {
  return {
    x: Math.max(frame.x, Math.min(frame.x + frame.w - 1, point.x)),
    y: Math.max(frame.y, Math.min(frame.y + frame.h - 1, point.y)),
  };
}

// Deflection in CSS pixels → velocity in visible CSS pixels per second.
// A small dead zone and a curved response allow both fine and long movement.
export function joystickVelocity(x: number, y: number, radius = 36): Point {
  const distance = Math.hypot(x, y);
  if (distance <= 5) return { x: 0, y: 0 };
  const speed = 480 * Math.pow(Math.min(1, (distance - 5) / (radius - 5)), 1.6);
  return { x: (x / distance) * speed, y: (y / distance) * speed };
}

// noVNC 1.7.0 has no public pointer API. Keep this integration isolated and
// exercise it against real RFB messages, including crop offsets and releases.
export function installPointer(client: RFB, changed: () => void) {
  const r = client as unknown as PointerInternals;
  const d = r._display;
  const originalSend = r._sendMouse;
  const originalPan = d.viewportChangePos;
  let position: Point | null = null;
  let held = 0;
  let disposed = false;
  const frame = (): PointerFrame => ({ ...d._viewportLoc, scale: d.scale });
  const usable = () => !disposed && r._rfbConnectionState === 'connected' && !client.viewOnly;
  const ready = () => usable() && frame().w > 0 && frame().h > 0 && frame().scale > 0;
  const send = (point: Point, mask: number) => {
    if (!ready()) return;
    // A delayed noVNC movement must not undo a new virtual mouse position.
    if (r._mouseMoveTimer !== null) clearTimeout(r._mouseMoveTimer);
    r._mouseMoveTimer = null;
    const f = frame();
    const p = clampPointer(point, f);
    const local = { x: (p.x - f.x) * f.scale, y: (p.y - f.y) * f.scale };
    r._mousePos = local;
    r._mouseButtonMask = mask;
    r._sendMouse(local.x, local.y, mask);
  };
  // Observe actual sent coordinates, never assume a server-side cursor position.
  const observe = (x: number, y: number, mask: number) => {
    originalSend.call(r, x, y, mask);
    if (usable()) {
      position = { x: d.absX(x), y: d.absY(y) };
      held = mask & 7;
      changed();
    }
  };
  const pan = (x: number, y: number) => {
    originalPan.call(d, x, y);
    changed();
  };
  r._sendMouse = observe;
  d.viewportChangePos = pan;
  const startPoint = () => {
    const f = frame();
    if (
      position &&
      position.x >= f.x &&
      position.y >= f.y &&
      position.x < f.x + f.w &&
      position.y < f.y + f.h
    )
      return position;
    return { x: f.x + Math.floor(f.w / 2), y: f.y + Math.floor(f.h / 2) };
  };
  const release = () => {
    if (held && usable() && position) send(position, 0);
    held = 0;
  };
  return {
    canvas: r._canvas,
    snapshot: () => ({ position, frame: frame(), held }),
    refresh: changed,
    move(dx: number, dy: number) {
      if (!ready()) return;
      const p = startPoint();
      const scale = frame().scale;
      // Retain subpixel progress at slow joystick speeds / high display scales.
      const next = clampPointer({ x: p.x + dx / scale, y: p.y + dy / scale }, frame());
      send(next, held);
      position = next;
      changed();
    },
    center() {
      if (!ready()) return;
      const f = frame();
      send({ x: f.x + Math.floor(f.w / 2), y: f.y + Math.floor(f.h / 2) }, held);
    },
    button(mask: 1 | 4, down: boolean) {
      if (!ready()) return;
      const next = down ? held | mask : held & ~mask;
      if (next !== held) send(startPoint(), next);
    },
    release,
    dispose() {
      release();
      disposed = true;
      if (r._sendMouse === observe) r._sendMouse = originalSend;
      if (d.viewportChangePos === pan) d.viewportChangePos = originalPan;
    },
  };
}
