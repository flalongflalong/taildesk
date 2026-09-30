import { fileURLToPath } from 'node:url';

// Scope this adapter to the pinned noVNC 1.7.0 RFB module. Fail at build time
// when upstream changes, instead of silently shipping incorrect input mapping.
// Upstream RFB source retains its MPL-2.0 copyright/license header.
export function novncOrientation() {
  const helper = fileURLToPath(new URL('../src/remote/orientation.ts', import.meta.url));
  return {
    name: 'taildesk-novnc-orientation',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/@novnc/novnc/core/rfb.js')) return;
      const changes = [
        [
          "import { clientToElement } from './util/element.js';",
          `import { clientToElement, desktopWheel, desktopGesture, desktopSize } from ${JSON.stringify(helper)};`,
        ],
        [
          'let r = this._screen.getBoundingClientRect();\n        return { w: r.width, h: r.height };',
          'return desktopSize(this._screen);',
        ],
        [
          'let dX = ev.deltaX;\n        let dY = ev.deltaY;',
          'let { x: dX, y: dY } = desktopWheel(ev.deltaX, ev.deltaY, this._canvas);',
        ],
        [
          '_handleGesture(ev) {\n        let magnitude;',
          '_handleGesture(ev) {\n        ev = desktopGesture(ev, this._canvas);\n        let magnitude;',
        ],
      ];
      for (const [before, after] of changes) {
        if (code.split(before).length !== 2)
          throw new Error(
            'noVNC orientation adapter: upstream changed; revalidate the pinned integration.',
          );
        code = code.replace(before, after);
      }
      return { code, map: null };
    },
  };
}
