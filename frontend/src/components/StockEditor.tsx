/**
 * Редактор входящих остатков по объектам — общий для сырья/запчастей и ГП.
 *
 * Строки правятся ПРЯМО в таблице. Раньше введённое значение можно было только
 * перебить, заново выбрав объект в форме снизу, а введённую цену не было видно
 * вообще — отсюда и путаница при вводе.
 */
import { useState } from "react";
import api, { apiError } from "../api/client";
import { fmtNum, withUnit } from "../lib/format";
import { Field, MoneyInput } from "./ui";

export interface StockRow {
  division: string;
  /** сырое значение подразделения — им и правим строку, подпись не годится */
  division_key: string;
  opening_qty: number;
  opening_cost: number;
  stock_qty: number;
  avg_cost: number;
}

export default function StockEditor({
  title, hint, url, idField, id, unit, rows, divisions, reload, costLabel = "Входящая цена",
}: {
  title: string;
  hint: string;
  url: string;
  idField: string;
  id: number;
  unit?: string;
  rows?: StockRow[] | null;
  divisions?: { name: string }[] | null;
  reload: () => void;
  costLabel?: string;
}) {
  const [form, setForm] = useState({ division: "", opening_qty: 0, opening_cost: 0 });
  const [draft, setDraft] = useState<Record<string, { qty: any; cost: any }>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const put = async (division: string, qty: number, cost: number, tag: string) => {
    setBusy(tag); setErr("");
    try {
      await api.put(url, { [idField]: id, division, opening_qty: qty, opening_cost: cost });
      setDraft((d) => { const n = { ...d }; delete n[division]; return n; });
      if (tag === "new") setForm({ division: "", opening_qty: 0, opening_cost: 0 });
      reload();
    } catch (e) { setErr(apiError(e)); } finally { setBusy(""); }
  };

  // объект, у которого остаток уже задан, второй раз предлагать незачем —
  // его строка правится прямо в таблице
  const used = new Set((rows || []).map((r) => r.division_key));
  const free = [{ name: "" }, ...(divisions || [])].filter((d) => !used.has(d.name));

  return (
    <div className="rounded-xl bg-veil/[0.03] border border-line p-3.5">
      <div className="text-sm font-semibold text-ink mb-2">{title}</div>
      {err && <div className="mb-2 text-xs text-rose-300">{err}</div>}

      {rows?.length ? (
        <div className="overflow-x-auto mb-3">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="th">Объект</th>
              <th className="th text-right">Входящий, кол-во</th>
              <th className="th text-right">{costLabel}</th>
              <th className="th text-right">Текущий</th>
              <th className="th text-right">Ср. себестоимость</th>
              <th className="th"></th>
            </tr></thead>
            <tbody>{rows.map((r) => {
              const key = r.division_key;
              const d = draft[key];
              const qty = d ? d.qty : r.opening_qty;
              const cost = d ? d.cost : r.opening_cost;
              const dirty = Boolean(d)
                && (Number(qty || 0) !== r.opening_qty || Number(cost || 0) !== r.opening_cost);
              return (
                <tr key={key || "—"}>
                  <td className="td text-slate-300 whitespace-nowrap">{r.division}</td>
                  <td className="td">
                    <MoneyInput className="input !py-1 text-right" value={qty}
                      onChange={(v) => setDraft({ ...draft, [key]: { qty: v, cost } })} />
                  </td>
                  <td className="td">
                    <MoneyInput className="input !py-1 text-right" value={cost}
                      onChange={(v) => setDraft({ ...draft, [key]: { qty, cost: v } })} />
                  </td>
                  <td className="td text-right text-ink tabular-nums whitespace-nowrap">{withUnit(r.stock_qty, unit)}</td>
                  <td className="td text-right tabular-nums whitespace-nowrap">{fmtNum(r.avg_cost)}</td>
                  <td className="td text-right whitespace-nowrap">
                    {dirty && (
                      <button className="chip bg-accent/15 text-accent-soft border border-accent/25 mr-2"
                        disabled={busy === key}
                        onClick={() => put(key, Number(qty || 0), Number(cost || 0), key)}>
                        Сохранить
                      </button>
                    )}
                    <button className="text-slate-500 hover:text-rose-300" title="Обнулить входящий остаток"
                      disabled={busy === key}
                      onClick={() => { if (confirm(`Обнулить входящий остаток по «${r.division}»?`)) put(key, 0, 0, key); }}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ) : <p className="text-xs text-slate-500 mb-3">Входящих остатков по объектам пока нет.</p>}

      {free.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
          <Field label="Добавить объект">
            <select className="input !py-1.5" value={form.division}
              onChange={(e) => setForm({ ...form, division: e.target.value })}>
              {free.map((d) => <option key={d.name} value={d.name}>{d.name || "— общий склад —"}</option>)}
            </select>
          </Field>
          <Field label="Входящий, кол-во">
            <MoneyInput className="input !py-1.5" value={form.opening_qty}
              onChange={(v) => setForm({ ...form, opening_qty: Number(v || 0) })} />
          </Field>
          <Field label={costLabel}>
            <MoneyInput className="input !py-1.5" value={form.opening_cost}
              onChange={(v) => setForm({ ...form, opening_cost: Number(v || 0) })} />
          </Field>
          <button className="btn-ghost" disabled={busy === "new"}
            onClick={() => put(form.division, Number(form.opening_qty || 0), Number(form.opening_cost || 0), "new")}>
            Добавить
          </button>
        </div>
      )}
      <p className="text-[11px] text-slate-500 mt-2">{hint}</p>
    </div>
  );
}
