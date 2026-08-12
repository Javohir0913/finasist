import { useState } from "react";
import api, { apiError } from "../api/client";
import ImportModal from "../components/ImportModal";
import { Badge, Card, EmptyState, Field, Modal, MoneyInput, SearchSelect, SectionTitle, Spinner } from "../components/ui";
import { fmtDate, fmtNum, fmtUSD2 } from "../lib/format";
import { LockedMark, LockedNotice, useLock } from "../lib/lock";
import { ExportButton, PeriodPicker, usePeriod, withPeriod } from "../lib/period";
import { FilterBar, sum, text, TotalRow, useFilter } from "../lib/table";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface Org { id: number; name: string; category: string; inn?: string; ledger?: string }
interface Code { id: number; code: string; name: string }
interface Div { id: number; name: string }
interface Acc { id: number; name: string }
interface Tx {
  id: number; doc_date: string; direction: string; account: string; currency: string;
  amount: number; rate: number; amount_usd: number; expense_code: string; cashflow_code: string;
  division: string; cash_register: string; category: string;
  bank_account_id: number | null; cash_register_id: number | null;
  doc_no: string; mfo: string; corr_account: string; corr_name: string; corr_inn: string;
  purpose: string; organization: Org | null; description: string;
}

interface Rate { rate_date: string; rate: number }
const empty = {
  doc_date: new Date().toISOString().slice(0, 10), direction: "income", account: "bank",
  currency: "UZS", amount: 0, expense_code: "", cashflow_code: "", division: "",
  cash_register: "", category: "", organization_id: "", description: "",
  bank_account_id: "", cash_register_id: "",
  doc_no: "", mfo: "", corr_account: "", corr_name: "", corr_inn: "", purpose: "",
};

export default function Transactions() {
  const { can } = useAuth();
  const { isLocked, minOpenDate, hint } = useLock();
  const [filter, setFilter] = useState("");
  const { qs: periodQs } = usePeriod();
  // лимит по умолчанию у бэка — 200 (последние по дате); реестр за период
  // может быть больше, поэтому явно просим всё — иначе часть операций
  // (обычно самые ранние в периоде) молча пропадала бы из таблицы и фильтров.
  const TX_LIMIT = 20000;
  const listUrl = withPeriod(
    "/transactions", periodQs,
    [filter ? `direction=${filter}` : "", `limit=${TX_LIMIT}`].filter(Boolean).join("&")
  );
  const { data, loading, reload } = useApi<Tx[]>(listUrl, [listUrl]);
  const maybeTruncated = (data?.length || 0) >= TX_LIMIT;
  const { data: orgs } = useApi<Org[]>("/organizations");
  const { data: expCodes } = useApi<Code[]>("/expense-codes");
  const { data: cfCodes } = useApi<Code[]>("/cashflow-codes");
  const { data: divs } = useApi<Div[]>("/divisions");
  const { data: banks } = useApi<Acc[]>("/bank-accounts");
  const { data: tills } = useApi<Acc[]>("/cash-registers");
  const { data: rates, reload: reloadRates } = useApi<Rate[]>("/exchange");
  const qs = periodQs;
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Tx | null>(null);
  const [details, setDetails] = useState(false);
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

  /**
   * Сумму можно вводить в любой валюте — вторая пересчитывается по курсу дня.
   * `currency` запоминает, какое поле заполнено вручную: оно и есть источник,
   * поэтому при изменении курса пересчитается именно производная сумма.
   */
  const rate = Number(officialRate || 0);
  const amount = Number(form.amount || 0);
  const uzsView = rate ? Math.round(amount * rate * 100) / 100 : 0;
  const usdView = rate ? Math.round((amount / rate) * 100) / 100 : 0;
  const setAmount = (cur: "UZS" | "USD", raw: string) =>
    setForm({ ...form, currency: cur, amount: raw });

  /**
   * Выплата зарплаты должна идти на «Ойлик(ОБЪЕКТ)» — иначе деньги уйдут из кассы,
   * но долг перед работниками в ведомости «Дт Кт З.п» так и останется висеть.
   */
  const salaryOrg = (orgs || []).find(
    (o) => o.ledger === "salary" && (o.inn || "").trim() === (form.division || "").trim()
  );
  const looksSalary = /ойли|зарплат|з\.п|oyli|ходимлар|maosh|маош/i.test(
    `${form.category || ""} ${form.description || ""}`
  );
  const salaryHint =
    form.direction === "expense" && looksSalary && salaryOrg && !form.organization_id
      ? salaryOrg
      : null;

  const expCodeName = (code: string) => expCodes?.find((c) => c.code === code)?.name || "";
  const cfCodeName = (code: string) => cfCodes?.find((c) => c.code === code)?.name || "";
  const f = useFilter<Tx>(
    data,
    (t) => text(t.doc_date, t.category, t.description, t.division, t.expense_code,
                t.cashflow_code, t.organization?.name, t.organization?.inn, t.amount),
    [
      { key: "account", label: "Счёт", of: (t) => (t.account === "bank" ? "Банк" : "Касса") },
      { key: "division", label: "Объект", of: (t) => t.division || "" },
      { key: "org", label: "Контрагент", of: (t) => t.organization?.name || "" },
      { key: "cur", label: "Валюта", of: (t) => t.currency || "" },
      { key: "expcode", label: "Статья расхода (код)", of: (t) => t.expense_code ? `${t.expense_code} · ${expCodeName(t.expense_code)}` : "" },
      { key: "cfcode", label: "Код Cash Flow (ДДС)", of: (t) => t.cashflow_code ? `${t.cashflow_code} · ${cfCodeName(t.cashflow_code)}` : "" },
    ]
  );
  const inUsd = sum(f.rows.filter((t) => t.direction === "income"), "amount_usd");
  const outUsd = sum(f.rows.filter((t) => t.direction === "expense"), "amount_usd");

  const addRateForDate = async () => {
    setSavingRate(true);
    try {
      await api.post("/exchange", { rate_date: form.doc_date, rate: Number(newRate) });
      setNewRate("");
      await reloadRates();
    } catch (e) { setErr(apiError(e)); } finally { setSavingRate(false); }
  };

  const openNew = () => { setEditing(null); setForm(empty); setDetails(false); setErr(""); setOpen(true); };
  const openEdit = (t: Tx) => {
    setEditing(t);
    setForm({
      ...empty, ...t,
      organization_id: t.organization ? String(t.organization.id) : "",
      bank_account_id: t.bank_account_id ? String(t.bank_account_id) : "",
      cash_register_id: t.cash_register_id ? String(t.cash_register_id) : "",
    });
    setDetails(Boolean(t.doc_no || t.mfo || t.corr_account || t.corr_name || t.purpose));
    setErr(""); setOpen(true);
  };

  /**
   * Код ДДС обязателен: без него операция не попадёт ни в одну строку отчёта
   * Cash Flow и повиснет в «Без кода». Статья расхода — необязательна: в книге
   * она заполняется только на прямые платежи (комиссии банка и т.п.), а по
   * материалам и услугам расход уже приходит со своего документа.
   */
  const cfMissing = !String(form.cashflow_code || "").trim();

  const save = async () => {
    if (rateMissing || cfMissing || isLocked(form.doc_date)) return;
    setErr(""); setSaving(true);
    const body = {
      ...form,
      amount: Number(form.amount),
      organization_id: form.organization_id ? Number(form.organization_id) : null,
      bank_account_id: form.bank_account_id ? Number(form.bank_account_id) : null,
      cash_register_id: form.cash_register_id ? Number(form.cash_register_id) : null,
    };
    delete body.organization;
    delete body.id;
    delete body.amount_usd;
    delete body.amount_uzs;
    delete body.created_at;
    try {
      if (editing) await api.put(`/transactions/${editing.id}`, body);
      else await api.post("/transactions", body);
      setOpen(false); setForm(empty); setEditing(null); reload();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };

  const remove = async (id: number) => {
    if (!confirm("Удалить операцию?")) return;
    try { await api.delete(`/transactions/${id}`); reload(); }
    catch (e) { alert(apiError(e)); }
  };

  return (
    <div>
      <SectionTitle
        title="Банк и Касса · Cash Flow"
        sub="Движение денежных средств по банку и кассе, UZS / USD"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodPicker />
            <ExportButton url={withPeriod("/export/registry/transactions", qs)} label="Реестр в Excel" />
            {can("transactions:create") && <button className="btn-ghost" onClick={() => setImporting(true)}>↑ Из Excel</button>}
            {can("transactions:create") && <button className="btn-primary" onClick={openNew}>+ Новая операция</button>}
          </div>
        }
      />

      <div className="flex gap-2 mb-4">
        {[["", "Все"], ["income", "Приход"], ["expense", "Расход"]].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)} className={`chip ${filter === v ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-veil/5 text-slate-400 border border-line"}`}>{l}</button>
        ))}
      </div>

      {maybeTruncated && (
        <div className="mb-3 rounded-xl bg-amber-500/12 border border-amber-500/25 text-amber-300 text-sm px-3.5 py-2.5">
          Операций за выбранный период очень много (≥{TX_LIMIT.toLocaleString("ru")}) — часть могла не загрузиться.
          Сузьте период (конкретный месяц вместо «весь год»), чтобы увидеть все.
        </div>
      )}
      {!loading && !!data?.length && <FilterBar f={f} placeholder="Дата, статья, контрагент, сумма…" />}

      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Операции не найдены" /> :
         !f.rows.length ? <EmptyState text="Под фильтр ничего не подошло" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px]">
              <thead><tr className="bg-veil/[0.02]">
                <th className="th">Дата</th><th className="th">Тип</th><th className="th">Счёт</th>
                <th className="th">Статья / код</th><th className="th">Подразд.</th><th className="th">Контрагент</th>
                <th className="th text-right">Сумма</th><th className="th text-right">USD</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {f.rows.map((t) => (
                  <tr key={t.id} className="hover:bg-veil/[0.02]">
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
                    <td className="td text-right font-medium text-ink whitespace-nowrap">{fmtNum(t.amount)} <span className="text-slate-500 text-xs">{t.currency}</span></td>
                    <td className={`td text-right font-semibold whitespace-nowrap ${t.direction === "income" ? "text-emerald-300" : "text-rose-300"}`}>{t.direction === "income" ? "+" : "−"}${fmtUSD2(t.amount_usd)}</td>
                    <td className="td text-right whitespace-nowrap">
                      {isLocked(t.doc_date) ? <LockedMark title={hint} /> : <>
                        {can("transactions:edit") && <button onClick={() => openEdit(t)} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                        {can("transactions:delete") && <button onClick={() => remove(t.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* суммы в разных валютах не складываем — итог только в USD */}
              <TotalRow
                cells={[null, null, null, null,
                        `+$${fmtUSD2(inUsd)} / −$${fmtUSD2(outUsd)}`,
                        null,
                        `${inUsd - outUsd < 0 ? "−" : ""}$${fmtUSD2(Math.abs(inUsd - outUsd))}`,
                        null]}
              />
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Операция №${editing.id}` : "Новая операция"} width="max-w-2xl">
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <LockedNotice date={form.doc_date} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Дата"><input type="date" min={minOpenDate || undefined} className="input" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></Field>
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
          <Field label="Официальный курс на дату">
            <input
              className="input disabled:opacity-70"
              disabled
              value={officialRate !== undefined ? `1$ = ${fmtNum(officialRate)} сум` : "не введён"}
            />
          </Field>
          <Field label="Сумма в сумах">
            <MoneyInput value={form.currency === "UZS" ? form.amount : uzsView}
              onChange={(v) => setAmount("UZS", v)} />
          </Field>
          <Field label="Сумма в долларах">
            <MoneyInput value={form.currency === "USD" ? form.amount : usdView}
              onChange={(v) => setAmount("USD", v)} />
          </Field>
          {form.direction === "expense" && (
            <Field label="Статья расхода (код)">
              <SearchSelect value={form.expense_code} onChange={(v) => setForm({ ...form, expense_code: v })}
                options={(expCodes || []).map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
            </Field>
          )}
          <Field label="Код Cash Flow (ДДС) *">
            <SearchSelect value={form.cashflow_code} onChange={(v) => setForm({ ...form, cashflow_code: v })}
              options={(cfCodes || []).map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
            {cfMissing && (
              <p className="mt-1 text-xs text-amber-300">
                Обязательно — без кода операция не попадёт в отчёт Cash Flow
              </p>
            )}
          </Field>
          <Field label="Подразделение">
            <SearchSelect value={form.division} onChange={(v) => setForm({ ...form, division: v })} placeholder="— общее —" emptyLabel="— общее —"
              options={(divs || []).map((d) => ({ value: d.name, label: d.name }))} />
          </Field>
          {form.account === "bank" ? (
            <Field label="Банковский счёт">
              <SearchSelect value={String(form.bank_account_id || "")} onChange={(v) => setForm({ ...form, bank_account_id: v })} placeholder="— не указан —" emptyLabel="— не указан —"
                options={(banks || []).map((b) => ({ value: String(b.id), label: b.name }))} />
            </Field>
          ) : (
            <Field label="Касса">
              <SearchSelect value={String(form.cash_register_id || "")} onChange={(v) => setForm({ ...form, cash_register_id: v })} placeholder="— не указана —" emptyLabel="— не указана —"
                options={(tills || []).map((c) => ({ value: String(c.id), label: c.name }))} />
            </Field>
          )}
          <div className="col-span-2">
            <Field label="Контрагент">
              <SearchSelect value={String(form.organization_id || "")} onChange={(v) => setForm({ ...form, organization_id: v })} placeholder="— не указан —" emptyLabel="— не указан —"
                options={(orgs || []).map((o) => ({ value: String(o.id), label: o.inn ? `${o.name} · ${o.inn}` : o.name, search: `${o.name} ${o.inn || ""}` }))} />
            </Field>
            {salaryHint && (
              <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                Похоже на выплату зарплаты. Без контрагента{" "}
                <b>{salaryHint.name}</b> сумма уйдёт из кассы, но долг перед работниками
                в ведомости «Дт Кт З.п» не погасится.{" "}
                <button type="button" className="underline hover:text-amber-100"
                  onClick={() => setForm({ ...form, organization_id: String(salaryHint.id) })}>
                  Подставить
                </button>
              </div>
            )}
          </div>
          <div className="col-span-2">
            <Field label="Назначение / комментарий"><textarea className="input min-h-[42px] resize-y leading-snug" rows={2} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Напр.: Оплата за солярку" /></Field>
          </div>

          <div className="col-span-2">
            <button type="button" className="text-sm text-slate-400 hover:text-accent-soft" onClick={() => setDetails((d) => !d)}>
              {details ? "▾" : "▸"} Реквизиты банковской выписки
            </button>
          </div>
          {details && (
            <>
              <Field label="№ документа"><input className="input" value={form.doc_no} onChange={(e) => setForm({ ...form, doc_no: e.target.value })} /></Field>
              <Field label="МФО корреспондента"><input className="input" value={form.mfo} onChange={(e) => setForm({ ...form, mfo: e.target.value })} /></Field>
              <Field label="Счёт корреспондента"><input className="input" value={form.corr_account} onChange={(e) => setForm({ ...form, corr_account: e.target.value })} /></Field>
              <Field label="ИНН по данным банка"><input className="input" value={form.corr_inn} onChange={(e) => setForm({ ...form, corr_inn: e.target.value })} /></Field>
              <Field label="Наименование корреспондента"><input className="input" value={form.corr_name} onChange={(e) => setForm({ ...form, corr_name: e.target.value })} /></Field>
              <Field label="Назначение по кодировке"><input className="input" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></Field>
              <div className="col-span-2">
                <Field label="Наименование платежа (из выписки)">
                  <textarea className="input min-h-[42px] resize-y leading-snug" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </Field>
              </div>
            </>
          )}
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
              Введено в <b className="text-slate-300">{form.currency}</b>, вторая сумма
              пересчитана по курсу дня. Эквивалент:{" "}
              <span className="text-emerald-300 font-semibold">${fmtUSD2(usdPreview)}</span>
            </div>
          )
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button>
          <button className="btn-primary" onClick={save} disabled={saving || rateMissing || cfMissing}
            title={cfMissing ? "Заполните код Cash Flow (ДДС)" : undefined}>{saving ? "Сохранение…" : "Сохранить"}</button>
        </div>
      </Modal>

      <ImportModal kind="transactions" open={importing} onClose={() => setImporting(false)} onDone={reload} />
    </div>
  );
}
