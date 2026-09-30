import { ChevronDown } from 'lucide-react';

export type InputMode = 'text' | 'typing' | 'keys';

export function InputPanelHeader({
  mode,
  onMode,
  onClose,
}: {
  mode: InputMode;
  onMode(mode: InputMode): void;
  onClose(): void;
}) {
  return (
    <div className="input-panel-header">
      <div className="input-mode-switch" role="group" aria-label="输入方式">
        {(
          [
            ['text', '文字输入'],
            ['typing', '屏幕键盘'],
            ['keys', '快捷键'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} aria-pressed={mode === value} onClick={() => onMode(value)}>
            {label}
          </button>
        ))}
      </div>
      <button
        className="icon-button"
        onClick={onClose}
        aria-label="收起输入面板"
        title="收起输入面板"
      >
        <ChevronDown size={20} />
      </button>
    </div>
  );
}
