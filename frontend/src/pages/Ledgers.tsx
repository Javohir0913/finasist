import { useState } from "react";
import { Card, EmptyState, SectionTitle, Spinner } from "../components/ui";
import { fmtMoney } from "../lib/format";
import { ExportButton, PeriodPicker, usePeriod, withPeriod } from "../lib/period";
import { useApi } from "../lib/useApi";

interface Row {
  id: number; name: string; inn: string; ledger: string; expense_code: string;
  open_debit: number; open_credit: number;
  turn_debit: number; turn_credit: number;
  end_debit: number; end_credit: number;
  end_debit_usd: number; end_credit_usd: number;
  revalued_usd: number; fx_income: number; fx_loss: number;
}
interface Data {
  rows: Row[];
  totals: Record<string, number>;
  rate: number;
}
interface LedgerType { key: string; label: string }

/** Ведомости Дт-Кт — по одному листу Excel на каждый вид контрагентов. */
export default function Ledgers() {
  const { data: types } = useApi<LedgerType[]>("/ledger-types");
  const [ledger, setLedger] = useState("suppliers");
  const { qs, label } = usePeriod();
  const url = withPeriod(`/reports/ledger?ledger=${ledger}`, qs);
  const { data, loading } = useApi<Data>(url, [url]);
  const [q, setQ] = useState("");
  const [fx, setFx] = useState(false);

  const [side, setSide] = useState("");

  const rows = (data?.rows || []).filter((r) => {
    if (side === "debit" && !r.end_debit) return false;
    if (side === "credit" && !r.end_credit) return false;
    if (side === "moved" && !r.turn_debit && !r.turn_credit) return false;
    return !q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.inn || "").includes(q);
  });
  const current = types?.find((t) => t.key === ledger);
  // Итог считаем по видимым строкам, а не берём серверный total:
  // иначе при фильтре «ВСЕГО» относилось бы к другому набору организаций.
  const T = (k: keyof Row) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  const filtered = Boolean(q) || Boolean(side);

  return (
    <div>
      <SectionTitle
        title="Ведомости Дт-Кт"
        sub={`Дебиторская и кредиторская задолженность ${label}. Дебет — нам должны, кредит — мы должны.`}
        right={
          <div className="flex items-center gap-2">
            <PeriodPicker />
            <ExportButton url={withPeriod("/export/reports?only=ledger", qs)} label="Все ведомости" />
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {types?.map((t) => (
          <button
            key={t.key}
            onClick={() => setLedger(t.key)}
            className={`chip ${ledger === t.key ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-veil/5 text-slate-400 border border-line"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="p-3 border-b border-line flex items-center gap-3">
          <input
            className="input max-w-sm"
            placeholder="Поиск по названию или ИНН…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="input !py-1.5 w-auto" value={side} onChange={(e) => setSide(e.target.value)}>
            <option value="">Сальдо: любое</option>
            <option value="debit">только дебет (нам должны)</option>
            <option value="credit">только кредит (мы должны)</option>
            <option value="moved">был оборот за период</option>
          </select>
          {filtered && (
            <button className="chip bg-veil/5 text-slate-400 border border-line hover:text-ink"
              onClick={() => { setQ(""); setSide(""); }}>✕ сбросить</button>
          )}
          <span className="text-xs text-slate-500">
            {current?.label} · показано {rows.length} из {data?.rows.length ?? 0}
          </span>
          <label className="flex items-center gap-2 text-sm text-slate-400 ml-auto">
            <input type="checkbox" checked={fx} onChange={(e) => setFx(e.target.checked)} className="h-4 w-4 accent-accent" />
            Переоценка и курсовая разница
          </label>
        </div>
        {loading ? (
          <Spinner />
        ) : !rows?.length ? (
          <EmptyState text="По этой ведомости нет оборотов и сальдо за выбранный период" />
        ) : (
          <div className="overflow-x-auto max-h-[65vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-base-850 z-10">
                <tr>
                  <th className="th" rowSpan={2}>ИНН</th>
                  <th className="th" rowSpan={2}>Наименование организации</th>
                  <th className="th text-center border-l border-line" colSpan={2}>На начало периода</th>
                  <th className="th text-center border-l border-line" colSpan={2}>Оборот</th>
                  <th className="th text-center border-l border-line" colSpan={2}>На конец периода</th>
                  {fx && <th className="th text-center border-l border-line" colSpan={3}>Курсовая разница, $</th>}
                </tr>
                <tr>
                  <th className="th text-right border-l border-line">Дебет</th>
                  <th className="th text-right">Кредит</th>
                  <th className="th text-right border-l border-line">Дебет</th>
                  <th className="th text-right">Кредит</th>
                  <th className="th text-right border-l border-line">Дебет</th>
                  <th className="th text-right">Кредит</th>
                  {fx && <>
                    <th className="th text-right border-l border-line">Переоценка</th>
                    <th className="th text-right">ДТ (доходы)</th>
                    <th className="th text-right">КТ (убытки)</th>
                  </>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-veil/[0.02]">
                    <td className="td font-mono text-slate-500">{r.inn || "—"}</td>
                    <td className="td text-ink">{r.name}</td>
                    <td className="td text-right tabular-nums border-l border-line">{fmtMoney(r.open_debit)}</td>
                    <td className="td text-right tabular-nums">{fmtMoney(r.open_credit)}</td>
                    <td className="td text-right tabular-nums border-l border-line">{fmtMoney(r.turn_debit)}</td>
                    <td className="td text-right tabular-nums">{fmtMoney(r.turn_credit)}</td>
                    <td className="td text-right tabular-nums border-l border-line text-emerald-300">{fmtMoney(r.end_debit)}</td>
                    <td className="td text-right tabular-nums text-rose-300">{fmtMoney(r.end_credit)}</td>
                    {fx && <>
                      <td className="td text-right tabular-nums border-l border-line text-slate-400">{fmtMoney(r.revalued_usd)}</td>
                      <td className="td text-right tabular-nums text-emerald-300">{r.fx_income ? fmtMoney(r.fx_income) : "—"}</td>
                      <td className="td text-right tabular-nums text-rose-300">{r.fx_loss ? fmtMoney(r.fx_loss) : "—"}</td>
                    </>}
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-base-850">
                <tr className="font-semibold text-ink">
                  <td className="td" colSpan={2}>{filtered ? "ВСЕГО ПО ФИЛЬТРУ" : "ВСЕГО"}</td>
                  <td className="td text-right tabular-nums border-l border-line">{fmtMoney(T("open_debit"))}</td>
                  <td className="td text-right tabular-nums">{fmtMoney(T("open_credit"))}</td>
                  <td className="td text-right tabular-nums border-l border-line">{fmtMoney(T("turn_debit"))}</td>
                  <td className="td text-right tabular-nums">{fmtMoney(T("turn_credit"))}</td>
                  <td className="td text-right tabular-nums border-l border-line">{fmtMoney(T("end_debit"))}</td>
                  <td className="td text-right tabular-nums">{fmtMoney(T("end_credit"))}</td>
                  {fx && <>
                    <td className="td text-right tabular-nums border-l border-line">{fmtMoney(T("revalued_usd"))}</td>
                    <td className="td text-right tabular-nums text-emerald-300">{fmtMoney(T("fx_income"))}</td>
                    <td className="td text-right tabular-nums text-rose-300">{fmtMoney(T("fx_loss"))}</td>
                  </>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-slate-500 mt-3">
        Входящее сальдо задаётся в карточке организации («Организации» → входящее сальдо),
        обороты собираются автоматически из операций, прихода ТМЦ, продаж и услуг.
        {fx && ` Переоценка = сальдо в сумах / курс на конец периода (${fmtMoney(data?.rate)}); доходы и убытки считаются по каждой строке отдельно.`}
      </p>
    </div>
  );
}
