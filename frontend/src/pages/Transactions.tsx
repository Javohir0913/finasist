import { useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Field, Modal, MoneyInput, SearchSelect, SectionTitle, Spinner } from "../components/ui";
import { fmtDate, fmtNum, fmtUSD2 } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface Org { id: number; name: string; category: string; inn?: string }
interface Code { id: number; code: string; name: string }
interface Div { id: number; name: string }
interface Tx {
  id: number; doc_date: string; direction: string; account: string; currency: string;
  amount: number; rate: number; amount_usd: number; expense_code: string; cashflow_code: string;
  division: string; cash_register: string; category: string;
  organization: Org | null; description: string;
}

interface Rate { rate_date: string; rate: number }
const empty = { doc_date: new Date().toISOString().slice(0, 10), direction: "income", account: "bank", currency: "UZS", amount: 0, expense_code: "", cashflow_code: "", division: "", cash_register: "", category: "", organization_id: "", description: "" };

export default function Transactions() {
  const { can } = useAuth();
  const [filter, setFilter] = useState("");
  const { data, loading, reload } = useApi<Tx[]>(`/transactions${filter ? `?direction=${filter}` : ""}`, [filter]);
  const { data: orgs } = useApi<Org[]>("/organizations");
  const { data: expCodes } = useApi<Code[]>("/expense-codes");
  const { data: cfCodes } = useApi<Code[]>("/cashflow-codes");
  const { data: divs } = useApi<Div[]>("/divisions");
  const { data: rates, reload: reloadRates } = useApi<Rate[]>("/exchange");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(empty);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [newRate, setNewRate] = useState("");
  const [savingRate, setSavingRate] = useState(false);

  // official rate for the selected date (UZS operations must use it)
  const officialRate = rates?.find((r) => r.rate_date === form.doc_date)?.rate;
  const rateMissing = form.currency === "UZS" && officialRate === undefined;
  const usdPreview =
    form.currency === "USD"
      ? Number(form.amount || 0)
      : officialRate
      ? Number(form.amount || 0) / Number(officialRate)
      : 0;

  const addRateForDate = async () => {
    setSavingRate(true);
    try {
      await api.post("/exchange", { rate_date: form.doc_date, rate: Number(newRate) });
      setNewRate("");
      await reloadRates();
    } catch (e) { setErr(apiError(e)); } finally { setSavingRate(false); }
  };

  const save = async () => {
    if (rateMissing) return;
    setErr(""); setSaving(true);
    try {
      await api.post("/transactions", {
        ...form,
        amount: Number(form.amount),
        organization_id: form.organization_id ? Number(form.organization_id) : null,
      });
      setOpen(false); setForm(empty); reload();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };

  const remove = async (id: number) => {
    if (!confirm("Удалить операцию?")) return;
    await api.delete(`/transactions/${id}`); reload();
  };

  return (
    <div>
      <SectionTitle
        title="Банк и Касса · Cash Flow"
        sub="Движение денежных средств по банку и кассе, UZS / USD"
        right={can("transactions:create") && <button className="btn-primary" onClick={() => { setForm(empty); setOpen(true); }}>+ Новая операция</button>}
      />

      <div className="flex gap-2 mb-4">
        {[["", "Все"], ["income", "Приход"], ["expense", "Расход"]].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)} className={`chip ${filter === v ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-white/5 text-slate-400 border border-line"}`}>{l}</button>
        ))}
      </div>

      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Операции не найдены" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px]">
              <thead><tr className="bg-white/[0.02]">
                <th className="th">Дата</th><th className="th">Тип</th><th className="th">Счёт</th>
                <th className="th">Статья / код</th><th className="th">Подразд.</th><th className="th">Контрагент</th>
                <th className="th text-right">Сумма</th><th className="th text-right">USD</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id} className="hover:bg-white/[0.02]">
                    <td className="td whitespace-nowrap">{fmtDate(t.doc_date)}</td>
                    <td className="td"><Badge tone={t.direction === "income" ? "emerald" : "rose"}>{t.direction === "income" ? "Приход" : "Расход"}</Badge></td>
                    <td className="td"><Badge tone="slate">{t.account === "bank" ? "Банк" : "Касса"}</Badge></td>
                    <td className="td max-w-[240px] truncate" title={t.category || ""}>
                      {(t.direction === "expense" ? t.expense_code : t.cashflow_code) && (
                        <span className="text-slate-500 mr-1">{t.direction === "expense" ? t.expense_code : t.cashflow_code}</span>
                      )}
                      {t.category || "—"}
                    </td>
                    <td className="td">{t.division ? <Badge tone="violet">{t.division}</Badge> : <span className="text-slate-600">—</span>}</td>
                    <td className="td max-w-[200px] truncate">{t.organization?.name || "—"}</td>
                    <td className="td text-right font-medium text-white whitespace-nowrap">{fmtNum(t.amount)} <span className="text-slate-500 text-xs">{t.currency}</span></td>
                    <td className={`td text-right font-semibold whitespace-nowrap ${t.direction === "income" ? "text-emerald-300" : "text-rose-300"}`}>{t.direction === "income" ? "+" : "−"}${fmtUSD2(t.amount_usd)}</td>
                    <td className="td text-right">{can("transactions:delete") && <button onClick={() => remove(t.id)} className="text-slate-500 hover:text-rose-300">✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Новая операция" width="max-w-xl">
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Дата"><input type="date" className="input" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></Field>
          <Field label="Тип">
            <select className="input" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
              <option value="income">Приход</option><option value="expense">Расход</option>
            </select>
          </Field>
          <Field label="Счёт">
            <select className="input" value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })}>
              <option value="bank">Банк</option><option value="kassa">Касса</option>
            </select>
          </Field>
          <Field label="Валюта">
            <select className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              <option value="UZS">UZS</option><option value="USD">USD</option>
            </select>
          </Field>
          <Field label="Сумма"><MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></Field>
          <Field label="Официальный курс на дату">
            <input
              className="input disabled:opacity-70"
              disabled
              value={form.currency === "USD" ? "— (USD)" : officialRate !== undefined ? `1$ = ${fmtNum(officialRate)} сум` : "не введён"}
            />
          </Field>
          {form.direction === "expense" && (
            <Field label="Статья расхода (код)">
              <SearchSelect value={form.expense_code} onChange={(v) => setForm({ ...form, expense_code: v })}
                options={(expCodes || []).map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
            </Field>
          )}
          <Field label="Код Cash Flow (ДДС)">
            <SearchSelect value={form.cashflow_code} onChange={(v) => setForm({ ...form, cashflow_code: v })}
              options={(cfCodes || []).map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
          </Field>
          <Field label="Подразделение">
            <SearchSelect value={form.division} onChange={(v) => setForm({ ...form, division: v })} placeholder="— общее —" emptyLabel="— общее —"
              options={(divs || []).map((d) => ({ value: d.name, label: d.name }))} />
          </Field>
          {form.account === "kassa" && (
            <Field label="Касса"><input className="input" value={form.cash_register} onChange={(e) => setForm({ ...form, cash_register: e.target.value })} placeholder="Офис касса" /></Field>
          )}
          <div className="col-span-2">
            <Field label="Контрагент">
              <SearchSelect value={String(form.organization_id || "")} onChange={(v) => setForm({ ...form, organization_id: v })} placeholder="— не указан —" emptyLabel="— не указан —"
                options={(orgs || []).map((o) => ({ value: String(o.id), label: o.inn ? `${o.name} · ${o.inn}` : o.name, search: `${o.name} ${o.inn || ""}` }))} />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Назначение / комментарий"><textarea className="input min-h-[42px] resize-y leading-snug" rows={2} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Напр.: Оплата за солярку" /></Field>
          </div>
        </div>

        {/* Rate gate: block save until the day's rate is entered */}
        {rateMissing ? (
          <div className="mt-4 rounded-xl bg-amber-500/10 border border-amber-500/30 p-4">
            <div className="flex items-center gap-2 text-amber-300 text-sm font-semibold">
              <span>⚠</span> Курс доллара на {new Date(form.doc_date).toLocaleDateString("ru-RU")} не введён
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Сумма в сумах не может быть переведена в USD. Введите официальный курс за эту дату, чтобы добавить операцию.
            </p>
            {can("exchange:create") ? (
              <div className="flex items-end gap-2 mt-3">
                <div className="flex-1">
                  <label className="label">Курс (1$ = … сум)</label>
                  <MoneyInput value={newRate} onChange={(v) => setNewRate(v)} placeholder="12550" />
                </div>
                <button className="btn-primary whitespace-nowrap" onClick={addRateForDate} disabled={savingRate || !Number(newRate)}>
                  {savingRate ? "…" : "Сохранить курс"}
                </button>
              </div>
            ) : (
              <p className="text-xs text-rose-300 mt-2">Обратитесь к бухгалтеру — у вас нет прав вводить курс.</p>
            )}
          </div>
        ) : (
          Number(form.amount) > 0 && (
            <div className="mt-4 text-sm text-slate-400">
              Эквивалент: <span className="text-emerald-300 font-semibold">${fmtUSD2(usdPreview)}</span>
            </div>
          )
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button>
          <button className="btn-primary" onClick={save} disabled={saving || rateMissing}>{saving ? "Сохранение…" : "Сохранить"}</button>
        </div>
      </Modal>
    </div>
  );
}
