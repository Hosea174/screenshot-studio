'use client';

import * as React from 'react';
import { formatNumber, roundToTwoDecimals } from '@/lib/number-format';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'step'> & {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
};

/** Keep intermediate input such as '-' or '0.' editable; commit one undoable edit. */
export function NumberField({ value, onValueChange, min = -Infinity, max = Infinity, step = 0.01, ...props }: Props) {
  const [text, setText] = React.useState<string | null>(null);
  React.useEffect(() => setText(null), [value]);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const commit = () => {
    const n = Number(text);
    if (text !== null && text.trim() && Number.isFinite(n)) {
      const next = roundToTwoDecimals(clamp(n));
      if (next !== value) onValueChange(next);
    }
    setText(null);
  };
  return <input {...props} type="text" inputMode="decimal" value={text ?? formatNumber(value)}
    onFocus={e => { setText(formatNumber(value)); e.currentTarget.select(); }}
    onChange={e => setText(e.target.value)} onBlur={commit}
    onKeyDown={e => {
      if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); setText(null); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const n = Number(text ?? value);
        if (Number.isFinite(n)) { const next = roundToTwoDecimals(clamp(n + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1))); setText(formatNumber(next)); onValueChange(next); }
      }
    }} />;
}
