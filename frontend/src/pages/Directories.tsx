import { useState } from "react";
import api, { apiError } from "../api/client";
import { Card, EmptyState, Field, MoneyInput, SectionTitle, Spinner } from "../components/ui";
import { fmtDate, fmtMoney, fmtNum } from "../lib/format";
import { toUsd, toUzs, useOpeningRate } from "../lib/rate";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface Code { id: number; code: string; name: string; pnl_group: string; activity: string }
interface Div { id: number; name: string }
interface Lookups { pnlGroups: { key: string; label: string }[]; cfActivities: { key: string; label: string }[] }
interface Bank {
  id: number; name: string; account_no: string; bank_name: string; mfo: string;
  currency: string; opening_uzs: number; opening_usd: number; is_active: boolean;
}
interface Till {
  id: number; name: string; division: string; currency: string;
  opening_uzs: number; opening_usd: number; is_active: boolean;
}

const TABS = [
  { k: "expense-codes", label: "Статьи расходов" },
  { k: "cashflow-codes", label: "Коды Cash Flow" },
  { k: "divisions", label: "Подразделения" },
  { k: "bank-accounts", label: "Банковские счета" },
  { k: "cash-registers", label: "Кассы" },
];

export default function Directories() {
  const { can } = useAuth();
  const [tab, setTab] = useState("expense-codes");
  const [q, setQ] = useState("");
  const canEdit = can("articles:create");
  const canDel = can("articles:delete");

  return (
    <div>
      <SectionTitle
        title="Справочники"
        sub="Статьи расходов, коды Cash Flow, подразделения, банковские счета и кассы — выбираются при вводе операций"
      />
      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => { setTab(t.k); setQ(""); }} className={`chip ${tab === t.k ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-veil/5 text-slate-400 border border-line"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "divisions" ? <Divisions canEdit={canEdit} canDel={canDel} />
        : tab === "bank-accounts" ? <BankAccounts canEdit={canEdit} canDel={canDel} />
        : tab === "cash-registers" ? <CashRegisters canEdit={canEdit} canDel={canDel} />
        : <CodeTable key={tab} kind={tab} q={q} setQ={setQ} canEdit={canEdit} canDel={canDel} />}
    </div>
  );
}

/** Остаток введён, а дата — нет: такой остаток учесть нельзя. */
export const openingDateMissing = (form: any) =>
  !!(Number(form.opening_uzs || 0) || Number(form.opening_usd || 0)) && !form.opening_date;

/**
 * Пара полей «сум ↔ USD» и дата остатка: заполняем любую сумму, вторая
 * считается по курсу; дата говорит, НА какой момент остаток зафиксирован.
 *
 * В книге лист «ОСТАТОК USD» не заполняется руками — каждая его ячейка это
 * «ОСТАТОК UZS» ÷ «Курс доллара» на ту же дату. Поэтому для денег сум и
 * доллары — ОДНА И ТА ЖЕ сумма в двух представлениях.
 */
function OpeningPair({ form, setForm, rate }: {
  form: any; setForm: (f: any) => void; rate: number;
}) {
  const set = (field: "opening_uzs" | "opening_usd", v: any) => {
    const n = Number(v || 0);
    if (!rate) { setForm({ ...form, [field]: n }); return; }
    setForm(field === "opening_uzs"
      ? { ...form, opening_uzs: n, opening_usd: toUsd(n, rate) }
      : { ...form, opening_usd: n, opening_uzs: toUzs(n, rate) });
  };
  const dateMissing = openingDateMissing(form);
  return (
    <>
      <Field label="Остаток на начало, сум">
        <MoneyInput value={form.opening_uzs} onChange={(v) => set("opening_uzs", v)} />
      </Field>
      <Field label={rate ? "…он же в USD (по курсу)" : "Остаток на начало, USD"}>
        <MoneyInput value={form.opening_usd} onChange={(v) => set("opening_usd", v)} />
      </Field>
      <Field label="Дата остатка *">
        <input type="date" className="input" value={form.opening_date || ""}
          onChange={(e) => setForm({ ...form, opening_date: e.target.value })} />
        {dateMissing && (
          <p className="mt-1 text-xs text-amber-300">
            Обязательно: на какую дату зафиксирован остаток
          </p>
        )}
      </Field>
    </>
  );
}

function RateNote({ rate, date }: { rate: number; date: string }) {
  return (
    <p className="text-[11px] text-slate-500 mt-3">
      {rate ? (
        <>
          Сум и доллары — <b>одна и та же сумма</b>, а не два разных остатка:
          заполните любое поле, второе пересчитается по курсу{" "}
          <b className="text-slate-300">1$ = {fmtNum(rate)} сум</b> на {fmtDate(date)}.
          Так же устроена книга: лист «ОСТАТОК USD» — это «ОСТАТОК UZS» ÷ курс.
        </>
      ) : (
        <>
          Курс доллара не заведён — автопересчёт сум ↔ USD недоступен.
          Добавьте курс в разделе «Курс доллара», и поля начнут считаться сами.
        </>
      )}
    </p>
  );
}

/** Входящее сальдо счетов и касс — «Остаток на начало» листа «ОСТАТОК UZS». */
function BankAccounts({ canEdit, canDel }: { canEdit: boolean; canDel: boolean }) {
  const { data, loading, reload } = useApi<Bank[]>("/bank-accounts");
  const { rate, date } = useOpeningRate();
  const empty = { name: "", account_no: "", bank_name: "", mfo: "", currency: "UZS", opening_uzs: 0, opening_usd: 0, opening_date: "" };
  const [form, setForm] = useState<any>(empty);
  const [edit, setEdit] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    try {
      if (edit) await api.put(`/bank-accounts/${edit}`, form);
      else await api.post("/bank-accounts", form);
      setForm(empty); setEdit(null); reload();
    } catch (e) { setErr(apiError(e)); }
  };
  const remove = async (id: number) => {
    if (!confirm("Удалить банковский счёт?")) return;
    try { await api.delete(`/bank-accounts/${id}`); reload(); }
    catch (e) { setErr(apiError(e)); }
  };

  return (
    <>
      {canEdit && (
        <Card className="mb-4">
          {err && <div className="mb-3 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="Наименование счёта"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Расчётный счёт"><input className="input" value={form.account_no} onChange={(e) => setForm({ ...form, account_no: e.target.value })} /></Field>
            <Field label="Банк"><input className="input" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></Field>
            <Field label="МФО"><input className="input" value={form.mfo} onChange={(e) => setForm({ ...form, mfo: e.target.value })} /></Field>
            <OpeningPair form={form} setForm={setForm} rate={rate} />
            <div className="flex items-end gap-2">
              <button className="btn-primary" onClick={save}
                disabled={!form.name || openingDateMissing(form)}
                title={openingDateMissing(form) ? "Укажите дату остатка" : undefined}>{edit ? "Сохранить" : "+ Добавить"}</button>
              {edit && <button className="btn-ghost" onClick={() => { setForm(empty); setEdit(null); }}>Отмена</button>}
            </div>
          </div>
          <RateNote rate={rate} date={date} />
        </Card>
      )}
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Счета не заведены" /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className="th">Наименование</th><th className="th">Расчётный счёт</th>
                <th className="th">Банк</th><th className="th">МФО</th>
                <th className="th text-right">Остаток на начало, сум</th>
                <th className="th text-right">Остаток на начало, USD</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {data.map((b) => (
                  <tr key={b.id} className="hover:bg-veil/[0.02]">
                    <td className="td text-ink">{b.name}</td>
                    <td className="td font-mono text-slate-400">{b.account_no || "—"}</td>
                    <td className="td text-slate-400">{b.bank_name || "—"}</td>
                    <td className="td font-mono text-slate-400">{b.mfo || "—"}</td>
                    <td className="td text-right tabular-nums">{fmtMoney(b.opening_uzs)}</td>
                    <td className="td text-right tabular-nums">{fmtMoney(b.opening_usd)}</td>
                    <td className="td text-right whitespace-nowrap">
                      {canEdit && <button className="text-slate-500 hover:text-accent-soft mr-3" onClick={() => { setEdit(b.id); setForm({ ...b }); }}>✎</button>}
                      {canDel && <button className="text-slate-500 hover:text-rose-300" onClick={() => remove(b.id)}>✕</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function CashRegisters({ canEdit, canDel }: { canEdit: boolean; canDel: boolean }) {
  const { data, loading, reload } = useApi<Till[]>("/cash-registers");
  const { data: divs } = useApi<Div[]>("/divisions");
  const { rate, date } = useOpeningRate();
  const empty = { name: "", division: "", currency: "UZS", opening_uzs: 0, opening_usd: 0, opening_date: "" };
  const [form, setForm] = useState<any>(empty);
  const [edit, setEdit] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    try {
      if (edit) await api.put(`/cash-registers/${edit}`, form);
      else await api.post("/cash-registers", form);
      setForm(empty); setEdit(null); reload();
    } catch (e) { setErr(apiError(e)); }
  };
  const remove = async (id: number) => {
    if (!confirm("Удалить кассу?")) return;
    try { await api.delete(`/cash-registers/${id}`); reload(); }
    catch (e) { setErr(apiError(e)); }
  };

  return (
    <>
      {canEdit && (
        <Card className="mb-4">
          {err && <div className="mb-3 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="Название кассы"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Подразделение">
              <select className="input" value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })}>
                <option value="">— не указано —</option>
                {divs?.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
            <OpeningPair form={form} setForm={setForm} rate={rate} />
            <div className="flex items-end gap-2">
              <button className="btn-primary" onClick={save}
                disabled={!form.name || openingDateMissing(form)}
                title={openingDateMissing(form) ? "Укажите дату остатка" : undefined}>{edit ? "Сохранить" : "+ Добавить"}</button>
              {edit && <button className="btn-ghost" onClick={() => { setForm(empty); setEdit(null); }}>Отмена</button>}
            </div>
          </div>
          <RateNote rate={rate} date={date} />
        </Card>
      )}
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Кассы не заведены" /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className="th">Название</th><th className="th">Подразделение</th>
                <th className="th text-right">Остаток на начало, сум</th>
                <th className="th text-right">Остаток на начало, USD</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id} className="hover:bg-veil/[0.02]">
                    <td className="td text-ink">{c.name}</td>
                    <td className="td text-slate-400">{c.division || "—"}</td>
                    <td className="td text-right tabular-nums">{fmtMoney(c.opening_uzs)}</td>
                    <td className="td text-right tabular-nums">{fmtMoney(c.opening_usd)}</td>
                    <td className="td text-right whitespace-nowrap">
                      {canEdit && <button className="text-slate-500 hover:text-accent-soft mr-3" onClick={() => { setEdit(c.id); setForm({ ...c }); }}>✎</button>}
                      {canDel && <button className="text-slate-500 hover:text-rose-300" onClick={() => remove(c.id)}>✕</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** Статьи расходов и коды ДДС. У статьи задаётся строка ОФР, у кода ДДС — раздел
 *  отчёта о движении денежных средств: от этого зависят «Отчёты». */
function CodeTable({ kind, q, setQ, canEdit, canDel }: { kind: string; q: string; setQ: (s: string) => void; canEdit: boolean; canDel: boolean }) {
  const { data, loading, reload } = useApi<Code[]>(`/${kind}`);
  const { data: lk } = useApi<Lookups>("/lookups");
  const isExpense = kind === "expense-codes";
  const field = isExpense ? "pnl_group" : "activity";
  const options = (isExpense ? lk?.pnlGroups : lk?.cfActivities) || [];
  const label = (v: string) => options.find((o) => o.key === v)?.label ?? v;
  const empty = { code: "", name: "", pnl_group: "admin", activity: "operating" };
  const [form, setForm] = useState<any>(empty);
  const [err, setErr] = useState("");
  const filtered = data?.filter((c) => !q || c.code.includes(q) || c.name.toLowerCase().includes(q.toLowerCase()));

  const add = async () => {
    setErr("");
    const body: any = { code: form.code, name: form.name };
    body[field] = form[field];
    try { await api.post(`/${kind}`, body); setForm(empty); reload(); }
    catch (e) { setErr(apiError(e)); }
  };
  const setGroup = async (c: Code, value: string) => {
    setErr("");
    try { await api.put(`/${kind}/${c.id}`, { [field]: value }); reload(); }
    catch (e) { setErr(apiError(e)); }
  };
  const remove = async (id: number) => {
    if (!confirm("Удалить код?")) return;
    try { await api.delete(`/${kind}/${id}`); reload(); }
    catch (e) { setErr(apiError(e)); }
  };

  return (
    <>
      {err && <div className="mb-3 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
      {canEdit && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-32"><Field label="Код"><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field></div>
            <div className="flex-1 min-w-[200px]"><Field label="Наименование"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
            <div className="min-w-[260px]">
              <Field label={isExpense ? "Строка ОФР" : "Раздел ДДС"}>
                <select className="input" value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })}>
                  {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </Field>
            </div>
            <button className="btn-primary" onClick={add} disabled={!form.code || !form.name}>+ Добавить</button>
          </div>
        </Card>
      )}
      <Card className="!p-0 overflow-hidden">
        <div className="p-3 border-b border-line">
          <input className="input max-w-sm" placeholder="Поиск по коду или названию…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="text-xs text-slate-500 ml-3">{filtered?.length ?? 0} из {data?.length ?? 0}</span>
          <span className="text-xs text-slate-500 ml-3">
            {isExpense
              ? "Строка ОФР определяет, куда попадёт статья в «Форме №2»."
              : "Раздел определяет, в какой блок отчёта ДДС попадёт код."}
          </span>
        </div>
        {loading ? <Spinner /> : !filtered?.length ? <EmptyState text="Ничего не найдено" /> : (
          <div className="overflow-x-auto max-h-[60vh]">
            <table className="w-full">
              <thead className="sticky top-0 bg-base-850"><tr>
                <th className="th w-32">Код</th><th className="th">Наименование</th>
                <th className="th w-72">{isExpense ? "Строка ОФР" : "Раздел ДДС"}</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-veil/[0.02]">
                    <td className="td font-mono text-slate-300">{c.code}</td>
                    <td className="td">{c.name}</td>
                    <td className="td">
                      {canEdit ? (
                        <select className="input !py-1 text-xs" value={(c as any)[field] || ""} onChange={(e) => setGroup(c, e.target.value)}>
                          {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                        </select>
                      ) : (
                        <span className="text-slate-400 text-xs">{label((c as any)[field])}</span>
                      )}
                    </td>
                    <td className="td text-right">{canDel && <button onClick={() => remove(c.id)} className="text-slate-500 hover:text-rose-300">✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** Подразделения (объекты): Махстон, Турк, Жби, Офис, Помпа… — их выбирают
 *  в операциях, приходе, производстве, продажах, услугах и у сотрудников. */
function Divisions({ canEdit, canDel }: { canEdit: boolean; canDel: boolean }) {
  const { data, loading, reload } = useApi<Div[]>("/divisions");
  const [name, setName] = useState("");
  const [edit, setEdit] = useState<Div | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");

  const add = async () => {
    setErr("");
    try { await api.post("/divisions", { name }); setName(""); reload(); }
    catch (e) { setErr(apiError(e)); }
  };
  const rename = async () => {
    if (!edit) return;
    setErr("");
    try { await api.put(`/divisions/${edit.id}`, { name: draft }); setEdit(null); reload(); }
    catch (e) { setErr(apiError(e)); }
  };
  const remove = async (id: number) => {
    if (!confirm("Удалить подразделение?")) return;
    setErr("");
    try { await api.delete(`/divisions/${id}`); reload(); }
    catch (e) { setErr(apiError(e)); }
  };

  return (
    <>
      {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
      {canEdit && (
        <Card className="mb-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-xs">
              <Field label="Название подразделения">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && name && add()} placeholder="Напр.: Помпа" />
              </Field>
            </div>
            <button className="btn-primary" onClick={add} disabled={!name}>+ Добавить</button>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Переименование автоматически обновит подразделение во всех документах.
            Удалить можно только то, что нигде не используется.
          </p>
        </Card>
      )}
      {loading ? <Spinner /> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data?.map((d) => (
            <Card key={d.id} className="flex items-center justify-between gap-2 !p-4">
              {edit?.id === d.id ? (
                <>
                  <input className="input !py-1.5" autoFocus value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") setEdit(null); }} />
                  <div className="flex gap-1 shrink-0">
                    <button onClick={rename} className="text-emerald-300 hover:text-emerald-200">✓</button>
                    <button onClick={() => setEdit(null)} className="text-slate-500 hover:text-ink">✕</button>
                  </div>
                </>
              ) : (
                <>
                  <span className="font-semibold text-ink truncate">{d.name}</span>
                  <div className="flex gap-2 shrink-0">
                    {canEdit && <button onClick={() => { setEdit(d); setDraft(d.name); setErr(""); }} className="text-slate-500 hover:text-accent-soft">✎</button>}
                    {canDel && <button onClick={() => remove(d.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
