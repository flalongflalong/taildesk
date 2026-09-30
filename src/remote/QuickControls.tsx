import { useEffect, useRef } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Keyboard,
  Delete,
  CornerDownLeft,
  Languages,
  Layers2,
  MoreHorizontal,
  PanelBottom,
} from 'lucide-react';
import { KEY } from './controls';
import { desktopDelta } from './orientation';
import { MousePad } from './MousePad';

export function QuickControls({
  disabled,
  pan,
  rotated,
  mouseTools,
  overlay,
  onPlacement,
  onKey,
  onTyping,
  onText,
  onMore,
  move,
  button,
  release,
}: {
  disabled: boolean;
  pan: boolean;
  rotated: boolean;
  mouseTools: boolean;
  overlay: boolean;
  onPlacement(): void;
  onKey(keysym: number): void;
  onTyping(): void;
  onText(): void;
  onMore(): void;
  move(x: number, y: number): void;
  button(mask: 1 | 4, down: boolean): void;
  release(): void;
}) {
  const drag = useRef<{ id: number; x: number; y: number; scroll: number } | null>(null);
  const moved = useRef(false);
  useEffect(() => {
    const end = (event: PointerEvent) => {
      if (drag.current?.id === event.pointerId) drag.current = null;
    };
    const cancel = () => {
      drag.current = null;
      moved.current = true;
    };
    cancel();
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      cancel();
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, [rotated]);
  return (
    <div className={`quick-controls${mouseTools ? '' : ' without-mouse'}`} aria-label="桌面操控区">
      {mouseTools && (
        <MousePad
          disabled={disabled || pan}
          rotated={rotated}
          move={move}
          button={button}
          release={release}
        />
      )}
      <div
        className="toolbar-scroll"
        role="group"
        aria-label="左右滑动查看更多操作"
        title="左右滑动查看更多按键"
        onPointerDown={(e) => {
          if (e.button !== 0 || drag.current) return;
          moved.current = false;
          drag.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            scroll: e.currentTarget.scrollLeft,
          };
        }}
        onPointerMove={(e) => {
          const start = drag.current;
          if (!start || start.id !== e.pointerId) return;
          const delta = desktopDelta(e.clientX - start.x, e.clientY - start.y, rotated);
          if (!moved.current && Math.abs(delta.x) <= 6) return;
          moved.current = true;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.scrollLeft = start.scroll - delta.x;
        }}
        onPointerUp={(e) => {
          if (drag.current?.id === e.pointerId) drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
          moved.current = true;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onClickCapture={(e) => {
          // A swipe must never also send the key where the gesture started/ended.
          if (moved.current && e.detail !== 0) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <div className="quick-keys" aria-label="常用远程按键">
          {[
            { name: 'Esc', value: KEY.escape, label: 'Esc' },
            { name: 'Tab', value: KEY.tab, label: 'Tab' },
            { name: '方向左', value: KEY.left, label: <ArrowLeft size={17} /> },
            { name: '方向上', value: KEY.up, label: <ArrowUp size={17} /> },
            { name: '方向下', value: KEY.down, label: <ArrowDown size={17} /> },
            { name: '方向右', value: KEY.right, label: <ArrowRight size={17} /> },
            { name: '上页', value: KEY.pageUp, label: '上页' },
            { name: '下页', value: KEY.pageDown, label: '下页' },
          ].map((k) => (
            <button
              key={k.value}
              disabled={disabled}
              aria-label={k.name}
              title={k.name}
              onClick={() => onKey(k.value)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <button className="toolbar-action" disabled={disabled} onClick={onText}>
          <Languages size={17} />
          <span>文字</span>
        </button>
        <button className="toolbar-action" onClick={onMore}>
          <MoreHorizontal size={17} />
          <span>更多键</span>
        </button>
      </div>
      <div className="toolbar-fixed-actions" role="group" aria-label="右侧快捷操作">
        <button className="toolbar-action" disabled={disabled} onClick={onTyping}>
          <Keyboard size={18} />
          <span>键盘</span>
        </button>
        <button
          className="toolbar-action placement-toggle"
          aria-label={overlay ? '操作栏悬浮，切换为底置' : '操作栏底置，切换为悬浮'}
          title={
            overlay
              ? '仅将底部按键行移到画面下方，两侧继续悬浮'
              : '将底部按键行悬浮到画面上，两侧保持悬浮'
          }
          onClick={onPlacement}
        >
          {overlay ? <Layers2 size={17} /> : <PanelBottom size={17} />}
          <span>{overlay ? '悬浮' : '底置'}</span>
        </button>
        <button
          className="toolbar-action"
          disabled={disabled}
          aria-label="退格（Backspace）"
          title="退格：删除光标左侧字符"
          onClick={() => onKey(KEY.backspace)}
        >
          <Delete size={20} />
          <span>退格</span>
        </button>
        <button
          className="toolbar-action enter-key"
          disabled={disabled}
          aria-label="Enter"
          onClick={() => onKey(KEY.enter)}
        >
          <CornerDownLeft size={20} />
          <span>Enter</span>
        </button>
      </div>
    </div>
  );
}
