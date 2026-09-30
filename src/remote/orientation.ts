type Bounds = { left: number; top: number; width: number; height: number };

// The software keyboard reduces visualViewport.height; it doesn't turn the
// device. Use the layout viewport's orientation, independently of open panels.
export function workspaceOrientation(
  landscape: boolean,
  devicePortrait: boolean,
  width: number,
  height: number,
) {
  const rotated = landscape && devicePortrait;
  const logicalWidth = rotated ? height : width;
  const logicalHeight = rotated ? width : height;
  return { rotated, logicalWidth, logicalHeight, wide: logicalWidth >= 560 };
}

const clamp = (v: number, size: number) => (v < 0 ? 0 : v >= size ? Math.max(0, size - 1) : v);

// Input to a clockwise-rotated element is still expressed in window axes.
// Return unscaled element-local coordinates; noVNC adds its scale/crop offset.
export function pointInDesktop(x: number, y: number, bounds: Bounds, rotated: boolean) {
  return rotated
    ? {
        x: clamp(y - bounds.top, bounds.height),
        y: clamp(bounds.left + bounds.width - x, bounds.width),
      }
    : { x: clamp(x - bounds.left, bounds.width), y: clamp(y - bounds.top, bounds.height) };
}

export function desktopDelta(x: number, y: number, rotated: boolean) {
  return rotated ? { x: y, y: -x } : { x, y };
}

export function isRotated(element: Element) {
  return Boolean(element.closest('[data-desktop-rotation="clockwise"]'));
}

// These exports are imported only by the guarded noVNC build adapter.
export function clientToElement(x: number, y: number, element: Element) {
  return pointInDesktop(x, y, element.getBoundingClientRect(), isRotated(element));
}
export function desktopWheel(x: number, y: number, element: Element) {
  return desktopDelta(x, y, isRotated(element));
}
export function desktopGesture(event: CustomEvent, element: Element) {
  if (!isRotated(element) || event.detail.type !== 'twodrag') return event;
  const delta = desktopDelta(event.detail.magnitudeX, event.detail.magnitudeY, true);
  return new CustomEvent(event.type, {
    detail: { ...event.detail, magnitudeX: delta.x, magnitudeY: delta.y },
  });
}
export function desktopSize(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  return isRotated(element)
    ? { w: bounds.height, h: bounds.width }
    : { w: bounds.width, h: bounds.height };
}
