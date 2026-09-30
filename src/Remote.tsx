import { useEffect, useRef, useState, type FormEvent } from 'react';
import RFB from '@novnc/novnc';
import {
  ArrowLeft,
  ArrowRight,
  ChevronUp,
  ChevronDown,
  RotateCw,
  ClipboardPaste,
  Crosshair,
  Expand,
  Eye,
  Hand,
  SlidersHorizontal,
  Maximize2,
  Monitor,
  MousePointer2,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { api, errorText, type Device } from './api';
import { Modal, Spinner } from './components';
import { sendChord, textKeysyms, type Modifier } from './remote/controls';
import { DisplayPicker } from './remote/DisplayPicker';
import { KeyboardPanel } from './remote/KeyboardPanel';
import { readPreferences, regionsFor, type Layout } from './remote/displays';
import { installDisplayViewport } from './remote/viewport';
import {
  QUALITY,
  readQuality,
  recoveryPlan,
  watchConnectionNetwork,
  closeDescription,
} from './remote/connection';
import { ConnectionSettings } from './remote/ConnectionSettings';
import { installPointer } from './remote/pointer';
import { QuickControls } from './remote/QuickControls';
import { TypingKeyboard } from './remote/TypingKeyboard';
import { workspaceOrientation } from './remote/orientation';
import { InputPanelHeader, type InputMode } from './remote/InputPanelHeader';

type State = 'connecting' | 'credentials' | 'connected' | 'disconnected' | 'retrying' | 'error';
const labels: Record<State, string> = {
  connecting: '正在连接',
  credentials: '等待验证',
  connected: '已连接',
  disconnected: '已断开',
  retrying: '正在重连',
  error: '连接失败',
};

export default function Remote({ device, onClose }: { device: Device; onClose: () => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const pointer = useRef<ReturnType<typeof installPointer> | null>(null);
  const cursorMarker = useRef<HTMLDivElement>(null);
  const [mouseTools, setMouseTools] = useState(true);
  const [state, setState] = useState<State>('connecting');
  const [message, setMessage] = useState('正在建立私有连接…');
  const [lastFailure, setLastFailure] = useState('');
  const [attempt, setAttempt] = useState(0);
  const retries = useRef(0);
  const stateRef = useRef<State>('connecting');
  const [fit, setFit] = useState(true);
  const [landscape, setLandscape] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(true);
  const [controlsOverlay, setControlsOverlay] = useState(true);
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
    portrait: window.innerWidth < window.innerHeight,
  });
  const [pan, setPan] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  const [quality, setQuality] = useState(readQuality);
  const [inputOpen, setInputOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [typingOpen, setTypingOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [displaysOpen, setDisplaysOpen] = useState(false);
  const [modifiers, setModifiers] = useState<Modifier[]>([]);
  const [layout, setLayout] = useState<Layout>({ width: 0, height: 0, screens: [] });
  const [displayPreferences, setDisplayPreferences] = useState(() => readPreferences(device.id));
  const displayViewport = useRef<ReturnType<typeof installDisplayViewport> | null>(null);
  const screens = regionsFor(displayPreferences, layout);
  const selectedDisplay = screens.find((s) => s.id === displayPreferences.selected) || null;
  const [text, setText] = useState('');
  const [inputHint, setInputHint] = useState('');
  const [credentials, setCredentials] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [target, setTarget] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [help, setHelp] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const armDeadline = useRef<(() => void) | null>(null);
  stateRef.current = state;
  const { rotated } = workspaceOrientation(
    landscape,
    windowSize.portrait,
    windowSize.width,
    windowSize.height,
  );
  const compactLandscape = rotated || !windowSize.portrait;
  const controlsVisible = !controlsCollapsed;
  const panelOpen = typingOpen || keysOpen || inputOpen;

  function paintPointer() {
    const controller = pointer.current;
    const marker = cursorMarker.current;
    const host = viewport.current;
    if (!controller || !marker || !host) return;
    const { position, frame } = controller.snapshot();
    const shown =
      stateRef.current === 'connected' &&
      position &&
      frame.scale > 0 &&
      position.x >= frame.x &&
      position.y >= frame.y &&
      position.x < frame.x + frame.w &&
      position.y < frame.y + frame.h;
    marker.hidden = !shown;
    if (!shown || !position) return;
    const canvas = controller.canvas.getBoundingClientRect();
    const area = host.getBoundingClientRect();
    const turned = Boolean(host.closest('[data-desktop-rotation="clockwise"]'));
    const left = turned ? canvas.top - area.top : canvas.left - area.left;
    const top = turned ? area.right - canvas.right : canvas.top - area.top;
    marker.style.left = `${left + (position.x - frame.x) * frame.scale}px`;
    marker.style.top = `${top + (position.y - frame.y) * frame.scale}px`;
  }

  useEffect(() => {
    let disposed = false;
    let client: RFB | null = null;
    let channel: WebSocket | null = null;
    let closeMessage = '连接中断。';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let handshake: ReturnType<typeof setTimeout> | undefined;
    let authenticationFailed = false;
    let terminated = false;
    let recovering = false;
    const controller = new AbortController();
    let preflight: ReturnType<typeof setTimeout> | undefined;
    setState('connecting');
    setLayout({ width: 0, height: 0, screens: [] });
    setModifiers([]);
    setMessage('正在建立私有连接…');
    setCredentials([]);
    setPassword('');
    setFingerprint('');
    const recover = (reason: string) => {
      if (disposed || authenticationFailed || recovering) return;
      recovering = true;
      clearTimeout(handshake);
      clearTimeout(timer);
      setCredentials([]);
      setPassword('');
      setFingerprint('');
      if (reason) setLastFailure(reason);
      const plan = recoveryPlan(retries.current, navigator.onLine, !document.hidden);
      setState(plan.delay === null ? 'disconnected' : 'retrying');
      setMessage(`${reason} ${plan.message}`);
      if (plan.delay !== null) {
        retries.current++;
        timer = setTimeout(() => {
          if (disposed) return;
          const current = recoveryPlan(retries.current, navigator.onLine, !document.hidden);
          if (current.delay === null) {
            setState('disconnected');
            setMessage(current.message);
          } else setAttempt((v) => v + 1);
        }, plan.delay);
      }
    };
    const timeout = () => {
      clearTimeout(handshake);
      handshake = setTimeout(() => {
        if (disposed) return;
        recover('连接超时，请确认电脑已唤醒、屏幕共享和 Tailscale 已开启。');
        client?.disconnect();
      }, 25000);
    };
    armDeadline.current = timeout;
    async function start() {
      try {
        if (document.hidden) {
          recover('');
          return;
        }
        preflight = setTimeout(() => controller.abort(), 10000);
        const session = await api<{ authenticated: boolean }>(
          '/session',
          'GET',
          undefined,
          controller.signal,
        );
        clearTimeout(preflight);
        if (disposed) return;
        if (!session.authenticated) {
          window.dispatchEvent(new Event('session-expired'));
          return;
        }
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        channel = new WebSocket(`${protocol}//${window.location.host}/ws/${device.id}`);
        channel.addEventListener('close', (event) => {
          closeMessage = closeDescription(event.code, event.reason);
        });
        client = new RFB(viewport.current!, channel);
        rfb.current = client;
        displayViewport.current = installDisplayViewport(client, (next) => {
          if (!disposed) setLayout(next);
        });
        pointer.current = installPointer(client, paintPointer);
        client.scaleViewport = fit;
        client.clipViewport = !fit;
        client.dragViewport = pan && !fit;
        client.viewOnly = viewOnly;
        client.qualityLevel = QUALITY[quality].quality;
        client.compressionLevel = QUALITY[quality].compression;
        client.resizeSession = false;
        client.addEventListener('connect', () => {
          if (disposed || recovering) return;
          clearTimeout(handshake);
          setState('connected');
          setMessage('');
          setCredentials([]);
          setPassword('');
          setUsername('');
          setTarget('');
          timer = setTimeout(() => {
            retries.current = 0;
          }, 15000);
        });
        client.addEventListener('credentialsrequired', (e) => {
          if (disposed || recovering) return;
          clearTimeout(handshake);
          setCredentials((e as CustomEvent<{ types: string[] }>).detail.types);
          setState('credentials');
          setMessage('请输入目标电脑的 VNC 凭据');
        });
        client.addEventListener('securityfailure', () => {
          if (disposed || recovering) return;
          authenticationFailed = true;
          clearTimeout(handshake);
          setCredentials([]);
          setPassword('');
          setState('error');
          setMessage('VNC 验证失败。请确认使用屏幕共享设置中的 VNC 密码，再重新连接。');
        });
        client.addEventListener('serververification', async (e) => {
          if (disposed || recovering) return;
          clearTimeout(handshake);
          const detail = (e as CustomEvent<{ type: string; publickey: Uint8Array }>).detail;
          if (detail.type !== 'RSA' || !crypto.subtle) {
            authenticationFailed = true;
            setState('error');
            setMessage('当前连接需要验证服务器身份，请通过 HTTPS 访问网关。');
            client?.disconnect();
            return;
          }
          const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(detail.publickey));
          if (!disposed && !recovering)
            setFingerprint(
              Array.from(new Uint8Array(digest))
                .map((v) => v.toString(16).padStart(2, '0'))
                .join(':'),
            );
        });
        client.addEventListener('disconnect', () => {
          if (disposed) return;
          terminated = true;
          if (rfb.current === client) rfb.current = null;
          recover(closeMessage);
        });
        timeout();
      } catch (e) {
        clearTimeout(preflight);
        recover(controller.signal.aborted ? '网关响应超时。' : errorText(e));
        client?.disconnect();
      }
    }
    void start();
    return () => {
      disposed = true;
      pointer.current?.dispose();
      pointer.current = null;
      controller.abort();
      clearTimeout(preflight);
      clearTimeout(timer);
      clearTimeout(handshake);
      if (!terminated) client?.disconnect();
      if (channel && channel.readyState < WebSocket.CLOSING) channel.close();
      if (rfb.current === client) rfb.current = null;
      armDeadline.current = null;
      displayViewport.current = null;
    };
    // Each attempt owns one RFB instance; presentation controls are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id, attempt]);

  useEffect(() => {
    if (rfb.current) {
      if (viewOnly || pan) pointer.current?.release();
      rfb.current.scaleViewport = fit;
      rfb.current.clipViewport = !fit;
      rfb.current.dragViewport = pan && !fit;
      rfb.current.viewOnly = viewOnly;
    }
  }, [fit, pan, viewOnly, state]);
  useEffect(() => {
    const canvas = pointer.current?.canvas;
    const host = viewport.current;
    if (!canvas || !host) return;
    const observer = new ResizeObserver(paintPointer);
    observer.observe(canvas);
    observer.observe(host);
    const frame = requestAnimationFrame(paintPointer);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [state, rotated, fit, layout, selectedDisplay, controlsCollapsed, panelOpen]);
  useEffect(() => {
    if (rfb.current) {
      rfb.current.qualityLevel = QUALITY[quality].quality;
      rfb.current.compressionLevel = QUALITY[quality].compression;
    }
    try {
      localStorage.setItem('taildesk.quality', quality);
    } catch {
      /* Optional preference. */
    }
  }, [quality, state]);
  useEffect(() => {
    displayViewport.current?.select(selectedDisplay);
    if (state === 'connected' && !viewOnly && !pointer.current?.snapshot().position)
      pointer.current?.center();
  }, [displayPreferences, layout, fit, state, viewOnly]);
  useEffect(() => {
    try {
      localStorage.setItem(`taildesk.displays.${device.id}`, JSON.stringify(displayPreferences));
    } catch {
      /* Private browsing may disable storage. The current session still works. */
    }
  }, [device.id, displayPreferences]);
  useEffect(() => {
    if (viewOnly || state !== 'connected') setModifiers([]);
  }, [viewOnly, state]);
  useEffect(() => {
    const v = window.visualViewport;
    const resize = () => {
      const size = {
        width: v?.width || window.innerWidth,
        height: v?.height || window.innerHeight,
        portrait: window.innerWidth < window.innerHeight,
      };
      setWindowSize(size);
      const style = document.documentElement.style;
      style.setProperty('--remote-height', `${size.height}px`);
      style.setProperty('--remote-width', `${size.width}px`);
      style.setProperty('--remote-top', `${v?.offsetTop || 0}px`);
      style.setProperty('--remote-left', `${v?.offsetLeft || 0}px`);
    };
    resize();
    v?.addEventListener('resize', resize);
    v?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);
    return () => {
      v?.removeEventListener('resize', resize);
      v?.removeEventListener('scroll', resize);
      window.removeEventListener('resize', resize);
      for (const name of ['height', 'width', 'top', 'left'])
        document.documentElement.style.removeProperty(`--remote-${name}`);
    };
  }, []);
  useEffect(
    () =>
      watchConnectionNetwork(
        window,
        document,
        () => ({ state: stateRef.current, hidden: document.hidden }),
        () => setAttempt((a) => a + 1),
      ),
    [],
  );

  function toggleLandscape() {
    pointer.current?.release();
    setLandscape((v) => !v);
    setOptionsOpen(false);
    setModifiers([]);
    rfb.current?.blur();
  }
  function openPanel(panel: InputMode | null) {
    pointer.current?.release();
    rfb.current?.blur();
    setTypingOpen(panel === 'typing');
    setKeysOpen(panel === 'keys');
    setInputOpen(panel === 'text');
    setOptionsOpen(false);
    if (panel === null) setModifiers([]);
  }
  function toggleControls() {
    openPanel(null);
    setControlsCollapsed((value) => !value);
  }
  function modifier(m: Modifier) {
    setModifiers((ms) => (ms.includes(m) ? ms.filter((v) => v !== m) : [...ms, m]));
  }
  function reconnect() {
    retries.current = 0;
    setAttempt((a) => a + 1);
  }
  function sendCredentials(e: FormEvent) {
    e.preventDefault();
    rfb.current?.sendCredentials({ username, password, target });
    armDeadline.current?.();
    setPassword('');
    setCredentials([]);
    setState('connecting');
    setMessage('正在验证凭据…');
  }
  function key(keysym: number, explicitModifiers?: Modifier[]) {
    if (state !== 'connected' || viewOnly || !rfb.current) return;
    sendChord(rfb.current, keysym, explicitModifiers ?? modifiers);
    setModifiers([]);
    if (!inputOpen) rfb.current.focus();
  }
  function sendText() {
    if (state !== 'connected' || viewOnly || !rfb.current) return;
    const keys = textKeysyms(text);
    if (modifiers.length && keys.length !== 1) {
      setInputHint('组合键模式下只能发送一个字符。关闭文字输入可取消组合。');
      return;
    }
    for (const value of keys) sendChord(rfb.current, value, modifiers);
    setModifiers([]);
    setText('');
    setInputHint('文字已发送。中文能否正确输入取决于目标 VNC 服务与输入法。');
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
      else setFullscreenError('此浏览器不支持全屏。iPhone 可横屏使用，或把网页添加到主屏幕。');
    } catch {
      setFullscreenError('浏览器未允许全屏，可使用横屏模式。');
    }
  }
  const connected = state === 'connected';
  const inputDisabled = !connected || viewOnly;
  return (
    <div
      className={`remote-page${rotated ? ' is-rotated' : ''}${compactLandscape ? ' is-landscape' : ''}${panelOpen ? ' has-input-panel' : ''}${controlsOverlay ? ' controls-overlay' : ''}`}
      data-desktop-rotation={rotated ? 'clockwise' : undefined}
    >
      <header className="remote-header">
        <button className="icon-button" onClick={onClose} aria-label="返回设备列表">
          <ArrowLeft size={21} />
        </button>
        <div className="remote-name">
          <b>{device.name}</b>
          <span>{device.host}</span>
        </div>
        <span className={`remote-state ${connected ? 'is-connected' : ''}`} role="status">
          <span className="status-dot" />
          {labels[state]}
        </span>
        <div className="remote-header-actions">
          <button
            aria-pressed={pan}
            title="平移：拖动查看画面，开启时切到原尺寸"
            onClick={() => {
              pointer.current?.release();
              setPan(!pan);
              if (!pan) setFit(false);
            }}
          >
            <Hand size={18} />
            <span>平移</span>
          </button>
          <button
            aria-pressed={viewOnly}
            onClick={() => {
              pointer.current?.release();
              setViewOnly(!viewOnly);
              openPanel(null);
            }}
          >
            <Eye size={18} />
            <span>只读</span>
          </button>
          <button
            className="secondary orientation-toggle"
            aria-label={landscape ? '退出横屏' : '横屏操作'}
            aria-pressed={landscape}
            onClick={toggleLandscape}
            title={landscape ? '退出横屏' : '横屏操作'}
          >
            <RotateCw size={16} />
            <span>{landscape ? '退出横屏' : '横屏'}</span>
          </button>
          {
            <button
              className="icon-button"
              aria-label={controlsVisible ? '收起工具栏' : '展开工具栏'}
              title={controlsVisible ? '收起工具栏' : '展开工具栏'}
              aria-expanded={controlsVisible}
              onClick={toggleControls}
            >
              {controlsVisible ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
              <span>{controlsVisible ? '收起' : '操作'}</span>
            </button>
          }
          <button
            aria-pressed={optionsOpen}
            aria-label="控制设置"
            onClick={() => {
              pointer.current?.release();
              openPanel(null);
              setControlsCollapsed(false);
              setOptionsOpen(!optionsOpen);
            }}
          >
            <SlidersHorizontal size={18} />
            <span>设置</span>
          </button>
        </div>
      </header>
      <div className="remote-viewport-wrap">
        <div ref={viewport} className="remote-viewport" aria-label={`${device.name} 的远程桌面`} />
        <div ref={cursorMarker} className="remote-cursor" aria-hidden="true" hidden>
          <span className="cursor-ring" />
          <MousePointer2 size={25} fill="white" stroke="#142138" strokeWidth={1.8} />
        </div>
        {connected && (pan || viewOnly) && (
          <div className="interaction-mode-notice">
            <span role="status">
              {viewOnly ? '只读 · 不会发送鼠标和按键' : '平移 · 拖动画面查看其他位置'}
            </span>
            <button
              onClick={() => {
                pointer.current?.release();
                if (viewOnly) setViewOnly(false);
                else {
                  setPan(false);
                  setFit(true);
                }
              }}
            >
              {viewOnly ? '恢复控制' : '恢复适应'}
            </button>
          </div>
        )}
        {connected && !controlsVisible && (
          <button className="controls-launcher" onClick={toggleControls} aria-label="展开操作">
            <MousePointer2 size={17} /> 操作 <ChevronUp size={16} />
          </button>
        )}
        {!connected && (
          <div className="remote-overlay">
            <div className="remote-status-card">
              {['connecting', 'retrying'].includes(state) ? <Spinner /> : <Monitor size={34} />}
              <h2>{labels[state]}</h2>
              <p>{message}</p>
              {lastFailure && state === 'connecting' && <p>上次中断：{lastFailure}</p>}
              {['error', 'disconnected', 'retrying'].includes(state) && (
                <button className="primary" onClick={reconnect}>
                  <RefreshCw size={17} />
                  立即重连
                </button>
              )}
              <button className="text-button" onClick={onClose}>
                返回设备列表
              </button>
            </div>
          </div>
        )}
      </div>
      {typingOpen && controlsVisible && (
        <TypingKeyboard
          mac={device.platform === 'mac'}
          disabled={inputDisabled}
          modifiers={modifiers}
          onModifier={modifier}
          onKey={key}
          onMode={openPanel}
          onClose={() => openPanel(null)}
        />
      )}
      {keysOpen && controlsVisible && (
        <KeyboardPanel
          mac={device.platform === 'mac'}
          disabled={inputDisabled}
          modifiers={modifiers}
          onModifier={modifier}
          onKey={key}
          onMode={openPanel}
          onClose={() => openPanel(null)}
        />
      )}
      {controlsVisible && !panelOpen && (
        <div className={`remote-controls${optionsOpen ? '' : ' is-game-controls'}`}>
          {optionsOpen && (
            <section className="remote-settings" aria-label="控制设置面板">
              <div className="settings-heading">
                <b>控制设置</b>
                <button
                  className="icon-button"
                  aria-label="关闭控制设置"
                  onClick={() => setOptionsOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="control-options">
                <button
                  aria-pressed={mouseTools}
                  onClick={() => {
                    pointer.current?.release();
                    setMouseTools(!mouseTools);
                  }}
                >
                  <MousePointer2 size={18} />
                  <span>鼠标</span>
                </button>
                <button
                  disabled={!connected || !layout.width}
                  aria-label="选择屏幕"
                  onClick={() => setDisplaysOpen(true)}
                >
                  <Monitor size={18} />
                  <span>{selectedDisplay ? selectedDisplay.name : '屏幕'}</span>
                </button>
                <button
                  aria-pressed={fit}
                  onClick={() => {
                    pointer.current?.release();
                    setFit(!fit);
                    setPan(false);
                  }}
                >
                  <Expand size={18} />
                  <span>适应</span>
                </button>
                <button disabled={inputDisabled || pan} onClick={() => pointer.current?.center()}>
                  <Crosshair size={16} />
                  定位鼠标
                </button>
                <button onClick={fullscreen}>
                  <Maximize2 size={16} />
                  全屏
                </button>

                <button onClick={reconnect}>
                  <RefreshCw size={16} />
                  重连
                </button>
                <button onClick={() => setHelp(true)}>
                  <MousePointer2 size={16} />
                  触控说明
                </button>
              </div>
              <ConnectionSettings quality={quality} onQuality={setQuality} />
              {lastFailure && <p className="connection-last-failure">上次中断：{lastFailure}</p>}
            </section>
          )}
          {modifiers.length > 0 && (
            <div className="chord-status" role="status">
              {modifiers
                .map((m) => ({ meta: '⌘', ctrl: 'Ctrl', alt: '⌥', shift: '⇧' })[m])
                .join(' + ')}{' '}
              + 下一次按键<button onClick={() => setModifiers([])}>取消组合</button>
            </div>
          )}
          {!optionsOpen && (
            <QuickControls
              disabled={inputDisabled}
              pan={pan}
              rotated={rotated}
              mouseTools={mouseTools}
              overlay={controlsOverlay}
              onPlacement={() => {
                pointer.current?.release();
                setControlsOverlay((value) => !value);
              }}
              onKey={key}
              onTyping={() => openPanel('typing')}
              onText={() => openPanel('text')}
              onMore={() => openPanel('keys')}
              move={(x, y) => pointer.current?.move(x, y)}
              button={(mask, down) => pointer.current?.button(mask, down)}
              release={() => pointer.current?.release()}
            />
          )}
        </div>
      )}
      {displaysOpen && (
        <DisplayPicker
          layout={layout}
          preferences={displayPreferences}
          onChange={setDisplayPreferences}
          onClose={() => setDisplaysOpen(false)}
        />
      )}
      {inputOpen && (
        <section className="text-panel" aria-label="文字输入面板">
          <InputPanelHeader mode="text" onMode={openPanel} onClose={() => openPanel(null)} />
          <textarea
            id="remote-text"
            aria-label="发送文字"
            placeholder="使用手机键盘输入，再发送到远程电脑…"
            value={text}
            maxLength={2000}
            autoFocus={!rotated}
            onChange={(e) => setText(e.target.value)}
          />
          <div className={`text-panel-actions${inputHint || rotated ? ' has-feedback' : ''}`}>
            <span role="status">
              {inputHint ||
                (rotated
                  ? '系统键盘横屏：关闭竖屏锁定并横拿手机。'
                  : '输入后点发送；中文不兼容时，可同步剪贴板再到电脑粘贴。')}
            </span>
            <button
              className="secondary"
              disabled={!connected || viewOnly || !text}
              onClick={() => {
                rfb.current?.clipboardPasteFrom(text);
                setInputHint('已发送剪贴板同步请求；需要目标 VNC 服务支持。请在远端按粘贴快捷键。');
              }}
            >
              <ClipboardPaste size={15} />
              同步剪贴板
            </button>
            <button
              className="primary"
              disabled={!connected || viewOnly || !text}
              onClick={sendText}
            >
              <Send size={15} />
              发送
            </button>
          </div>
        </section>
      )}
      {credentials.length > 0 && (
        <Modal title={`验证 ${device.name}`} onClose={onClose}>
          <p className="modal-copy">输入电脑的 VNC 凭据。密码仅用于本次连接，不会保存。</p>
          <form onSubmit={sendCredentials}>
            {credentials.includes('username') && (
              <>
                <label htmlFor="vnc-user">用户名</label>
                <input
                  id="vnc-user"
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </>
            )}
            {credentials.includes('target') && (
              <>
                <label htmlFor="vnc-target">目标会话</label>
                <input
                  id="vnc-target"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  required
                />
              </>
            )}
            {credentials.includes('password') && (
              <>
                <label htmlFor="vnc-password">VNC 密码</label>
                <input
                  id="vnc-password"
                  type="password"
                  autoComplete="off"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  maxLength={256}
                />
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={onClose}>
                取消
              </button>
              <button className="primary">
                验证并连接 <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </Modal>
      )}
      {fingerprint && (
        <Modal title="确认服务器身份" onClose={onClose}>
          <p className="modal-copy">请与目标电脑提供的 RSA 公钥 SHA-256 指纹核对，一致后再继续。</p>
          <code className="fingerprint">{fingerprint}</code>
          <div className="modal-actions">
            <button className="secondary" onClick={onClose}>
              取消
            </button>
            <button
              className="primary"
              onClick={() => {
                rfb.current?.approveServer();
                armDeadline.current?.();
                setFingerprint('');
              }}
            >
              指纹一致，继续
            </button>
          </div>
        </Modal>
      )}
      {help && (
        <Modal title="手机操作指南" onClose={() => setHelp(false)}>
          <ul className="touch-guide">
            <li>顶部「横屏」切换横向操作，再点「退出横屏」恢复。手机自然转向也会自动适配。</li>
            <li>
              左下大摇杆推得越远移动越快；设置中的「定位鼠标」回到画面中央。按住左键并推摇杆可拖拽。
            </li>
            <li>白色指针显示本页面最后操控的位置；电脑本地鼠标移动可能不会同步回页面。</li>
            <li>
              右侧固定「键盘」「悬浮 / 底置」「退格」和
              Enter；输入面板可直接切换文字输入、屏幕键盘、快捷键。
            </li>
            <li>
              iPhone
              系统键盘跟随手机方向。使用横屏输入法，请关闭竖屏锁定并横拿手机；页面不能单独旋转系统键盘。
            </li>
            <li>
              操作栏默认收起，点顶部「操作」展开；按键左右滑动查看更多，右侧「悬浮 /
              底置」仅切换底部按键行的位置，左右控制始终悬浮在桌面上。打开键盘和输入时保持页面方向。
            </li>
            <li>单指轻点：点击；单指按下后移动：拖拽。</li>
            <li>双指轻点或单指长按：右键；双指滑动：滚动。</li>
            <li>顶部点亮「平移」即可拖动查看原尺寸画面；在设置中点亮「适应」回到完整视图。</li>
            <li>「屏幕」可单独查看某块屏幕；未自动识别时选择左右、上下或自定义区域。</li>
            <li>Enter、退格、方向键和上页/下页在底部；「更多键」包含修饰键、编辑、导航和 F 键。</li>
            <li>
              先点 Command / Shift
              等修饰键，再点方向键或发送一个字母，组合完成后自动释放。组合仅用于页面上的按键。
            </li>
            <li>外接键盘可直接操作远程桌面；只读时鼠标与按键都不会发送到电脑。</li>
            <li>锁屏或切换网络可能断开连接，返回后会尝试恢复，也可手动重连。</li>
          </ul>
          <div className="guide-tip">
            <ShieldCheck size={18} />
            <p>关闭页面或点「断开」会结束本次连接。远程控制覆盖整张桌面。</p>
          </div>
        </Modal>
      )}
      {fullscreenError && (
        <Modal title="全屏提示" onClose={() => setFullscreenError('')}>
          <p className="modal-copy">{fullscreenError}</p>
        </Modal>
      )}
    </div>
  );
}
