// src/metrics/ta.js
export function sma(arr, n) {
  if (!arr?.length || n <= 0) return null;
  const m = arr.slice(-n);
  if (m.length < n) return null;
  const s = m.reduce((a, b) => a + b, 0);
  return s / n;
}

export function atr(ohlc, n = 14) {
  // ohlc: [{open, high, low, close}]
  if (!ohlc || ohlc.length < n + 1) return null;
  const trs = [];
  for (let i = 1; i < ohlc.length; i++) {
    const prev = ohlc[i - 1], cur = ohlc[i];
    const h = cur.high, l = cur.low, pc = prev.close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  return sma(trs, n);
}

export function hv(arrCloses, n = 20) {
  // simple close-to-close annualized historical volatility
  if (!arrCloses || arrCloses.length < n + 1) return null;
  const ret = [];
  for (let i = 1; i < arrCloses.length; i++) {
    ret.push(Math.log(arrCloses[i] / arrCloses[i - 1]));
  }
  const last = ret.slice(-n);
  const mean = last.reduce((a, b) => a + b, 0) / n;
  const varr = last.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const dailyVol = Math.sqrt(varr);
  return dailyVol * Math.sqrt(252); // annualize
}

