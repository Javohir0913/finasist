/**
 * Фильтр списка + итог по тому, что сейчас на экране.
 *
 * Смысл: пользователь фильтрует реестр (объект, контрагент, кусок текста)
 * и сразу видит сумму именно отфильтрованных строк, а не всего реестра.
 * Поэтому итоговая строка ВСЕГДА считается по `f.rows`, а не по исходным
 * данным — иначе фильтр вводил бы в заблуждение.
 */
import { useMemo, useState } from "react";
import { fmtMoney, NBSP } from "./format";

export const sum = (rows: any[] | null | undefined, key: string) =>
  (rows || []).reduce((a, r) => a + Number(r?.[key] || 0), 0);

/** Склеить поля строки в текст для поиска; пустые выкидываются. */
export const text = (...parts: (string | number | null | undefined)[]) =>
  parts.filter((x) => x !== null && x !== undefined && x !== "").join(" ").toLowerCase();

export interface Facet<T> {
  key: string;
  label: string;
  /** Значение строки для этой грани; пустая строка = «не указано». */
  of: (row: T) => string;
}

export interface Filtered<T> {
  q: string;
  setQ: (v: string) => void;
  picked: Record<string, string>;
  pick: (key: string, value: string) => void;
  reset: () => void;
  /** Отфильтрованные строки — по ним и считается итог. */
  rows: T[];
  all: T[];
  facets: Facet<T>[];
  active: boolean;
}

export function useFilter<T>(
  rows: T[] | null | undefined,
  search: (row: T) => string,
  facets: Facet<T>[] = []
): Filtered<T> {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const all = rows || [];
  const keys = facets.map((f) => f.key).join();

  const out = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      for (const f of facets) {
        const want = picked[f.key];
        if (want && f.of(r) !== want) return false;
      }
      return !needle || search(r).includes(needle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, picked, keys]);

  return {
    q,
    setQ,
    picked,
    pick: (key, value) => setPicked((p) => ({ ...p, [key]: value })),
    reset: () => { setQ(""); setPicked({}); },
    rows: out,
    all,
    facets,
    active: Boolean(q.trim()) || Object.values(picked).some(Boolean),
  };
}

/** Панель фильтров над таблицей. Варианты граней берутся из ВСЕХ строк. */
export function FilterBar<T>({ f, placeholder = "Поиск по реестру…", children }: {
  f: Filtered<T>;
  placeholder?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <input className="input !py-1.5 w-56" value={f.q}
        onChange={(e) => f.setQ(e.target.value)} placeholder={placeholder} />
      {f.facets.map((fc) => {
        const opts = Array.from(new Set(f.all.map(fc.of)))
          .sort((a, b) => a.localeCompare(b, "ru"));
        if (opts.length < 2) return null;
        return (
          <select key={fc.key} className="input !py-1.5 w-auto"
            value={f.picked[fc.key] || ""} onChange={(e) => f.pick(fc.key, e.target.value)}>
            <option value="">{fc.label}: все</option>
            {opts.map((v) => <option key={v} value={v}>{v || "— не указано —"}</option>)}
          </select>
        );
      })}
      {children}
      {f.active && (
        <button className="chip bg-veil/5 text-slate-400 border border-line hover:text-ink"
          onClick={f.reset}>✕ сбросить</button>
      )}
      <span className="text-xs text-slate-500 ml-auto whitespace-nowrap">
        показано {f.rows.length} из {f.all.length}
      </span>
    </div>
  );
}

/**
 * Итоговая строка таблицы. `cells` — по одной на колонку слева направо;
 * `null` = пустая ячейка, первая непустая работает как подпись.
 */
export function TotalRow({ cells, label = "Итого по фильтру" }: {
  cells: (string | null)[];
  label?: string;
}) {
  return (
    <tfoot>
      <tr className="border-t-2 border-line bg-veil/[0.04] font-semibold text-ink">
        <td className="td whitespace-nowrap text-slate-300">{label}</td>
        {cells.map((c, i) => (
          <td key={i} className="td text-right tabular-nums whitespace-nowrap">{c ?? ""}</td>
        ))}
      </tr>
    </tfoot>
  );
}

export const uzs = (v: number) => fmtMoney(v) + NBSP + "сум";
export const qty = (v: number) =>
  Number(v || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 }).replace(/\s/g, NBSP);
