import test from 'node:test';
import assert from 'node:assert/strict';
import { sendChord, textKeysyms, KEY } from '../src/remote/controls.ts';
import { decodeScreens, regionsFor, defaultPreferences, validRegion } from '../src/remote/displays.ts';
import { pointInDesktop, desktopDelta, desktopGesture, desktopSize } from '../src/remote/orientation.ts';
import { novncOrientation } from '../scripts/novnc-orientation.mjs';
import { readFileSync } from 'node:fs';
import { installPointer, joystickVelocity } from '../src/remote/pointer.ts';
import { workspaceOrientation } from '../src/remote/orientation.ts';

test('Command Shift Z presses modifiers once, then releases in reverse order', () => {
  const events = [];
  sendChord({ sendKey: (...event) => events.push(event) }, 122, ['meta', 'shift', 'meta']);
  assert.deepEqual(events, [[65515, 'MetaLeft', true], [65505, 'ShiftLeft', true], [122],
    [65505, 'ShiftLeft', false], [65515, 'MetaLeft', false]]);
});
test('modifiers release even if sending the main key fails', () => {
  const releases = [];
  assert.throws(() => sendChord({ sendKey: (key, code, down) => {
    if (down === undefined) throw new Error('transport closed');
    if (!down) releases.push(code);
  } }, KEY.enter, ['ctrl', 'alt']), /transport/);
  assert.deepEqual(releases, ['AltLeft', 'ControlLeft']);
});
test('mobile text handles Chinese, astral Unicode, Windows line endings and Tab', () => {
  assert.deepEqual(textKeysyms('你😀\r\nA\t'), [0x01004f60, 0x0101f600, 0xff0d, 65, 0xff09]);
});
const layout = { width: 640, height: 400, screens: [] };
test('ExtendedDesktopSize preserves unequal screen sizes, IDs and vertical offset', () => {
  const wire = Uint8Array.from(Buffer.from('020000000000000b0000000000f00190000000000000001600f0003c0190015400000000', 'hex'));
  assert.deepEqual(decodeScreens(wire, layout), [
    { id: 'server-11', name: '屏幕 1', x: 0, y: 0, width: 240, height: 400 },
    { id: 'server-22', name: '屏幕 2', x: 240, y: 60, width: 400, height: 340 },
  ]);
  assert.deepEqual(decodeScreens(wire.subarray(0, 20), layout), []);
  // Malformed out-of-bounds monitors cannot become selectable regions.
  assert.equal(decodeScreens(wire, { width: 300, height: 400 }).length, 1);
});
test('manual two-monitor calibration uses requested ratio, with no pixel gap', () => {
  const screens = regionsFor({ ...defaultPreferences, mode: 'horizontal', split: 37.5 }, layout);
  assert.deepEqual(screens.map(({x, y, width, height}) => [x, y, width, height]), [[0, 0, 240, 400], [240, 0, 400, 400]]);
  const vertical = regionsFor({ ...defaultPreferences, mode: 'vertical', count: 3 }, layout);
  assert.deepEqual(vertical.map(({y, height}) => [y, height]), [[0, 133], [133, 134], [267, 133]]);
});
test('custom calibration invalidates on framebuffer resolution changes', () => {
  const custom = [{ id: 'one', name: 'External', x: 240, y: 60, width: 400, height: 340 }];
  const preferences = { ...defaultPreferences, mode: 'custom', custom, customSize: layout };
  assert.deepEqual(regionsFor(preferences, layout), custom);
  assert.deepEqual(regionsFor(preferences, { ...layout, width: 800 }), []);
  assert.equal(validRegion({ ...custom[0], x: -1 }, layout), false);
  assert.equal(validRegion({ ...custom[0], width: 0 }, layout), false);
  assert.equal(validRegion({ ...custom[0], y: NaN }, layout), false);
});

test('clockwise desktop maps off-center points and clamps drags beyond all four edges', () => {
  // A 640x400 canvas displayed at 50% scale then rotated, inside a viewport.
  const bounds = { left: 50, top: 100, width: 200, height: 320 };
  assert.deepEqual(pointInDesktop(200, 180, bounds, true), { x: 80, y: 50 });
  assert.deepEqual(pointInDesktop(250, 100, bounds, true), { x: 0, y: 0 });
  assert.deepEqual(pointInDesktop(-100, 900, bounds, true), { x: 319, y: 199 });
  assert.deepEqual(pointInDesktop(500, -10, bounds, true), { x: 0, y: 0 });
});
test('normal desktop preserves fractional positions, and directions rotate exactly once', () => {
  assert.deepEqual(pointInDesktop(109.9, 29.5, { left: 10, top: 20, width: 100, height: 10 }, false), { x: 99.9, y: 9.5 });
  assert.deepEqual(desktopDelta(80, 0, true), { x: 0, y: -80 });
  assert.deepEqual(desktopDelta(0, 90, true), { x: 90, y: -0 });
  assert.deepEqual(desktopDelta(20, 30, false), { x: 20, y: 30 });
});
test('two-finger scroll follows rotated desktop axes while tap and pinch keep their data', () => {
  const element = { closest: () => ({}) };
  const scroll = new CustomEvent('gesturemove', { detail: { type: 'twodrag', clientX: 210, clientY: 330, magnitudeX: -70, magnitudeY: 20 } });
  assert.deepEqual(desktopGesture(scroll, element).detail,
    { type: 'twodrag', clientX: 210, clientY: 330, magnitudeX: 20, magnitudeY: 70 });
  const pinch = new CustomEvent('gesturemove', { detail: { type: 'pinch', magnitudeX: 50, magnitudeY: 80 } });
  assert.equal(desktopGesture(pinch, element), pinch);
  assert.equal(desktopGesture(scroll, { closest: () => null }), scroll);
});
test('rotated display uses logical width and height for fit and clipping', () => {
  const element = { closest: () => ({}), getBoundingClientRect: () => ({ width: 300, height: 800 }) };
  assert.deepEqual(desktopSize(element), { w: 800, h: 300 });
  assert.deepEqual(desktopSize({ ...element, closest: () => null }), { w: 300, h: 800 });
});
test('noVNC adapter is scoped to the pinned upstream and fails closed on source drift', () => {
  const code = readFileSync(new URL('../node_modules/@novnc/novnc/core/rfb.js', import.meta.url), 'utf8');
  const plugin = novncOrientation();
  assert.ok(plugin.transform(code, '/node_modules/@novnc/novnc/core/rfb.js').code.includes('return desktopSize(this._screen)'));
  assert.equal(plugin.transform(code, '/src/rfb.js'), undefined);
  assert.throws(() => plugin.transform(code.replace('_handleGesture(ev)', '_changedGesture(ev)'), '/node_modules/@novnc/novnc/core/rfb.js'), /upstream changed/);
});

// Recovery expectations are based on user-visible outages: a fourth failure
// must still recover, and retries must never run while offline/backgrounded.
import { recoveryPlan, watchConnectionNetwork, closeDescription } from '../src/remote/connection.ts';
import { api } from '../src/api.ts';

test('extended outages keep retrying at a bounded rate', () => {
  assert.equal(recoveryPlan(0, true, true).delay, 2000);
  assert.equal(recoveryPlan(3, true, true).delay, 15000);
  assert.equal(recoveryPlan(99, true, true).delay, 30000);
  assert.equal(recoveryPlan(99, false, true).delay, 30000);
  assert.equal(recoveryPlan(1, true, false).delay, null);
});
test('gateway preflight can be cancelled without sending a stale connection', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let options;
  globalThis.fetch = (_url, init) => {
    options = init;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  };
  try {
    const request = api('/session', 'GET', undefined, controller.signal);
    controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
  } finally { globalThis.fetch = original; }
});

test('connectivity hints never kill a working connection, but online resumes a broken one', () => {
  const network = new EventTarget(), page = new EventTarget();
  let state = 'connected', hidden = false, resumed = 0;
  const stop = watchConnectionNetwork(network, page, () => ({ state, hidden }), () => resumed++);
  network.dispatchEvent(new Event('offline'));
  network.dispatchEvent(new Event('online'));
  assert.equal(resumed, 0);
  state = 'retrying';
  network.dispatchEvent(new Event('online'));
  assert.equal(resumed, 1);
  hidden = true;
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(resumed, 1);
  hidden = false;
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(resumed, 2);
  stop();
  network.dispatchEvent(new Event('online'));
  assert.equal(resumed, 2);
});
test('close diagnostics expose only fixed descriptions, never an arbitrary upstream string', () => {
  assert.match(closeDescription(1011, 'Taildesk:bridge_timeout'), /传输等待超时/);
  assert.match(closeDescription(1006, ''), /网络连接意外中断/);
  assert.ok(!closeDescription(1011, 'secret device data').includes('secret'));
});

test('keyboard viewport shrink keeps manual landscape; physical landscape is not rotated twice', () => {
  assert.equal(workspaceOrientation(true, true, 390, 844).rotated, true);
  // A native keyboard can leave less height than width without rotating the phone.
  assert.equal(workspaceOrientation(true, true, 390, 300).rotated, true);
  assert.equal(workspaceOrientation(true, false, 844, 210).rotated, false);
  assert.equal(workspaceOrientation(false, true, 390, 300).rotated, false);
});

function mouseHarness() {
  const events = [];
  const display = {
    scale: 0.5, _viewportLoc: { x: 240, y: 60, w: 400, h: 340 },
    absX(x) { return Math.floor(x / this.scale + this._viewportLoc.x); },
    absY(y) { return Math.floor(y / this.scale + this._viewportLoc.y); },
    viewportChangePos(x, y) { this._viewportLoc.x += x; this._viewportLoc.y += y; },
  };
  const client = {
    viewOnly: false, _rfbConnectionState: 'connected', _display: display,
    _mouseMoveTimer: null, _mouseButtonMask: 0, _mousePos: {},
    _sendMouse(x, y, mask) {
      if (!this.viewOnly && this._rfbConnectionState === 'connected')
        events.push([display.absX(x), display.absY(y), mask]);
    },
  };
  const mouse = installPointer(client, () => {});
  return { client, mouse, events, display };
}
test('virtual pointer uses selected screen coordinates, scale and inclusive screen edges', () => {
  const { mouse, events } = mouseHarness();
  mouse.center();
  mouse.move(20, -15);
  mouse.button(4, true);
  mouse.button(4, false);
  mouse.move(10000, -10000);
  assert.deepEqual(events, [[440, 230, 0], [480, 200, 0], [480, 200, 4], [480, 200, 0], [639, 60, 0]]);
  mouse.dispose();
});
test('joystick drag and simultaneous buttons release once on cancellation or disposal', () => {
  const { mouse, events } = mouseHarness();
  mouse.button(1, true);
  mouse.move(5, 10);
  mouse.button(4, true);
  mouse.button(4, false);
  mouse.release();
  mouse.release();
  assert.deepEqual(events, [[440, 230, 1], [450, 250, 1], [450, 250, 5], [450, 250, 1], [450, 250, 0]]);
  mouse.button(1, true);
  mouse.dispose();
  assert.deepEqual(events.slice(-2), [[450, 250, 1], [450, 250, 0]]);
  const count = events.length;
  mouse.move(10, 10);
  assert.equal(events.length, count);
});
test('read-only/disconnected pointers send nothing; touch and joystick share last sent position', () => {
  const { client, mouse, events, display } = mouseHarness();
  client._sendMouse(30, 40, 0);
  mouse.button(1, true);
  mouse.button(1, false);
  assert.deepEqual(events, [[300, 140, 0], [300, 140, 1], [300, 140, 0]]);
  client.viewOnly = true;
  mouse.center(); mouse.move(10, 10); mouse.button(4, true);
  assert.equal(events.length, 3);
  client.viewOnly = false;
  client._rfbConnectionState = 'disconnected';
  mouse.center(); mouse.button(1, true);
  assert.equal(events.length, 3);
  client._rfbConnectionState = 'connected';
  display._viewportLoc = { x: 0, y: 0, w: 240, h: 400 };
  mouse.button(4, true); mouse.button(4, false);
  assert.deepEqual(events.slice(-2), [[120, 200, 4], [120, 200, 0]]);
  mouse.dispose();
});
test('joystick has a dead zone, bounded diagonal speed and accumulates fine movement', () => {
  assert.deepEqual(joystickVelocity(3, 4), { x: 0, y: 0 });
  assert.deepEqual(joystickVelocity(36, 0), { x: 480, y: 0 });
  const diagonal = joystickVelocity(100, -100);
  assert.ok(diagonal.x > 0 && diagonal.y < 0);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 480) < 0.001);
  const { mouse, events } = mouseHarness();
  mouse.center();
  for (let i = 0; i < 4; i++) mouse.move(0.125, 0);
  assert.deepEqual(events.at(-1), [441, 230, 0]);
  mouse.dispose();
});
