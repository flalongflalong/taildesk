import { useState } from 'react';
import { Delete, CornerDownLeft } from 'lucide-react';
import { KEY, type Modifier } from './controls';
import { InputPanelHeader, type InputMode } from './InputPanelHeader';

export function TypingKeyboard({
  disabled,
  mac,
  modifiers,
  onModifier,
  onKey,
  onMode,
  onClose,
}: {
  disabled: boolean;
  mac: boolean;
  modifiers: Modifier[];
  onModifier(m: Modifier): void;
  onKey(key: number, modifiers?: Modifier[]): void;
  onMode(mode: InputMode): void;
  onClose(): void;
}) {
  const [symbols, setSymbols] = useState(false);
  const shifted = modifiers.includes('shift');
  const rows = symbols
    ? ['1234567890', '-/:;()$&@"', ".,?!'[]{}"]
    : ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  return (
    <section className="typing-keyboard" aria-label="屏幕键盘">
      <InputPanelHeader mode="typing" onMode={onMode} onClose={onClose} />
      <div className="typing-rows">
        {rows.map((row, index) => (
          <div className={`typing-row row-${index}`} key={index}>
            {index === 2 && (
              <button
                className="wide-key"
                aria-label="Shift"
                disabled={disabled}
                aria-pressed={shifted}
                onClick={() => onModifier('shift')}
              >
                ⇧
              </button>
            )}
            {Array.from(row).map((char) => (
              <button
                key={char}
                disabled={disabled}
                aria-label={`输入 ${shifted ? char.toUpperCase() : char}`}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => onKey((shifted ? char.toUpperCase() : char).codePointAt(0)!)}
              >
                {shifted ? char.toUpperCase() : char}
              </button>
            ))}
            {index === 2 && (
              <button
                className="wide-key"
                aria-label="键盘退格"
                disabled={disabled}
                onClick={() => onKey(KEY.backspace)}
              >
                <Delete size={19} />
              </button>
            )}
          </div>
        ))}
        <div className="typing-row bottom-row">
          <button
            onClick={() => setSymbols(!symbols)}
            aria-label={symbols ? '字母键盘' : '数字符号键盘'}
          >
            {symbols ? 'ABC' : '123'}
          </button>
          <button disabled={disabled} onClick={() => onKey(KEY.escape)}>
            Esc
          </button>
          <button disabled={disabled} onClick={() => onKey(KEY.tab)}>
            Tab
          </button>
          <button
            disabled={disabled}
            aria-pressed={modifiers.includes(mac ? 'meta' : 'ctrl')}
            onClick={() => onModifier(mac ? 'meta' : 'ctrl')}
          >
            {mac ? '⌘' : 'Ctrl'}
          </button>
          <button className="space-key" disabled={disabled} onClick={() => onKey(32)}>
            空格
          </button>
          <button
            className="enter-key"
            aria-label="键盘 Enter"
            disabled={disabled}
            onClick={() => onKey(KEY.enter)}
          >
            <CornerDownLeft size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
