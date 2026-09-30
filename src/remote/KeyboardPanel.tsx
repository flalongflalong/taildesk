import { useState } from 'react';
import { KEY, type Modifier } from './controls';
import { InputPanelHeader, type InputMode } from './InputPanelHeader';

export function KeyboardPanel({
  mac,
  disabled,
  modifiers,
  onModifier,
  onKey,
  onMode,
  onClose,
}: {
  mac: boolean;
  disabled: boolean;
  modifiers: Modifier[];
  onModifier(m: Modifier): void;
  onKey(key: number, modifiers?: Modifier[]): void;
  onMode(mode: InputMode): void;
  onClose(): void;
}) {
  const [tab, setTab] = useState('edit');
  const primary: Modifier = mac ? 'meta' : 'ctrl';
  const symbol = mac ? '⌘' : 'Ctrl';
  const groups: Record<
    string,
    { label: string; keys: { label: string; key: number; mods?: Modifier[]; hint?: string }[] }
  > = {
    edit: {
      label: '编辑',
      keys: [
        { label: '全选', key: 97, mods: [primary], hint: `${symbol} A` },
        { label: '剪切', key: 120, mods: [primary], hint: `${symbol} X` },
        { label: '复制', key: 99, mods: [primary], hint: `${symbol} C` },
        { label: '粘贴', key: 118, mods: [primary], hint: `${symbol} V` },
        { label: '撤销', key: 122, mods: [primary], hint: `${symbol} Z` },
        {
          label: '重做',
          key: mac ? 122 : 121,
          mods: mac ? ['meta', 'shift'] : ['ctrl'],
          hint: mac ? '⇧ ⌘ Z' : 'Ctrl Y',
        },
        { label: '查找', key: 102, mods: [primary], hint: `${symbol} F` },
        { label: '保存', key: 115, mods: [primary], hint: `${symbol} S` },
      ],
    },
    nav: {
      label: '导航',
      keys: [
        { label: '↑', key: KEY.up },
        { label: '↓', key: KEY.down },
        { label: '←', key: KEY.left },
        { label: '→', key: KEY.right },
        { label: 'Enter', key: KEY.enter },
        { label: 'Esc', key: KEY.escape },
        { label: 'Tab', key: KEY.tab },
        { label: '退格', key: KEY.backspace },
        { label: 'Home', key: KEY.home },
        { label: 'End', key: KEY.end },
        { label: 'Page Up', key: KEY.pageUp },
        { label: 'Page Down', key: KEY.pageDown },
        { label: 'Delete', key: KEY.delete },
        { label: '空格', key: 32 },
        { label: '上一项', key: KEY.tab, mods: ['shift'], hint: '⇧ Tab' },
        { label: '中断命令', key: 99, mods: ['ctrl'], hint: 'Ctrl C' },
      ],
    },
    function: {
      label: 'F 键',
      keys: Array.from({ length: 12 }, (_, i) => ({ label: `F${i + 1}`, key: 0xffbe + i })),
    },
    system: {
      label: mac ? 'Mac' : '系统',
      keys: mac
        ? [
            { label: '切换应用', key: KEY.tab, mods: ['meta'], hint: '⌘ Tab' },
            { label: '搜索', key: 32, mods: ['meta'], hint: '⌘ Space' },
            { label: '窗口总览', key: KEY.up, mods: ['ctrl'], hint: 'Ctrl ↑' },
            { label: '应用窗口', key: KEY.down, mods: ['ctrl'], hint: 'Ctrl ↓' },
            { label: '上个桌面', key: KEY.left, mods: ['ctrl'], hint: 'Ctrl ←' },
            { label: '下个桌面', key: KEY.right, mods: ['ctrl'], hint: 'Ctrl →' },
          ]
        : [
            { label: '切换应用', key: KEY.tab, mods: ['alt'], hint: 'Alt Tab' },
            { label: '开始菜单', key: KEY.meta },
            { label: '安全选项', key: KEY.delete, mods: ['ctrl', 'alt'], hint: 'Ctrl Alt Del' },
          ],
    },
  };
  return (
    <section className="keyboard-panel" aria-label="扩展键盘">
      <InputPanelHeader mode="keys" onMode={onMode} onClose={onClose} />
      <div className="modifier-keys">
        {(['meta', 'ctrl', 'alt', 'shift'] as Modifier[]).map((m) => (
          <button
            key={m}
            disabled={disabled}
            aria-pressed={modifiers.includes(m)}
            onClick={() => onModifier(m)}
          >
            {m === 'meta'
              ? mac
                ? '⌘ Cmd'
                : '⊞ Win'
              : m === 'alt'
                ? mac
                  ? '⌥ Option'
                  : 'Alt'
                : m === 'shift'
                  ? '⇧ Shift'
                  : 'Ctrl'}
          </button>
        ))}
      </div>
      <p className="keyboard-note">
        {modifiers.length
          ? '已选组合键 · 点常用键或发送文字后自动释放'
          : '先选修饰键，再点方向键、Enter，或发送一个字母。'}
      </p>
      <div className="keyboard-tabs" role="tablist" aria-label="快捷键分类">
        {Object.entries(groups).map(([id, group]) => (
          <button
            key={id}
            id={`keys-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls="keys-content"
            onClick={() => setTab(id)}
          >
            {group.label}
          </button>
        ))}
      </div>
      <div
        className="keyboard-grid"
        id="keys-content"
        role="tabpanel"
        aria-labelledby={`keys-tab-${tab}`}
      >
        {groups[tab].keys.map((k) => (
          <button key={k.label} disabled={disabled} onClick={() => onKey(k.key, k.mods)}>
            {k.label}
            {k.hint && <small>{k.hint}</small>}
          </button>
        ))}
      </div>
      {tab === 'system' && mac && (
        <p className="keyboard-note">使用 macOS 默认快捷键；若电脑改过快捷键，以电脑设置为准。</p>
      )}
    </section>
  );
}
