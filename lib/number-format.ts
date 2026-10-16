/** Round a displayed or authored value to at most two decimal places. */
export function roundToTwoDecimals(value: number): number {
  return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : value;
}

/** Format a number without trailing zeroes and never show more than two decimals. */
export function formatNumber(value: number): string {
  return String(roundToTwoDecimals(value));
}

/** Format decimal numbers embedded in a control label, preserving its units/text. */
export function formatNumberText(value: string | number): string {
  if (typeof value === 'number') return formatNumber(value);
  return value.replace(/[-+]?\d+\.\d+(?:e[-+]?\d+)?/gi, match => formatNumber(Number(match)));
}
