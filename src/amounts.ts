// Amounts travel as integer strings in base units. These convert to and from
// decimal strings without floating point, so 0.1 + 0.2 never shows up.

/** "25.5" with 6 decimals → "25500000". Throws on more decimals than the asset has. */
export function toBaseUnits(value: string | number, decimals: number): string {
  const s = typeof value === "number" ? numberToPlain(value) : value.trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === "" && !m[2])) throw new RangeError(`not a positive decimal amount: "${value}"`);
  const whole = m[1] || "0";
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > decimals) throw new RangeError(`"${value}" has more than ${decimals} decimals`);
  const out = (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0")).toString();
  return out;
}

/** "25500000" with 6 decimals → "25.5". */
export function fromBaseUnits(amount: string | bigint, decimals: number): string {
  const v = BigInt(amount);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const unit = 10n ** BigInt(decimals);
  const frac = (abs % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${abs / unit}${frac ? `.${frac}` : ""}`;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`not a positive amount: ${n}`);
  // The shortest form that round-trips (0.1 → "0.1"); exponents need a string.
  const s = String(n);
  if (/e/i.test(s)) throw new RangeError(`pass ${n} as a decimal string`);
  return s;
}
