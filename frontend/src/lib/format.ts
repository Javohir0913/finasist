// Разделитель разрядов — НЕРАЗРЫВНЫЙ пробел: с обычным браузер переносит
// строку внутри числа и в узкой колонке получается «54 / 184.35 / сум».
export const NBSP = " ";

// group integer part every 3 digits: 5000000 -> "5 000 000" (одним куском)
export const group = (intStr: string) => intStr.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

// "5 000 000" for whole numbers, "5 000 000.23" when there are kopeks (dot decimal)
export const fmtMoney = (n: number | string | null | undefined) => {
  const v = Number(n || 0);
  const neg = v < 0;
  const rounded = Math.round(Math.abs(v) * 100) / 100;
  const hasDec = rounded % 1 !== 0;
  const [int, dec] = rounded.toFixed(hasDec ? 2 : 0).split(".");
  return (neg ? "−" : "") + group(int) + (dec ? "." + dec : "");
};

// always 2 decimals (currency style), space grouping + dot decimal
export const fmtMoney2 = (n: number | string | null | undefined) => {
  const v = Number(n || 0);
  const neg = v < 0;
  const [int, dec] = Math.abs(v).toFixed(2).split(".");
  return (neg ? "−" : "") + group(int) + "." + dec;
};

export const fmtUSD = (n: number | string | null | undefined) => "$" + fmtMoney(n);
export const fmtUSD2 = (n: number | string | null | undefined) => fmtMoney2(n);
// единица измерения приклеена неразрывным пробелом — «сум» не уедет на строку ниже
export const fmtUZS = (n: number | string | null | undefined) => fmtMoney(n) + NBSP + "сум";
export const fmtNum = (n: number | string | null | undefined) => fmtMoney(n);

/** Число с единицей измерения одним неразрывным куском: «500 м³». */
export const withUnit = (n: number | string | null | undefined, unit?: string | null) =>
  fmtMoney(n) + (unit ? NBSP + unit : "");

/** Одна точка форматирования денег для экранов с переключателем валюты. */
export const makeMoney = (cur: "uzs" | "usd", rate = 1) =>
  (v: number | string | null | undefined) =>
    cur === "usd"
      ? "$" + fmtMoney2(Number(v || 0) / (rate || 1))
      : fmtMoney(v) + NBSP + "сум";

export const fmtDate = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
};

export const fmtDateTime = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};
