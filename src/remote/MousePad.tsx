import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { MousePointer2 } from 'lucide-react';
import { desktopDelta } from './orientation';
import { joystickVelocity, type Point } from './pointer';

export function MousePad({
  disabled,
  rotated,
  move,
  button,
  release,
}: {
  disabled: boolean;
  rotated: boolean;
  move(x: number, y: number): void;
  button(mask: 1 | 4, down: boolean): void;
  release(): void;
}) {
  const [nub, setNub] = useState<Point>({ x: 0, y: 0 });
  const nubElement = useRef<HTMLSpanElement>(null);
  const velocity = useRef<Point>({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  const frame = useRef(0);
  const previous = useRef(0);
  const callbacks = useRef({ move, button, release });
  callbacks.current = { move, button, release };
  function stop() {
    active.current = null;
    cancelAnimationFrame(frame.current);
    velocity.current = { x: 0, y: 0 };
    setNub({ x: 0, y: 0 });
  }
  useEffect(() => {
    const cancel = () => {
      stop();
      callbacks.current.release();
    };
    const hidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', hidden);
    if (disabled) cancel();
    return () => {
      cancel();
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [disabled, rotated]);
  function steer(e: PointerEvent<HTMLButtonElement>) {
    const bounds = e.currentTarget.getBoundingClientRect();
    const delta = desktopDelta(
      e.clientX - bounds.left - bounds.width / 2,
      e.clientY - bounds.top - bounds.height / 2,
      rotated,
    );
    const nubSize = nubElement.current?.offsetWidth || 38;
    const radius = Math.max(10, (Math.min(bounds.width, bounds.height) - nubSize) / 2 - 4);
    const factor = Math.min(1, radius / (Math.hypot(delta.x, delta.y) || 1));
    setNub({ x: delta.x * factor, y: delta.y * factor });
    velocity.current = joystickVelocity(delta.x, delta.y, radius);
  }
  function tick(now: number) {
    if (active.current === null) return;
    const elapsed = now - previous.current;
    // 30 small pointer updates/second; never catch up after a suspended tab.
    if (elapsed >= 32) {
      previous.current = now;
      const dt = Math.min(elapsed, 50) / 1000;
      const v = velocity.current;
      if (v.x || v.y) callbacks.current.move(v.x * dt, v.y * dt);
    }
    frame.current = requestAnimationFrame(tick);
  }
  return (
    <section className="mouse-pad" aria-label="鼠标操控区">
      <button
        className="mouse-stick"
        aria-label="鼠标摇杆"
        disabled={disabled}
        title="推住摇杆移动鼠标；方向键也可微调"
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (disabled || active.current !== null) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          active.current = e.pointerId;
          steer(e);
          previous.current = performance.now();
          frame.current = requestAnimationFrame(tick);
        }}
        onPointerMove={(e) => {
          if (active.current === e.pointerId) steer(e);
        }}
        onPointerUp={(e) => {
          if (active.current === e.pointerId) stop();
        }}
        onPointerCancel={() => {
          stop();
          release();
        }}
        onLostPointerCapture={() => {
          if (active.current !== null) {
            stop();
            release();
          }
        }}
        onKeyDown={(e) => {
          const steps: Record<string, Point> = {
            ArrowLeft: { x: -8, y: 0 },
            ArrowRight: { x: 8, y: 0 },
            ArrowUp: { x: 0, y: -8 },
            ArrowDown: { x: 0, y: 8 },
          };
          if (steps[e.key]) {
            e.preventDefault();
            move(steps[e.key].x, steps[e.key].y);
          }
        }}
      >
        <span className="stick-cross" />
        <span
          ref={nubElement}
          className="stick-nub"
          style={{ transform: `translate(${nub.x}px, ${nub.y}px)` }}
        >
          <MousePointer2 size={19} />
        </span>
      </button>
      <div className="mouse-buttons">
        {(
          [
            { label: '左键', mask: 1 },
            { label: '右键', mask: 4 },
          ] as const
        ).map(({ label, mask }) => (
          <button
            key={mask}
            disabled={disabled}
            aria-label={`鼠标${label}`}
            title={mask === 1 ? '按住左键，同时推摇杆可拖拽' : '鼠标右键'}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              button(mask, true);
            }}
            onPointerUp={() => button(mask, false)}
            onPointerCancel={() => button(mask, false)}
            onLostPointerCapture={() => button(mask, false)}
            onClick={(e) => {
              if (e.detail === 0) {
                button(mask, true);
                button(mask, false);
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
