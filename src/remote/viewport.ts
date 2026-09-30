import type RFB from '@novnc/novnc';
import { decodeScreens, validRegion, type DisplayRegion, type Layout } from './displays';

// noVNC 1.7.0 has no public screen-selection API. All private integration lives
// here, with the dependency pinned and real protocol/browser regression tests.
// Cropping uses Display's own viewport so absX/absY map both mouse and gestures
// back to the full framebuffer. We never send SetDesktopSize to the computer.
type Internals = {
  _display: {
    width: number;
    height: number;
    scale: number;
    clipViewport: boolean;
    _viewportLoc: { x: number; y: number; w: number; h: number };
    viewportChangeSize(w: number, h: number): void;
    viewportChangePos(x: number, y: number): void;
    autoscale(w: number, h: number): void;
  };
  _sock: {
    rQwait(message: string, bytes: number): boolean;
    rQpeek8(): number;
    rQpeekBytes(n: number): Uint8Array;
  };
  _FBU: { x: number; y: number; width: number; height: number };
  _resize(w: number, h: number): void;
  _handleExtendedDesktopSize(): boolean;
  _updateClip(): void;
  _updateScale(): void;
  _screenSize(): { w: number; h: number };
  _fixScrollbars(): void;
  _setClippingViewport(on: boolean): void;
  _saveExpectedClientSize(): void;
};

export function installDisplayViewport(client: RFB, onLayout: (layout: Layout) => void) {
  const r = client as unknown as Internals;
  const d = r._display;
  const originalClip = r._updateClip.bind(r);
  const originalScale = r._updateScale.bind(r);
  const originalResize = r._resize.bind(r);
  const originalExtended = r._handleExtendedDesktopSize.bind(r);
  const originalPosition = d.viewportChangePos.bind(d);
  let region: DisplayRegion | null = null;
  let screens: DisplayRegion[] = [];
  let extended = false;

  d.viewportChangePos = (dx, dy) => {
    if (region) {
      const vp = d._viewportLoc;
      dx = Math.max(region.x, Math.min(region.x + region.width - vp.w, vp.x + dx)) - vp.x;
      dy = Math.max(region.y, Math.min(region.y + region.height - vp.h, vp.y + dy)) - vp.y;
    }
    originalPosition(dx, dy);
  };
  r._updateClip = () => {
    if (!region) {
      originalClip();
      return;
    }
    const size = r._screenSize();
    d.clipViewport = true;
    d.viewportChangeSize(
      client.scaleViewport ? region.width : Math.min(region.width, size.w),
      client.scaleViewport ? region.height : Math.min(region.height, size.h),
    );
    d.viewportChangePos(0, 0);
    r._setClippingViewport(d._viewportLoc.w < region.width || d._viewportLoc.h < region.height);
    r._fixScrollbars();
    r._saveExpectedClientSize();
  };
  r._updateScale = () => {
    if (!region) {
      originalScale();
      return;
    }
    const size = r._screenSize();
    if (client.scaleViewport) d.autoscale(size.w, size.h);
    else d.scale = 1;
    r._fixScrollbars();
  };
  r._resize = (width, height) => {
    region = null;
    if (!extended) screens = [];
    originalResize(width, height);
    onLayout({ width, height, screens: screens.filter((s) => validRegion(s, { width, height })) });
  };
  r._handleExtendedDesktopSize = () => {
    if (r._sock.rQwait('Taildesk display layout', 4)) return false;
    const length = 4 + r._sock.rQpeek8() * 16;
    if (r._sock.rQwait('Taildesk display layout', length)) return false;
    if (r._FBU.x !== 1 || r._FBU.y === 0)
      screens = decodeScreens(r._sock.rQpeekBytes(length), r._FBU);
    extended = true;
    try {
      return originalExtended();
    } finally {
      extended = false;
    }
  };
  return {
    select(next: DisplayRegion | null) {
      region = next && validRegion(next, d) ? next : null;
      r._updateClip();
      if (region) d.viewportChangePos(region.x - d._viewportLoc.x, region.y - d._viewportLoc.y);
      r._updateScale();
      r._saveExpectedClientSize();
    },
  };
}
