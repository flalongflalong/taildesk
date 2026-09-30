import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  CircleHelp,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  Laptop,
  LockKeyhole,
  LogOut,
  Monitor,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import { api, errorText, type Device, type DeviceInput, type Probe } from './api';
import { Brand, Modal, Spinner } from './components';
import Remote from './Remote';

export default function App() {
  const [auth, setAuth] = useState<boolean | null>(null);
  const [initialError, setInitialError] = useState('');
  const [remote, setRemote] = useState<Device | null>(null);
  const checkSession = () => {
    setInitialError('');
    api<{ authenticated: boolean }>('/session')
      .then((r) => setAuth(r.authenticated))
      .catch((e) => setInitialError(errorText(e)));
  };
  useEffect(() => {
    checkSession();
    const expired = () => {
      setRemote(null);
      setAuth(false);
    };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  if (auth === null)
    return (
      <div className="loading-screen">
        <Brand />
        {initialError ? (
          <>
            <p role="alert">{initialError}</p>
            <button className="primary" onClick={checkSession}>
              重新连接网关
            </button>
          </>
        ) : (
          <Spinner />
        )}
      </div>
    );
  if (!auth) return <Login onLogin={() => setAuth(true)} />;
  if (remote) return <Remote device={remote} onClose={() => setRemote(null)} />;
  return <Dashboard onConnect={setRemote} onLogout={() => setAuth(false)} />;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/login', 'POST', { key: key.trim() });
      setKey('');
      onLogin();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <header>
        <Brand />
        <span className="tiny-label">你的私人远程桌面</span>
      </header>
      <main className="login-layout">
        <section className="login-story">
          <div className="eyebrow">
            <span className="status-dot" /> A LITTLE CLOSER TO HOME
          </div>
          <h1>
            你的桌面，
            <br />
            随处可达<span className="brand-dot">。</span>
          </h1>
          <p>
            手机在手，电脑就在身边。
            <br />
            打开你的网页入口，连接熟悉的工作空间。
          </p>
          <div className="connection-art" aria-hidden="true">
            <span>
              <Smartphone size={34} />
            </span>
            <i />
            <span className="art-hub">
              <Monitor size={48} />
            </span>
            <i />
            <span>
              <Laptop size={38} />
            </span>
          </div>
          <div className="story-footer">
            <ShieldCheck size={17} /> 访问密钥保护 <span>·</span> VNC 密码不落盘
          </div>
        </section>
        <section className="login-card">
          <span className="login-lock">
            <LockKeyhole size={24} />
          </span>
          <h2>连接你的空间</h2>
          <p>先进入设备列表，再选择想控制的电脑。</p>
          <form onSubmit={login}>
            <label htmlFor="access-key">访问密钥</label>
            <div className="secret-input">
              <input
                id="access-key"
                type={showKey ? 'text' : 'password'}
                value={key}
                autoComplete="current-password"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => setKey(e.target.value)}
                placeholder="粘贴访问密钥"
                required
                maxLength={256}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={showKey ? '隐藏访问密钥' : '显示访问密钥'}
                aria-pressed={showKey}
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
            <p className="field-hint">这是 Taildesk 访问密钥，不是电脑的登录密码。</p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary full" disabled={busy || !key.trim()}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  进入 Taildesk <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <details>
            <summary>在哪里获取访问密钥？</summary>
            <p>
              密钥由网关首次启动时生成，保存在网关电脑项目目录的 <code>.data/access-key</code>{' '}
              文件中。它用于打开设备列表；连接桌面时再输入电脑的 VNC 密码。
            </p>
          </details>
        </section>
      </main>
      <footer className="login-footer">
        TAILDESK <span>个人设备之间的，一条近路。</span>
      </footer>
    </div>
  );
}

function Dashboard({
  onConnect,
  onLogout,
}: {
  onConnect: (d: Device) => void;
  onLogout: () => void;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Device | 'new' | null>(null);
  const [remove, setRemove] = useState<Device | null>(null);
  const [manage, setManage] = useState<Device | null>(null);
  const [guide, setGuide] = useState(false);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [checking, setChecking] = useState<string[]>([]);
  const [mutating, setMutating] = useState(false);
  async function load() {
    setError('');
    setLoading(true);
    try {
      setDevices(await api<Device[]>('/devices'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function probe(device: Device) {
    setChecking((p) => [...p, device.id]);
    try {
      setProbes((p) => ({ ...p, [device.id]: { reachable: false, message: '正在检查…' } }));
      const r = await api<Probe>(`/devices/${device.id}/probe`, 'POST');
      setProbes((p) => ({ ...p, [device.id]: r }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setChecking((p) => p.filter((id) => id !== device.id));
    }
  }
  async function deleteDevice() {
    if (!remove) return;
    setMutating(true);
    try {
      await api(`/devices/${remove.id}`, 'DELETE');
      setDevices((p) => p.filter((d) => d.id !== remove.id));
      setRemove(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setMutating(false);
    }
  }
  async function logout() {
    try {
      await api('/logout', 'POST');
      onLogout();
    } catch (e) {
      setError(errorText(e));
    }
  }
  const filtered = devices.filter((d) =>
    `${d.name} ${d.host}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-tag">
          <span className="workspace-avatar">P</span>
          <div>
            个人空间<small>Personal workspace</small>
          </div>
          <ShieldCheck size={16} />
        </div>
        <div className="nav-caption">工作空间</div>
        <nav>
          <button className="nav-item active" onClick={() => setGuide(false)}>
            <Monitor size={19} />
            我的设备<span className="nav-count">{devices.length}</span>
          </button>
          <button className="nav-item" onClick={() => setGuide(true)}>
            <BookOpen size={19} />
            连接指南
            <ChevronRight size={15} />
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <div>
              <ShieldCheck size={20} />
              <b>由你掌握访问权限</b>
            </div>
            <p>
              使用密钥进入个人空间，
              <br />
              再验证目标电脑的凭据。
            </p>
            <button onClick={() => setGuide(true)}>
              了解连接方式 <ArrowRight size={14} />
            </button>
          </div>
          <button className="nav-item" onClick={logout}>
            <LogOut size={18} />
            退出空间
          </button>
          <span className="version">
            TAILDESK <span>v0.1 · 个人版</span>
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand />
          </div>
          <span className="breadcrumb">
            个人空间 <ChevronRight size={13} /> <b>我的设备</b>
          </span>
          <div className="topbar-right">
            <span className="network-pill">
              <ShieldCheck size={14} /> 私有网关
            </span>
            <button
              className="icon-button"
              title="连接指南"
              aria-label="连接指南"
              onClick={() => setGuide(true)}
            >
              <CircleHelp size={19} />
            </button>
            <button
              className="icon-button logout-button"
              title="退出空间"
              aria-label="退出空间"
              onClick={logout}
            >
              <LogOut size={19} />
            </button>
          </div>
        </header>
        <main className="dashboard">
          <div className="page-heading">
            <div>
              <div className="eyebrow">TAILDESK / 个人空间</div>
              <h1>
                我的设备<span className="heading-dot">.</span>
              </h1>
              <p>选一台电脑，继续手边的事。</p>
            </div>
            <button className="primary" onClick={() => setEditor('new')}>
              <Plus size={18} />
              添加设备
            </button>
          </div>
          <button className="connection-reminder" onClick={() => setGuide(true)}>
            <ShieldCheck size={19} />
            <span>手机与电脑都保持 Tailscale 连接</span>
            <ChevronRight size={16} />
          </button>
          <div className="list-toolbar">
            <div className="list-title">
              全部设备 <span>{devices.length}</span>
            </div>
            <label className="search-box">
              <Search size={16} />
              <input
                aria-label="搜索设备"
                placeholder="搜索名称或地址"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button className="icon-button" onClick={() => setQuery('')} aria-label="清空搜索">
                  <X size={14} />
                </button>
              )}
            </label>
          </div>
          {error && (
            <div className="alert" role="alert">
              {error}
              <button onClick={() => setError('')} aria-label="关闭提示">
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty-state">
              <Spinner />
              <p>正在载入设备…</p>
            </div>
          ) : devices.length === 0 ? (
            <section className="empty-state">
              <div className="empty-icon">
                <Monitor size={34} />
                <Plus size={15} />
              </div>
              <h3>把第一台电脑带到这里</h3>
              <p>
                添加电脑的 Tailscale 地址，
                <br />
                就能从手机或另一台电脑连接它。
              </p>
              <button className="primary" onClick={() => setEditor('new')}>
                <Plus size={17} />
                添加第一台设备
              </button>
              <button className="text-button" onClick={() => setGuide(true)}>
                如何准备我的 Mac？
              </button>
            </section>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <Search size={32} />
              <h3>没有找到这台设备</h3>
              <button className="text-button" onClick={() => setQuery('')}>
                清空搜索
              </button>
            </div>
          ) : (
            <section className="device-grid">
              {filtered.map((device) => {
                const p = probes[device.id];
                const busy = checking.includes(device.id);
                return (
                  <article className="device-card" key={device.id}>
                    <div className="card-top">
                      <span className={`device-icon ${device.platform}`}>
                        {device.platform === 'mac' ? <Laptop size={29} /> : <Monitor size={29} />}
                      </span>
                      <span className={`device-status ${p?.reachable ? 'reachable' : ''}`}>
                        <span className="status-dot" />
                        {busy ? '检查中' : p ? (p.reachable ? '服务可达' : '暂不可达') : '尚未检查'}
                      </span>
                    </div>
                    <h3>{device.name}</h3>
                    <span className="platform-name">
                      {device.platform === 'mac'
                        ? 'macOS'
                        : device.platform === 'windows'
                          ? 'Windows'
                          : 'Linux'}{' '}
                      <span>·</span> 远程桌面
                    </span>
                    <div className="device-address">
                      <Wifi size={14} />
                      <code>{device.host}</code>
                      <span>:{device.port}</span>
                    </div>
                    {p && (
                      <p className="probe-message" role="status">
                        {p.message}
                      </p>
                    )}
                    <div className="card-actions">
                      <button className="connect-button" onClick={() => onConnect(device)}>
                        连接桌面 <ArrowRight size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`检查 ${device.name} 连接`}
                        title="检查连接"
                        onClick={() => probe(device)}
                        disabled={busy}
                      >
                        {busy ? <Spinner /> : <RefreshCw size={16} />}
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`管理 ${device.name}`}
                        title="管理设备"
                        onClick={() => setManage(device)}
                      >
                        <MoreHorizontal size={20} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
          <div className="connection-hint">
            <LockKeyhole size={16} />
            <p>目标电脑需保持开机，并已开启屏幕共享或 VNC 服务。</p>
            <button onClick={() => setGuide(true)}>
              设置指南 <ExternalLink size={13} />
            </button>
          </div>
        </main>
        <footer className="page-footer">
          <span>你的设备，你的空间。</span>
          <span>由 noVNC 与 Tailscale 连接</span>
        </footer>
      </div>
      {manage && (
        <Modal title={manage.name} onClose={() => setManage(null)}>
          <p className="modal-copy">管理这台设备的连接信息。</p>
          <div className="device-management">
            <button
              onClick={() => {
                setEditor(manage);
                setManage(null);
              }}
            >
              <Edit3 size={19} />
              <span>
                编辑设备<small>修改名称、地址或端口</small>
              </span>
              <ChevronRight size={16} />
            </button>
            <button
              className="remove-device-action"
              onClick={() => {
                setRemove(manage);
                setManage(null);
              }}
            >
              <Trash2 size={19} />
              <span>
                移除设备<small>只从列表移除，不影响电脑</small>
              </span>
              <ChevronRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {editor && (
        <DeviceEditor
          device={editor === 'new' ? undefined : editor}
          onClose={() => setEditor(null)}
          onSaved={(d) => {
            setDevices((p) =>
              p.some((v) => v.id === d.id) ? p.map((v) => (v.id === d.id ? d : v)) : [...p, d],
            );
            setProbes((p) => {
              const next = { ...p };
              delete next[d.id];
              return next;
            });
            setEditor(null);
          }}
        />
      )}
      {remove && (
        <Modal title="移除设备" onClose={() => setRemove(null)}>
          <p className="modal-copy">
            从列表移除「{remove.name}」？这会断开该设备的现有连接，不会删除电脑上的文件。
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setRemove(null)}>
              取消
            </button>
            <button className="danger" disabled={mutating} onClick={deleteDevice}>
              {mutating ? <Spinner /> : '移除设备'}
            </button>
          </div>
        </Modal>
      )}
      {guide && <Guide onClose={() => setGuide(false)} />}
    </div>
  );
}

function DeviceEditor({
  device,
  onClose,
  onSaved,
}: {
  device?: Device;
  onClose: () => void;
  onSaved: (d: Device) => void;
}) {
  const [form, setForm] = useState<DeviceInput>(
    device || { name: '', host: '', port: 5900, platform: 'mac' },
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { name, host, port, platform } = form;
      onSaved(
        await api<Device>(device ? `/devices/${device.id}` : '/devices', device ? 'PUT' : 'POST', {
          name,
          host,
          port,
          platform,
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={device ? '编辑设备' : '添加设备'} onClose={onClose}>
      <p className="modal-copy">把电脑添加到你的空间。连接时再输入 VNC 密码。</p>
      <form onSubmit={save}>
        <label htmlFor="device-name">设备名称</label>
        <input
          id="device-name"
          placeholder="例如：我的 MacBook Pro"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          maxLength={60}
          autoFocus
        />
        <label htmlFor="device-platform">操作系统</label>
        <select
          id="device-platform"
          value={form.platform}
          onChange={(e) =>
            setForm({ ...form, platform: e.target.value as DeviceInput['platform'] })
          }
        >
          <option value="mac">macOS</option>
          <option value="windows">Windows</option>
          <option value="linux">Linux</option>
        </select>
        <label htmlFor="device-host">Tailscale 地址</label>
        <input
          id="device-host"
          placeholder="100.x.x.x 或 computer.example.ts.net"
          value={form.host}
          onChange={(e) => setForm({ ...form, host: e.target.value })}
          required
          maxLength={253}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <small className="field-help">
          网关本机可填写 127.0.0.1；MagicDNS 请填写完整 .ts.net 名称。
        </small>
        <label htmlFor="device-port">VNC 端口</label>
        <input
          id="device-port"
          type="number"
          min={5900}
          max={5999}
          required
          value={Number.isNaN(form.port) ? '' : form.port}
          onChange={(e) => setForm({ ...form, port: e.target.valueAsNumber })}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? <Spinner /> : device ? '保存修改' : '添加设备'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Guide({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="第一次连接，三步就绪" onClose={onClose} wide>
      <div className="guide-step">
        <span>01</span>
        <div>
          <h3>让网关能访问目标电脑</h3>
          <p>
            在网关电脑和目标电脑上启用 Tailscale，允许网关访问目标电脑的 VNC 端口。 手机打开配置好的
            HTTPS 入口；使用 Tailscale Serve 入口时，手机也需要启用 Tailscale。
          </p>
        </div>
      </div>
      <div className="guide-step">
        <span>02</span>
        <div>
          <h3>在 Mac 上打开屏幕共享</h3>
          <p>
            打开「系统设置 → 通用 → 共享 → 屏幕共享」，允许你的账户访问。在屏幕共享设置中启用 VNC
            查看器控制并设置单独的 VNC 密码。不同 macOS 版本的入口略有差异。
          </p>
          <p>Windows / Linux 需要先安装并启用兼容的 VNC 服务；iPhone 用作打开页面的控制端。</p>
        </div>
      </div>
      <div className="guide-step">
        <span>03</span>
        <div>
          <h3>添加地址，连接桌面</h3>
          <p>
            填写目标电脑的 Tailscale IP（通常以 100 开头）和 VNC 端口（通常为
            5900）。选择「连接桌面」，在提示时输入 VNC 密码。
          </p>
          <p>在 iPhone 上，用 Safari 打开网关的 HTTPS 地址，也可以通过分享菜单添加到主屏幕。</p>
        </div>
      </div>
      <div className="guide-tip">
        <ShieldCheck size={20} />
        <p>
          网关支持 Tailscale Serve 内网入口或 ngrok HTTPS 入口，配置方式见项目 README。 仅开启
          Tailscale 不会自动开启桌面控制。
        </p>
      </div>
      <div className="modal-actions">
        <button className="primary" onClick={onClose}>
          准备好了
        </button>
      </div>
    </Modal>
  );
}
