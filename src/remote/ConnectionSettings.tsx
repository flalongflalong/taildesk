import { useEffect, useState } from 'react';
import { api } from '../api';
import { QUALITY, type Quality } from './connection';

export function ConnectionSettings({
  quality,
  onQuality,
}: {
  quality: Quality;
  onQuality: (value: Quality) => void;
}) {
  const [latency, setLatency] = useState('正在检测…');
  useEffect(() => {
    let disposed = false;
    let next: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    async function sample() {
      if (disposed) return;
      if (document.hidden) {
        next = setTimeout(sample, 5000);
        return;
      }
      controller = new AbortController();
      const deadline = setTimeout(() => controller?.abort(), 8000);
      const start = performance.now();
      try {
        const session = await api<{ authenticated: boolean }>(
          '/session',
          'GET',
          undefined,
          controller.signal,
        );
        if (!disposed) {
          if (!session.authenticated) window.dispatchEvent(new Event('session-expired'));
          else setLatency(`${Math.round(performance.now() - start)} ms`);
        }
      } catch {
        if (!disposed) setLatency(navigator.onLine ? '暂时无法到达网关' : '网络已断开');
      } finally {
        clearTimeout(deadline);
        if (!disposed) next = setTimeout(sample, 5000);
      }
    }
    void sample();
    return () => {
      disposed = true;
      clearTimeout(next);
      controller?.abort();
    };
  }, []);
  return (
    <div className="connection-settings">
      <fieldset>
        <legend>画质</legend>
        <div className="quality-options">
          {(Object.keys(QUALITY) as Quality[]).map((value) => (
            <button key={value} aria-pressed={quality === value} onClick={() => onQuality(value)}>
              {QUALITY[value].label}
            </button>
          ))}
        </div>
      </fieldset>
      <p>卡顿时试试「流畅」；效果取决于电脑支持的画面编码。</p>
      <p className="gateway-latency">
        到网关 <strong aria-live="polite">{latency}</strong>
        <span>仅网页到网关的往返时间，不含桌面处理。</span>
      </p>
    </div>
  );
}
