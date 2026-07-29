import { useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Field, Modal, MoneyInput, SearchSelect, SectionTitle, Spinner } from "../components/ui";
import { fmtNum } from "../lib/format";
import { ExportButton } from "../lib/period";
import { FilterBar, sum, text, TotalRow, useFilter, uzs } from "../lib/table";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface Emp {
  id: number; full_name: string; inn: string; division: string; department: string;
  position: string; category: string; group: string; status: string; state: string;
  hire_date: string | null; expense_code: string; payment_type: string; currency: string;
  salary: number; is_active: boolean;
}
interface Div { id: number; name: string }
interface Code { id: number; code: string; name: string }
interface Lookups {
  payCategories: string[]; payGroups: string[]; payStatuses: string[];
  payStates: string[]; departments: string[];
}
interface PE {
  id: number; period: string; currency: string;
  pay_mode: string; avans_type: string;
  norm_days: number; worked_days: number; overtime_days: number; debt_start: number;
  oklad: number; nadbavka: number; pitanie: number; bonus: number; benzin: number; other_accrued: number;
  hold_pitanie: number; hold_alimony: number; hold_other: number; fine: number;
  avans: number; paid_cash: number; paid_card: number;
  gross: number; ndfl: number; inps: number; esp: number; withheld: number;
  net: number; paid: number; balance: number; total_cost: number;
  employee: Emp | null;
}
interface Summary {
  rows: any[];
  totals: Record<string, number>;
}

export default function Payroll() {
  const [tab, setTab] = useState("payroll");
  return (
    <div>
      <SectionTitle title="Зарплата" sub="Расчёт по методике листа «Зарплата»: начисления, удержания, выплаты и долг" />
      <div className="flex gap-2 mb-4">
        {[["payroll", "Расчёт зарплаты"], ["summary", "Свод по объектам"], ["employees", "Сотрудники"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`chip ${tab === k ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-white/5 text-slate-400 border border-line"}`}>{l}</button>
        ))}
      </div>
      {tab === "employees" ? <Employees /> : tab === "summary" ? <SummaryTab /> : <PayrollTab />}
    </div>
  );
}

function Employees() {
  const { can } = useAuth();
  const { data, loading, reload } = useApi<Emp[]>("/employees");
  const { data: divs } = useApi<Div[]>("/divisions");
  const { data: expCodes } = useApi<Code[]>("/expense-codes");
  const { data: lk } = useApi<Lookups>("/lookups");
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<Emp | null>(null);
  const empty = {
    full_name: "", inn: "", division: "", department: "", position: "", category: "",
    group: "", status: "", state: "Работает", hire_date: "", expense_code: "",
    payment_type: "Карта", currency: "UZS", salary: 0, is_active: true,
  };
  const [form, setForm] = useState<any>(empty); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const save = async () => {
    setErr(""); setSaving(true);
    const body = { ...form, salary: Number(form.salary), hire_date: form.hire_date || null };
    try { if (editing) await api.put(`/employees/${editing.id}`, body); else await api.post("/employees", body); setOpen(false); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (e: Emp) => { if (confirm("Удалить сотрудника?")) { try { await api.delete(`/employees/${e.id}`); reload(); } catch (x) { alert(apiError(x)); } } };
  const opts = (list?: string[]) => (list || []).map((x) => ({ value: x, label: x }));
  const f = useFilter<Emp>(
    data,
    (e) => text(e.full_name, e.division, e.department, e.position, e.category, e.state, e.salary),
    [
      { key: "div", label: "Подразд.", of: (e) => e.division || "" },
      { key: "dep", label: "Отдел", of: (e) => e.department || "" },
      { key: "state", label: "Состояние", of: (e) => e.state || "" },
      { key: "pay", label: "Оплата", of: (e) => e.payment_type || "" },
    ]
  );
  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        {can("payroll:create") && <button className="btn-primary" onClick={() => { setEditing(null); setForm(empty); setErr(""); setOpen(true); }}>+ Сотрудник</button>}
        <ExportButton url="/export/registry/employees" label="Список в Excel" />
      </div>
      {!loading && !!data?.length && <FilterBar f={f} placeholder="ФИО, должность, отдел…" />}
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Нет сотрудников" /> :
         !f.rows.length ? <EmptyState text="Под фильтр ничего не подошло" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[1080px]">
            <thead><tr className="bg-white/[0.02]">
              <th className="th">ФИО</th><th className="th">Подразд.</th><th className="th">Отдел</th>
              <th className="th">Должность</th><th className="th">Категория</th><th className="th">Состояние</th>
              <th className="th">Оплата</th><th className="th text-right">Оклад</th><th className="th"></th>
            </tr></thead>
            <tbody>{f.rows.map((e) => (
              <tr key={e.id} className="hover:bg-white/[0.02]">
                <td className="td text-white">{e.full_name}{!e.is_active && <span className="text-slate-600 text-xs ml-2">(неактивен)</span>}</td>
                <td className="td">{e.division ? <Badge tone="violet">{e.division}</Badge> : "—"}</td>
                <td className="td">{e.department || "—"}</td><td className="td">{e.position || "—"}</td>
                <td className="td text-slate-400 text-xs">{e.category || "—"}</td>
                <td className="td text-slate-400 text-xs">{e.state || "—"}</td>
                <td className="td"><Badge tone="slate">{e.payment_type}</Badge></td>
                <td className="td text-right tabular-nums">{fmtNum(e.salary)}</td>
                <td className="td text-right whitespace-nowrap">
                  {can("payroll:edit") && <button onClick={() => { setEditing(e); setForm({ ...e, hire_date: e.hire_date || "" }); setErr(""); setOpen(true); }} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                  {can("payroll:delete") && <button onClick={() => remove(e)} className="text-slate-500 hover:text-rose-300">✕</button>}
                </td>
              </tr>))}</tbody>
            <TotalRow label={`Итого: ${f.rows.length} чел.`}
              cells={[null, null, null, null, null, null, uzs(sum(f.rows, "salary")), null]} />
          </table></div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Редактировать сотрудника" : "Новый сотрудник"} width="max-w-2xl">
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="ФИО"><input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field></div>
          <Field label="ИНН сотрудника"><input className="input" value={form.inn} onChange={(e) => setForm({ ...form, inn: e.target.value })} /></Field>
          <Field label="Дата приёма на работу"><input type="date" className="input" value={form.hire_date || ""} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} /></Field>
          <Field label="Объект / подразделение"><SearchSelect value={form.division} onChange={(v) => setForm({ ...form, division: v })} placeholder="—" emptyLabel="—" options={opts(divs?.map((d) => d.name))} /></Field>
          <Field label="Отдел"><SearchSelect value={form.department} onChange={(v) => setForm({ ...form, department: v })} placeholder="—" emptyLabel="—" options={opts(lk?.departments)} /></Field>
          <Field label="Должность"><input className="input" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></Field>
          <Field label="Категория"><SearchSelect value={form.category} onChange={(v) => setForm({ ...form, category: v })} placeholder="—" emptyLabel="—" options={opts(lk?.payCategories)} /></Field>
          <Field label="Группа (профессия)"><SearchSelect value={form.group} onChange={(v) => setForm({ ...form, group: v })} placeholder="—" emptyLabel="—" options={opts(lk?.payGroups)} /></Field>
          <Field label="Статус"><SearchSelect value={form.status} onChange={(v) => setForm({ ...form, status: v })} placeholder="—" emptyLabel="—" options={opts(lk?.payStatuses)} /></Field>
          <Field label="Состояние"><SearchSelect value={form.state} onChange={(v) => setForm({ ...form, state: v })} placeholder="—" emptyLabel="—" options={opts(lk?.payStates)} /></Field>
          <Field label="Способ выплаты"><select className="input" value={form.payment_type} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}><option>Карта</option><option>Касса</option></select></Field>
          <Field label="Код расхода"><SearchSelect value={form.expense_code} onChange={(v) => setForm({ ...form, expense_code: v })} placeholder="—" emptyLabel="—" options={(expCodes || []).map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} /></Field>
          <Field label="Валюта оклада"><select className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}><option>UZS</option><option>USD</option></select></Field>
          <Field label="Оклад"><MoneyInput value={form.salary} onChange={(v) => setForm({ ...form, salary: v })} /></Field>
          <div className="col-span-2 flex items-center gap-2"><input id="eact" type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="h-4 w-4 accent-[#5b8cff]" /><label htmlFor="eact" className="text-sm text-slate-300">Активен</label></div>
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving || !form.full_name}>Сохранить</button></div>
      </Modal>
    </>
  );
}

const PAY_FIELDS = [
  { k: "norm_days", l: "Норма дней", grp: "days" },
  { k: "worked_days", l: "Отработано дней", grp: "days" },
  { k: "overtime_days", l: "Сверхурочные дни", grp: "days" },
  { k: "debt_start", l: "Задолженность на начало", grp: "days" },
  { k: "oklad", l: "Оклад (на руки)", grp: "accrual" },
  { k: "nadbavka", l: "Надбавка", grp: "accrual" },
  { k: "pitanie", l: "Питание", grp: "accrual" },
  { k: "bonus", l: "Премия", grp: "accrual" },
  { k: "benzin", l: "Бензин пули", grp: "accrual" },
  { k: "other_accrued", l: "Прочие начисления", grp: "accrual" },
  { k: "hold_pitanie", l: "Удержание за питание", grp: "hold" },
  { k: "hold_alimony", l: "Алименты", grp: "hold" },
  { k: "hold_other", l: "Прочие удержания", grp: "hold" },
  { k: "fine", l: "Штраф", grp: "hold" },
  { k: "avans", l: "Аванс", grp: "pay" },
  { k: "paid_cash", l: "Через кассу (наличными)", grp: "pay" },
  { k: "paid_card", l: "На пластиковую карту", grp: "pay" },
];
const GROUPS: [string, string][] = [
  ["days", "Дни и входящий долг"],
  ["accrual", "Начисления — суммы «на руки»"],
  ["hold", "Удержания (кроме НДФЛ и ИНПС — считаются автоматически)"],
  ["pay", "Выплаты"],
];

/** Тот же расчёт, что на сервере (`_calc`), — чтобы форма не врала. */
function preview(form: any, rates: Record<string, number>, emp?: Emp) {
  const n = (k: string) => Number(form[k] || 0);
  const norm = n("norm_days");
  const days = n("worked_days") + n("overtime_days");
  const okl = norm ? (n("oklad") * days) / norm : n("oklad");
  const onHand = okl + n("nadbavka") + n("pitanie") + n("bonus") + n("benzin") + n("other_accrued");
  const holds = n("hold_pitanie") + n("hold_alimony") + n("hold_other") + n("fine");

  const avans = n("avans");
  let cash = n("paid_cash") + (form.avans_type === "cash" ? avans : 0);
  let card = n("paid_card") + (form.avans_type === "card" ? avans : 0);
  const toPay = onHand - holds;
  const rest = Math.max(toPay - cash - card, 0);
  const restCard = (emp?.payment_type || "") !== "Наличные";
  if (rest > 0) { if (restCard) card += rest; else cash += rest; }

  const keep = 1 - rates.ndfl - rates.inps;
  const cardGross = keep > 0 ? card / keep : card;
  const ndfl = cardGross * rates.ndfl;
  const inps = cardGross * rates.inps;
  const esp = cardGross * rates.esp;
  const gross = cash + cardGross + holds;
  return { onHand, toPay, cash, card, rest, restCard, gross, ndfl, inps, esp, cost: gross + esp };
}

/** Показать, с какой части платится налог и во что выплата обходится фирме. */
function CalcPreview({ form, rates, emp }: {
  form: any; rates: Record<string, number>; emp?: Emp;
}) {
  const c = preview(form, rates, emp);
  if (!c.onHand) return null;
  const pct = (r: number) => `${+(r * 100).toFixed(2)}%`;
  const Row = ({ l, v, tone = "", bold = false }: any) => (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${bold ? "border-t border-line pt-2 mt-1 font-semibold text-white" : "text-slate-400"}`}>
      <span>{l}</span>
      <span className={`font-mono tabular-nums whitespace-nowrap ${tone}`}>{fmtNum(v)}</span>
    </div>
  );
  return (
    <div className="mt-4 rounded-xl bg-white/[0.03] border border-line px-4 py-3 text-sm">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
        Как считается
      </div>
      <Row l="Сотрудник получает на руки" v={c.onHand} tone="text-emerald-300" />
      <Row l="в т.ч. наличными — без налога" v={c.cash} />
      <Row l="в т.ч. на карту — с налогом" v={c.card} />
      {c.rest > 0 && (
        <Row l={`ещё не выплачено (пойдёт как ${c.restCard ? "карта" : "наличные"})`} v={c.rest} tone="text-slate-500" />
      )}
      {c.card > 0 ? (
        <>
          <Row l={`+ НДФЛ ${pct(rates.ndfl)} сверху карточной части`} v={c.ndfl} tone="text-rose-300" />
          {c.inps > 0 && <Row l={`+ ИНПС ${pct(rates.inps)} сверху`} v={c.inps} tone="text-rose-300" />}
        </>
      ) : (
        <Row l="НДФЛ / ИНПС / ЕСП" v={0} />
      )}
      <Row l="= Начислено (в ведомости)" v={c.gross} bold />
      {c.esp > 0 && <Row l={`+ ЕСП ${pct(rates.esp)} — платит предприятие`} v={c.esp} tone="text-amber-300" />}
      <Row l="= Обходится предприятию" v={c.cost} bold />
      <p className="text-[11px] text-slate-500 mt-2">
        Налог берётся только с безналичной части:
        начислено_карта = {fmtNum(c.card)} ÷ (1 − {pct(rates.ndfl + rates.inps)}).
        Наличные (касса и аванс наличными) налогом не облагаются.
      </p>
    </div>
  );
}

function PayrollTab() {
  const { can } = useAuth();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const { data, loading, reload } = useApi<PE[]>(`/payroll?period=${period}`, [period]);
  const { data: emps } = useApi<Emp[]>("/employees");
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<PE | null>(null);
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const { data: settings } = useApi<{ key: string; value: string }[]>("/settings");
  const rate = (k: string) =>
    Number(settings?.find((s) => s.key === k)?.value || 0);
  const rates = { ndfl: rate("ndfl_rate"), inps: rate("inps_rate"), esp: rate("esp_rate") };

  const blank: any = { employee_id: "", period, norm_days: 22, worked_days: 22, avans_type: "" };
  PAY_FIELDS.forEach((f) => { if (!(f.k in blank)) blank[f.k] = 0; });

  const [form, setForm] = useState<any>(blank);
  const needAvansType = Number(form.avans || 0) > 0 && !form.avans_type;
  const pickedEmp = emps?.find((e) => e.id === Number(form.employee_id));
  const calc = preview(form, rates, pickedEmp);
  const paidSum = Number(form.avans || 0) + Number(form.paid_cash || 0) + Number(form.paid_card || 0);
  // разбивка задаёт налоговую базу, поэтому она должна покрывать всю сумму
  const mismatch = paidSum > 0 && Math.abs(paidSum - calc.toPay) > 0.01;
  const save = async () => {
    setErr(""); setSaving(true);
    const body: any = {
      employee_id: Number(form.employee_id), period,
      avans_type: Number(form.avans || 0) > 0 ? form.avans_type : "",
    };
    PAY_FIELDS.forEach((f) => { body[f.k] = Number(form[f.k] || 0); });
    try {
      if (editing) await api.put(`/payroll/${editing.id}`, body);
      else await api.post("/payroll", body);
      setOpen(false); setForm(blank); setEditing(null); reload();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const payRest = async (p: PE) => {
    const rest = Number(p.balance);
    const cash = p.pay_mode === "cash";
    await api.put(`/payroll/${p.id}`, {
      paid_card: Number(p.paid_card) + (cash ? 0 : rest),
      paid_cash: Number(p.paid_cash) + (cash ? rest : 0),
    });
    reload();
  };
  const remove = async (id: number) => { if (confirm("Удалить расчёт?")) { await api.delete(`/payroll/${id}`); reload(); } };
  const onPickEmp = (id: string) => {
    const e = emps?.find((x) => x.id === Number(id));
    setForm({ ...form, employee_id: id, oklad: e?.salary || 0 });
  };
  const openEdit = (p: PE) => {
    const f: any = {
      employee_id: String(p.employee?.id || ""), period: p.period,
      avans_type: p.avans_type || "",
    };
    PAY_FIELDS.forEach((x) => { f[x.k] = Number((p as any)[x.k] || 0); });
    setEditing(p); setForm(f); setErr(""); setOpen(true);
  };

  const byId = new Map((emps || []).map((e) => [e.id, e]));
  const f = useFilter<PE>(
    data,
    (p) => text(p.employee?.full_name, byId.get(p.employee?.id || 0)?.division,
                byId.get(p.employee?.id || 0)?.department, p.net, p.balance),
    [
      { key: "div", label: "Подразд.", of: (p) => byId.get(p.employee?.id || 0)?.division || "" },
      { key: "dep", label: "Отдел", of: (p) => byId.get(p.employee?.id || 0)?.department || "" },
      { key: "debt", label: "Долг", of: (p) => (Number(p.balance) > 0 ? "есть" : "погашен") },
    ]
  );
  // итог — по видимым строкам, чтобы фильтр не врал
  const sum = (k: keyof PE) => f.rows.reduce((a, p) => a + Number(p[k] || 0), 0);
  const [y, m] = period.split("-");

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input type="month" className="input max-w-[180px]" value={period} onChange={(e) => setPeriod(e.target.value)} />
        {can("payroll:create") && <button className="btn-primary" onClick={() => { setEditing(null); setForm({ ...blank, period }); setErr(""); setOpen(true); }}>+ Начислить</button>}
        <ExportButton url={`/export/registry/payroll?year=${y}&month=${Number(m)}`} label="Ведомость в Excel" />
      </div>
      {!loading && !!data?.length && <FilterBar f={f} placeholder="ФИО, подразделение…" />}
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Нет начислений за период" /> :
         !f.rows.length ? <EmptyState text="Под фильтр ничего не подошло" /> : (
          <div className="overflow-x-auto max-h-[65vh]"><table className="w-full min-w-[1750px] text-sm">
            <thead className="sticky top-0 bg-base-850 z-10">
              <tr>
                <th className="th" rowSpan={2}>Сотрудник</th>
                <th className="th text-right" rowSpan={2}>Дни</th>
                <th className="th text-right" rowSpan={2}>Долг нач.</th>
                <th className="th text-center border-l border-line" colSpan={6}>Начислено</th>
                <th className="th text-center border-l border-line" colSpan={6}>Удержано</th>
                <th className="th text-right border-l border-line" rowSpan={2}>К выдаче</th>
                <th className="th text-center border-l border-line" colSpan={4}>Выплачено</th>
                <th className="th text-right border-l border-line" rowSpan={2}>Долг кон.</th>
                <th className="th text-right" rowSpan={2}>ЕСП</th>
                <th className="th" rowSpan={2}></th>
              </tr>
              <tr>
                <th className="th text-right border-l border-line">Оклад</th><th className="th text-right">Надбавка</th>
                <th className="th text-right">Питание</th><th className="th text-right">Премия</th>
                <th className="th text-right">Бензин</th><th className="th text-right">Всего</th>
                <th className="th text-right border-l border-line">НДФЛ</th><th className="th text-right">ИНПС</th>
                <th className="th text-right">Питание</th><th className="th text-right">Алименты</th>
                <th className="th text-right">Штраф</th><th className="th text-right">Всего</th>
                <th className="th text-right border-l border-line">Аванс</th><th className="th text-right">Касса</th>
                <th className="th text-right">Карта</th><th className="th text-right">Всего</th>
              </tr>
            </thead>
            <tbody>
              {f.rows.map((p) => {
                const N = (v: any) => (Number(v) ? fmtNum(v) : "—");
                return (
                  <tr key={p.id} className="hover:bg-white/[0.02]">
                    <td className="td text-white whitespace-nowrap">
                      {p.employee?.full_name}
                      <span className={`chip ml-2 text-[10px] ${p.pay_mode === "cash"
                        ? "bg-white/5 text-slate-400 border border-line"
                        : "bg-violet2/15 text-violet2 border border-violet2/25"}`}
                        title={p.pay_mode === "cash"
                          ? "Наличными — налоги не начислялись"
                          : "На карту — НДФЛ начислен сверху"}>
                        {p.pay_mode === "cash" ? "нал." : "карта"}
                      </span>
                    </td>
                    <td className="td text-right whitespace-nowrap">{fmtNum(p.worked_days)}/{fmtNum(p.norm_days)}{Number(p.overtime_days) ? <span className="text-amber-300"> +{fmtNum(p.overtime_days)}</span> : null}</td>
                    <td className="td text-right text-slate-400 tabular-nums">{N(p.debt_start)}</td>
                    <td className="td text-right border-l border-line tabular-nums">{fmtNum(p.oklad)}</td>
                    <td className="td text-right tabular-nums">{N(p.nadbavka)}</td>
                    <td className="td text-right tabular-nums">{N(p.pitanie)}</td>
                    <td className="td text-right tabular-nums">{N(p.bonus)}</td>
                    <td className="td text-right tabular-nums">{N(p.benzin)}</td>
                    <td className="td text-right font-medium text-white tabular-nums">{fmtNum(p.gross)}</td>
                    <td className="td text-right text-rose-300 border-l border-line tabular-nums">{fmtNum(p.ndfl)}</td>
                    <td className="td text-right text-slate-400 tabular-nums">{N(p.inps)}</td>
                    <td className="td text-right text-slate-400 tabular-nums">{N(p.hold_pitanie)}</td>
                    <td className="td text-right text-slate-400 tabular-nums">{N(p.hold_alimony)}</td>
                    <td className="td text-right text-slate-400 tabular-nums">{N(p.fine)}</td>
                    <td className="td text-right text-rose-300 tabular-nums">{fmtNum(p.withheld)}</td>
                    <td className="td text-right font-semibold text-emerald-300 border-l border-line tabular-nums">{fmtNum(p.net)}</td>
                    <td className="td text-right border-l border-line tabular-nums">{N(p.avans)}</td>
                    <td className="td text-right tabular-nums">{N(p.paid_cash)}</td>
                    <td className="td text-right tabular-nums">{N(p.paid_card)}</td>
                    <td className="td text-right text-white tabular-nums">{fmtNum(p.paid)}</td>
                    <td className={`td text-right font-semibold border-l border-line tabular-nums ${Number(p.balance) > 0 ? "text-rose-300" : "text-slate-400"}`}>{fmtNum(p.balance)}</td>
                    <td className="td text-right text-amber-300 tabular-nums">{fmtNum(p.esp)}</td>
                    <td className="td text-right whitespace-nowrap">
                      {can("payroll:edit") && Number(p.balance) > 0 && <button onClick={() => payRest(p)} className="chip bg-emerald-500/12 text-emerald-300 border border-emerald-500/20 mr-2" title="Выплатить остаток">Выплатить</button>}
                      {can("payroll:edit") && <button onClick={() => openEdit(p)} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                      {can("payroll:delete") && <button onClick={() => remove(p.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 bg-base-850">
              <tr className="font-semibold text-white">
                <td className="td" colSpan={2}>{f.active ? "ИТОГО ПО ФИЛЬТРУ" : "ИТОГО"}</td>
                <td className="td text-right tabular-nums">{fmtNum(sum("debt_start"))}</td>
                <td className="td text-right border-l border-line tabular-nums">{fmtNum(sum("oklad"))}</td>
                <td className="td text-right tabular-nums">{fmtNum(sum("nadbavka"))}</td>
                <td className="td text-right tabular-nums">{fmtNum(sum("pitanie"))}</td>
                <td className="td text-right tabular-nums">{fmtNum(sum("bonus"))}</td>
                <td className="td text-right tabular-nums">{fmtNum(sum("benzin"))}</td>
                <td className="td text-right tabular-nums">{fmtNum(sum("gross"))}</td>
                <td className="td text-right border-l border-line tabular-nums">{fmtNum(sum("ndfl"))}</td>
                <td className="td text-right tabular-nums">{fmtNum(sum("inps"))}</td>
                <td className="td text-right tabular-nums">{fmtNum(sum("hold_pitanie"))}</td>
                <td className="td text-right tabular-nums">{fmtNum(sum("hold_alimony"))}</td>
                <td className="td text-right tabular-nums">{fmtNum(sum("fine"))}</td>
                <td className="td text-right tabular-nums">{fmtNum(sum("withheld"))}</td>
                <td className="td text-right text-emerald-300 border-l border-line tabular-nums">{fmtNum(sum("net"))}</td>
                <td className="td text-right border-l border-line tabular-nums">{fmtNum(sum("avans"))}</td>
                <td className="td text-right tabular-nums">{fmtNum(sum("paid_cash"))}</td>
                <td className="td text-right tabular-nums">{fmtNum(sum("paid_card"))}</td>
                <td className="td text-right tabular-nums">{fmtNum(sum("paid"))}</td>
                <td className="td text-right text-rose-300 border-l border-line tabular-nums">{fmtNum(sum("balance"))}</td>
                <td className="td text-right text-amber-300 tabular-nums">{fmtNum(sum("esp"))}</td>
                <td className="td"></td>
              </tr>
            </tfoot>
          </table></div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Расчёт за ${period} — ${editing.employee?.full_name}` : `Начисление за ${period}`} width="max-w-3xl">
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        {!editing && (
          <div className="mb-4">
            <Field label="Сотрудник">
              <select className="input" value={form.employee_id} onChange={(e) => onPickEmp(e.target.value)}>
                <option value="">—</option>
                {emps?.filter((e) => e.is_active).map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.division ? ` · ${e.division}` : ""}</option>)}
              </select>
            </Field>
          </div>
        )}
        <div className="space-y-4">
          {GROUPS.map(([grp, title]) => (
            <div key={grp}>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">{title}</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {PAY_FIELDS.filter((f) => f.grp === grp).map((f) => (
                  <Field key={f.k} label={f.l}>
                    <MoneyInput value={form[f.k]} onChange={(v) => setForm({ ...form, [f.k]: v })} />
                  </Field>
                ))}
              </div>
              {grp === "pay" && (
                <>
                  <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                    Налог считается по КАЖДОЙ выплате отдельно:{" "}
                    <b className="text-slate-300">«Через кассу (наличными)»</b> — без налога;{" "}
                    <b className="text-slate-300">«На пластиковую карту»</b> — НДФЛ и ИНПС
                    начисляются <b>сверху</b> этой суммы, ЕСП платит предприятие. Аванс идёт
                    в ту часть, которую выберете ниже. Сумма аванса, кассы и карты должна
                    равняться начисленному на руки.
                  </p>
                  <div className={`mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border px-3.5 py-2.5 text-sm ${
                    mismatch ? "border-rose-500/40 bg-rose-500/10" : "border-line bg-white/[0.03]"}`}>
                    <span className="text-slate-400">
                      Вписано <b className="text-white font-mono tabular-nums">{fmtNum(paidSum)}</b>
                      {" из "}
                      <b className="text-white font-mono tabular-nums">{fmtNum(calc.toPay)}</b>
                      {" на руки"}
                    </span>
                    {mismatch ? (
                      <span className="text-rose-300">
                        не хватает <b className="font-mono tabular-nums">{fmtNum(calc.toPay - paidSum)}</b>
                      </span>
                    ) : paidSum > 0 ? (
                      <span className="text-emerald-300">сходится ✔</span>
                    ) : (
                      <span className="text-slate-500">выплат ещё не было — можно сохранить</span>
                    )}
                  </div>
                  {Number(form.avans || 0) > 0 && (
                    <div className={`mt-2 rounded-xl border px-3.5 py-2.5 ${
                      needAvansType ? "border-amber-500/40 bg-amber-500/10" : "border-line bg-white/[0.03]"}`}>
                      <div className="text-sm text-slate-300 mb-2">
                        Чем выдан аванс? <span className="text-rose-300">*</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[["cash", "Наличными (из кассы)"], ["card", "Перечислением (на карту)"]].map(([v, l]) => (
                          <button key={v} type="button"
                            onClick={() => setForm({ ...form, avans_type: v })}
                            className={`chip ${form.avans_type === v
                              ? "bg-accent/15 text-accent-soft border border-accent/25"
                              : "bg-white/5 text-slate-400 border border-line"}`}>
                            {l}
                          </button>
                        ))}
                      </div>
                      {needAvansType && (
                        <div className="text-xs text-amber-300 mt-2">
                          Без этого не сохранить: иначе не видно, ушли деньги из кассы или с расчётного счёта.
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        <CalcPreview form={form} rates={rates} emp={pickedEmp} />

        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button>
          <button className="btn-primary" onClick={save}
            disabled={saving || (!editing && !form.employee_id) || needAvansType || mismatch}>
            {editing ? "Сохранить" : "Начислить"}
          </button>
        </div>
      </Modal>
    </>
  );
}

/** Свод по объектам и кодам расхода — лист «Зарплата  » в Excel. */
function SummaryTab() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const { data, loading } = useApi<Summary>(`/payroll/summary?period=${period}`, [period]);
  const COLS: [string, string][] = [
    ["headcount", "Кол-во"], ["gross", "Начислено"], ["ndfl", "НДФЛ"], ["inps", "ИНПС"],
    ["esp", "ЕСП"], ["net", "К выдаче"], ["avans", "Аванс"], ["paid_cash", "Через кассу"],
    ["paid_card", "На карту"], ["balance", "Долг на конец"], ["total_cost", "Расходы на сотрудников"],
  ];
  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <input type="month" className="input max-w-[180px]" value={period} onChange={(e) => setPeriod(e.target.value)} />
      </div>
      <Card className="!p-0 overflow-hidden">
        {loading || !data ? <Spinner /> : !data.rows.length ? <EmptyState text="Нет начислений за период" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm">
            <thead><tr className="bg-white/[0.02]">
              <th className="th">Объект</th><th className="th">Код расхода</th>
              {COLS.map(([, l]) => <th key={l} className="th text-right">{l}</th>)}
            </tr></thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className="hover:bg-white/[0.02]">
                  <td className="td text-white">{r.division}</td>
                  <td className="td font-mono text-slate-400">{r.expense_code}</td>
                  {COLS.map(([k]) => <td key={k} className="td text-right tabular-nums">{fmtNum(r[k])}</td>)}
                </tr>
              ))}
              <tr className="bg-white/[0.03] font-semibold text-white">
                <td className="td" colSpan={2}>ИТОГО</td>
                {COLS.map(([k]) => <td key={k} className="td text-right tabular-nums">{fmtNum(data.totals[k])}</td>)}
              </tr>
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
