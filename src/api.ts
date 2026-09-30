export type Device = {
  id: string;
  name: string;
  host: string;
  port: number;
  platform: 'mac' | 'windows' | 'linux';
  created_at: string;
};
export type DeviceInput = Pick<Device, 'name' | 'host' | 'port' | 'platform'>;
export type Probe = { reachable: boolean; message: string };

export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    signal,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/login')
      window.dispatchEvent(new Event('session-expired'));
    const message =
      typeof result.detail === 'string'
        ? result.detail
        : Array.isArray(result.detail)
          ? result.detail.map((e: { msg: string }) => e.msg.replace('Value error, ', '')).join('；')
          : '暂时无法连接网关，请稍后重试';
    throw new Error(message);
  }
  return result;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : '操作未完成，请重试');
