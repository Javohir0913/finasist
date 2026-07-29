import { createContext, ReactNode, useContext, useMemo, useState } from "react";
import api, { apiError } from "../api/client";

export const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

export interface Period {
  year: number | null;
  month: number | null;
}

const KEY = "pd.period";

function load(): Period {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

const Ctx = createContext<{
  period: Period;
  setPeriod: (p: Period) => void;
  qs: string;
  label: string;
}>({ period: { year: null, month: null }, setPeriod: () => {}, qs: "", label: "" });

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriodState] = useState<Period>(load);
  const setPeriod = (p: Period) => {
    setPeriodState(p);
    localStorage.setItem(KEY, JSON.stringify(p));
  };
  const value = useMemo(() => {
    const parts: string[] = [];
    if (period.year) parts.push(`year=${period.year}`);
    if (period.month) parts.push(`month=${period.month}`);
    const label = period.year
      ? period.month
        ? `за ${MONTHS[period.month - 1]} ${period.year} года`
        : `за ${period.year} год`
      : "за весь период";
    return { period, setPeriod, qs: parts.join("&"), label };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePeriod = () => useContext(Ctx);

/** Добавить параметры периода к произвольному URL. */
export function withPeriod(url: string, qs: string, extra?: string): string {
  const tail = [qs, extra].filter(Boolean).join("&");
  if (!tail) return url;
  return url + (url.includes("?") ? "&" : "?") + tail;
}

export function PeriodPicker() {
  const { period, setPeriod } = usePeriod();
  const now = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => now - 4 + i);
  return (
    <div className="flex items-center gap-2">
      <select
        className="input !py-1.5 !w-auto"
        value={period.month ?? ""}
        onChange={(e) =>
          setPeriod({ ...period, month: e.target.value ? Number(e.target.value) : null })
        }
      >
        <option value="">весь год</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <select
        className="input !py-1.5 !w-auto"
        value={period.year ?? ""}
        onChange={(e) =>
          setPeriod({
            year: e.target.value ? Number(e.target.value) : null,
            month: e.target.value ? period.month : null,
          })
        }
      >
        <option value="">всё время</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Ошибка от эндпоинта, отвечающего blob-ом: detail лежит внутри Blob. */
async function blobError(e: any): Promise<string> {
  const data = e?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (typeof parsed?.detail === "string") return parsed.detail;
    } catch {
      /* не JSON — покажем общее сообщение */
    }
  }
  return apiError(e);
}

/** Скачать файл с API (с токеном) и отдать браузеру. */
export async function download(url: string, fallbackName = "export.xlsx") {
  const res = await api.get(url, { responseType: "blob" });
  const disp: string = res.headers["content-disposition"] || "";
  let name = fallbackName;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disp);
  const plain = /filename="([^"]+)"/i.exec(disp);
  if (star) name = decodeURIComponent(star[1]);
  else if (plain) name = plain[1];
  const href = URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

export function ExportButton({
  url,
  label = "Excel",
  title,
}: {
  url: string;
  label?: string;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="relative">
      <button
        className="btn-ghost whitespace-nowrap"
        title={title || "Выгрузить в Excel (.xlsx)"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            await download(url);
          } catch (e) {
            setErr(await blobError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Готовим…" : `↓ ${label}`}
      </button>
      {err && (
        <div className="absolute right-0 top-full mt-1 z-50 text-xs text-rose-300 bg-base-850 border border-rose-500/25 rounded-lg px-2 py-1 whitespace-nowrap">
          {err}
        </div>
      )}
    </div>
  );
}
