import { useState, type FormEvent } from 'react';
import { Monitor, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../components';
import {
  regionsFor,
  validRegion,
  type DisplayPreferences,
  type DisplayRegion,
  type Layout,
} from './displays';

export function DisplayPicker({
  layout,
  preferences: p,
  onChange,
  onClose,
}: {
  layout: Layout;
  preferences: DisplayPreferences;
  onChange(p: DisplayPreferences): void;
  onClose(): void;
}) {
  const screens = regionsFor(p, layout);
  const [draft, setDraft] = useState<DisplayRegion[]>(
    p.custom.length ? p.custom : regionsFor({ ...p, mode: 'horizontal', count: 2 }, layout),
  );
  const [error, setError] = useState('');
  const update = (patch: Partial<DisplayPreferences>) => onChange({ ...p, ...patch });
  function saveCustom(e: FormEvent) {
    e.preventDefault();
    if (!draft.length || draft.some((r) => !validRegion(r, layout))) {
      setError('区域必须在当前桌面内，宽和高应大于 0。');
      return;
    }
    update({
      custom: draft.map((r, i) => ({ ...r, name: `屏幕 ${i + 1}` })),
      customSize: { width: layout.width, height: layout.height },
      selected: 'all',
    });
    setError('');
  }
  function choose(id: string) {
    update({ selected: id });
    onClose();
  }
  return (
    <Modal title="选择屏幕" onClose={onClose}>
      <p className="modal-copy">
        桌面 {layout.width} × {layout.height} · 选择一块屏幕放大查看，点击位置随画面切换。
      </p>
      <label htmlFor="display-layout">屏幕布局</label>
      <select
        id="display-layout"
        value={p.mode}
        onChange={(e) =>
          update({ mode: e.target.value as DisplayPreferences['mode'], selected: 'all' })
        }
      >
        <option value="auto">自动识别</option>
        <option value="horizontal">左右排列</option>
        <option value="vertical">上下排列</option>
        <option value="custom">自定义区域</option>
      </select>
      {p.mode === 'auto' && (
        <p className="display-note">
          {layout.screens.length > 1
            ? `电脑报告了 ${layout.screens.length} 块屏幕。`
            : '电脑未报告多屏边界。若画面已包含多块屏幕，请选择左右、上下排列或自定义区域。未传来的屏幕无法在这里切换。'}
        </p>
      )}
      {['horizontal', 'vertical'].includes(p.mode) && (
        <div className="display-calibration">
          <label htmlFor="display-count">屏幕数量</label>
          <select
            id="display-count"
            value={p.count}
            onChange={(e) => update({ count: Number(e.target.value), selected: 'all' })}
          >
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} 块
              </option>
            ))}
          </select>
          {p.count === 2 && (
            <>
              <label htmlFor="display-split">
                {p.mode === 'horizontal' ? '左屏宽度' : '上屏高度'}：{p.split}%
              </label>
              <input
                id="display-split"
                type="range"
                min="10"
                max="90"
                value={p.split}
                onChange={(e) => update({ split: Number(e.target.value) })}
              />
              <p className="display-note">
                两块屏幕大小不同时，拖动分界；高度或位置也不同时可用自定义区域。
              </p>
            </>
          )}
        </div>
      )}
      {p.mode === 'custom' && (
        <form className="display-custom" onSubmit={saveCustom}>
          <p className="display-note">
            填写各屏在完整桌面中的像素范围，左上角为 0, 0。分辨率改变后需重新保存。
          </p>
          {draft.map((r, index) => (
            <fieldset key={r.id}>
              <legend>屏幕 {index + 1}</legend>
              <div className="display-fields">
                {(['x', 'y', 'width', 'height'] as const).map((field, i) => (
                  <label key={field}>
                    {['左边 X', '顶部 Y', '宽度', '高度'][i]}
                    <input
                      aria-label={`屏幕 ${index + 1} ${['左边 X', '顶部 Y', '宽度', '高度'][i]}`}
                      type="number"
                      min={i < 2 ? 0 : 1}
                      max={i % 2 ? layout.height : layout.width}
                      required
                      value={r[field]}
                      onChange={(e) =>
                        setDraft(
                          draft.map((v, j) =>
                            j === index ? { ...v, [field]: Number(e.target.value) } : v,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
                <button
                  type="button"
                  className="icon-button"
                  disabled={draft.length === 1}
                  aria-label={`移除屏幕 ${index + 1}`}
                  onClick={() => setDraft(draft.filter((_, i) => i !== index))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </fieldset>
          ))}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <div className="display-custom-actions">
            <button
              type="button"
              className="secondary"
              disabled={draft.length >= 8}
              onClick={() =>
                setDraft([
                  ...draft,
                  {
                    id: `custom-${Date.now()}`,
                    name: `屏幕 ${draft.length + 1}`,
                    x: 0,
                    y: 0,
                    width: layout.width,
                    height: layout.height,
                  },
                ])
              }
            >
              <Plus size={16} />
              添加区域
            </button>
            <button className="primary">保存区域</button>
          </div>
        </form>
      )}
      <div
        className="display-map"
        aria-label="屏幕位置预览"
        style={{ aspectRatio: `${layout.width || 16} / ${layout.height || 9}` }}
      >
        {screens.map((r, i) => (
          <button
            key={r.id}
            aria-label={`选择${r.name}`}
            aria-pressed={p.selected === r.id}
            onClick={() => choose(r.id)}
            style={{
              left: `${(r.x / layout.width) * 100}%`,
              top: `${(r.y / layout.height) * 100}%`,
              width: `${(r.width / layout.width) * 100}%`,
              height: `${(r.height / layout.height) * 100}%`,
            }}
          >
            <Monitor size={20} />
            <b>{i + 1}</b>
          </button>
        ))}
        {!screens.length && <span>完整桌面</span>}
      </div>
      <div className="display-choices">
        <button
          className="secondary"
          aria-pressed={p.selected === 'all' || !screens.some((r) => r.id === p.selected)}
          onClick={() => choose('all')}
        >
          全部屏幕
        </button>
        {screens.map((r) => (
          <button
            className="secondary"
            key={r.id}
            aria-pressed={p.selected === r.id}
            onClick={() => choose(r.id)}
          >
            {r.name}
            <small>
              {r.width} × {r.height}
            </small>
          </button>
        ))}
      </div>
      <p className="display-note">布局记在当前浏览器，分别对应每台电脑。这里仅切换查看区域。</p>
    </Modal>
  );
}
