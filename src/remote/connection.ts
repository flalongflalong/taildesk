export const QUALITY = {
  smooth: { label: '流畅', quality: 3, compression: 6 },
  balanced: { label: '均衡', quality: 6, compression: 2 },
  sharp: { label: '清晰', quality: 9, compression: 2 },
} as const;
export type Quality = keyof typeof QUALITY;

export function readQuality(): Quality {
  try {
    const saved = localStorage.getItem('taildesk.quality');
    if (saved === 'smooth' || saved === 'balanced' || saved === 'sharp') return saved;
  } catch {
    /* Storage is optional. */
  }
  return 'balanced';
}

export function recoveryPlan(failures: number, online: boolean, visible: boolean) {
  if (!visible) return { delay: null, message: '连接已暂停，回到页面后自动恢复。' };
  if (!online) return { delay: 30000, message: '网络状态提示离线，30 秒后再试；也可立即重连。' };
  const delay = [2000, 4000, 8000, 15000, 30000][Math.min(Math.max(0, failures), 4)];
  return { delay, message: `${delay / 1000} 秒后自动重试，可随时返回设备列表停止。` };
}

// An OS connectivity hint is not proof that the active VPN/WebSocket is dead.
// Only resume broken connections; never tear down a working one on "offline".
export function watchConnectionNetwork(
  network: EventTarget,
  page: EventTarget,
  snapshot: () => { state: string; hidden: boolean },
  resume: () => void,
) {
  const recover = () => {
    const { state, hidden } = snapshot();
    if (!hidden && ['disconnected', 'retrying'].includes(state)) resume();
  };
  network.addEventListener('online', recover);
  page.addEventListener('visibilitychange', recover);
  return () => {
    network.removeEventListener('online', recover);
    page.removeEventListener('visibilitychange', recover);
  };
}

export function closeDescription(code: number, reason: string) {
  const reasons: Record<string, string> = {
    target_closed: '电脑的屏幕共享服务结束了连接',
    bridge_closed: '桌面桥接连接已结束',
    bridge_timeout: '桌面数据传输等待超时',
    gateway_error: '网关转发出现错误',
    target_unreachable: '网关暂时无法连接电脑',
    input_too_large: '发送的数据超出限制',
    session_expired: '网关登录已过期',
  };
  const detail = reason.startsWith('Taildesk:') ? reasons[reason.slice(9)] : undefined;
  return `${detail || (code === 1006 ? '网页与网关的网络连接意外中断' : '远程连接已结束')}（${code}）。`;
}
