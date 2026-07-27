import { useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Field, Modal, MoneyInput, SearchSelect, SectionTitle, Spinner } from "../components/ui";
import { fmtNum } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface Emp { id: number; full_name: string; inn: string; division: string; department: string; position: string; category: string; payment_type: string; salary: number; is_active: boolean }
interface Div { id: number; name: string }
interface Code { id: number; code: string; name: string }
interface PE { id: number; period: string; norm_days: number; worked_days: number; oklad: number; bonus: number; nadbavka: number; pitanie: number; other_accrued: number; avans: number; gross: number; ndfl: number; inps: number; esp: number; net: number; paid: number; balance: number; employee: Emp | null }

export default function Payroll() {
  const [tab, setTab] = useState("payroll");
  return (
    <div>
      <SectionTitle title="Зарплата" sub="Сотрудники и расчёт заработной платы (НДФЛ 12%, ЕСП 12%)" />
      <div className="flex gap-2 mb-4">
        {[["payroll", "Расчёт зарплаты"], ["employees", "Сотрудники"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`chip ${tab === k ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-white/5 text-slate-400 border border-line"}`}>{l}</button>
        ))}
      </div>
      {tab === "employees" ? <Employees /> : <PayrollTab />}
    </div>
  );
}

function Employees() {
  const { can } = useAuth();
  const { data, loading, reload } = useApi<Emp[]>("/employees");
  const { data: divs } = useApi<Div[]>("/divisions");
  const { data: expCodes } = useApi<Code[]>("/expense-codes");
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<Emp | null>(null);
  const empty = { full_name: "", inn: "", division: "", department: "", position: "", category: "", expense_code: "", payment_type: "Карта", salary: 0, is_active: true };
  const [form, setForm] = useState<any>(empty); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const save = async () => {
    setErr(""); setSaving(true);
    const body = { ...form, salary: Number(form.salary) };
    try { if (editing) await api.put(`/employees/${editing.id}`, body); else await api.post("/employees", body); setOpen(false); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (e: Emp) => { if (confirm("Удалить сотрудника?")) { try { await api.delete(`/employees/${e.id}`); reload(); } catch (x) { alert(apiError(x)); } } };
  return (
    <>
      {can("payroll:create") && <div className="mb-4"><button className="btn-primary" onClick={() => { setEditing(null); setForm(empty); setErr(""); setOpen(true); }}>+ Сотрудник</button></div>}
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Нет сотрудников" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[820px]">
            <thead><tr className="bg-white/[0.02]"><th className="th">ФИО</th><th className="th">Подразд.</th><th className="th">Отдел</th><th className="th">Должность</th><th className="th">Оплата</th><th className="th text-right">Оклад</th><th className="th"></th></tr></thead>
            <tbody>{data.map((e) => (
              <tr key={e.id} className="hover:bg-white/[0.02]">
                <td className="td text-white">{e.full_name}{!e.is_active && <span className="text-slate-600 text-xs ml-2">(неактивен)</span>}</td>
                <td className="td">{e.division ? <Badge tone="violet">{e.division}</Badge> : "—"}</td>
                <td className="td">{e.department || "—"}</td><td className="td">{e.position || "—"}</td>
                <td className="td"><Badge tone="slate">{e.payment_type}</Badge></td>
                <td className="td text-right">{fmtNum(e.salary)}</td>
                <td className="td text-right whitespace-nowrap">
                  {can("payroll:edit") && <button onClick={() => { setEditing(e); setForm({ ...e }); setErr(""); setOpen(true); }} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                  {can("payroll:delete") && <button onClick={() => remove(e)} className="text-slate-500 hover:text-rose-300">✕</button>}
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Редактировать сотрудника" : "Новый сотрудник"} width="max-w-xl">
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="ФИО"><input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field></div>
          <Field label="ИНН"><input className="input" value={form.inn} onChange={(e) => setForm({ ...form, inn: e.target.value })} /></Field>
          <Field label="Подразделение"><SearchSelect value={form.division} onChange={(v) => setForm({ ...form, division: v })} placeholder="—" emptyLabel="—" options={(divs || []).map((d) => ({ value: d.name, label: d.name }))} /></Field>
          <Field label="Отдел"><input className="input" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="АУП / ПП" /></Field>
          <Field label="Должность"><input className="input" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></Field>
          <Field label="Способ оплаты"><select className="input" value={form.payment_type} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}><option>Карта</option><option>Касса</option></select></Field>
          <Field label="Код расхода"><SearchSelect value={form.expense_code} onChange={(v) => setForm({ ...form, expense_code: v })} placeholder="—" emptyLabel="—" options={(expCodes || []).map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} /></Field>
          <Field label="Оклад, сум"><MoneyInput value={form.salary} onChange={(v) => setForm({ ...form, salary: v })} /></Field>
          <div className="col-span-2 flex items-center gap-2"><input id="eact" type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="h-4 w-4 accent-[#5b8cff]" /><label htmlFor="eact" className="text-sm text-slate-300">Активен</label></div>
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving || !form.full_name}>Сохранить</button></div>
      </Modal>
    </>
  );
}

function PayrollTab() {
  const { can } = useAuth();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const { data, loading, reload } = useApi<PE[]>(`/payroll?period=${period}`, [period]);
  const { data: emps } = useApi<Emp[]>("/employees");
  const [open, setOpen] = useState(false); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const empty = { employee_id: "", period, norm_days: 22, worked_days: 22, oklad: 0, bonus: 0, nadbavka: 0, pitanie: 0, other_accrued: 0, avans: 0, paid: 0 };
  const [form, setForm] = useState<any>(empty);
  const save = async () => {
    setErr(""); setSaving(true);
    const body = { ...form, employee_id: Number(form.employee_id), period, norm_days: Number(form.norm_days), worked_days: Number(form.worked_days), oklad: Number(form.oklad), bonus: Number(form.bonus), nadbavka: Number(form.nadbavka), pitanie: Number(form.pitanie), other_accrued: Number(form.other_accrued), avans: Number(form.avans), paid: Number(form.paid) };
    try { await api.post("/payroll", body); setOpen(false); setForm(empty); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const pay = async (p: PE) => { await api.put(`/payroll/${p.id}`, { paid: p.net }); reload(); };
  const remove = async (id: number) => { if (confirm("Удалить расчёт?")) { await api.delete(`/payroll/${id}`); reload(); } };
  const onPickEmp = (id: string) => { const e = emps?.find((x) => x.id === Number(id)); setForm({ ...form, employee_id: id, oklad: e?.salary || 0 }); };
  const T = (data || []).reduce((a, p) => ({ gross: a.gross + Number(p.gross), ndfl: a.ndfl + Number(p.ndfl), esp: a.esp + Number(p.esp), net: a.net + Number(p.net), balance: a.balance + Number(p.balance) }), { gross: 0, ndfl: 0, esp: 0, net: 0, balance: 0 });
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input type="month" className="input max-w-[180px]" value={period} onChange={(e) => setPeriod(e.target.value)} />
        {can("payroll:create") && <button className="btn-primary" onClick={() => { setForm({ ...empty, period }); setErr(""); setOpen(true); }}>+ Начислить</button>}
      </div>
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Нет начислений за период" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[1450px] text-sm">
            <thead><tr className="bg-white/[0.02]"><th className="th">Сотрудник</th><th className="th text-right">Дни</th><th className="th text-right">Оклад</th><th className="th text-right">Премия</th><th className="th text-right">Надбавка</th><th className="th text-right">Питание</th><th className="th text-right">Начислено</th><th className="th text-right">НДФЛ</th><th className="th text-right">ИНПС</th><th className="th text-right">ЕСП</th><th className="th text-right">К выдаче</th><th className="th text-right">Аванс</th><th className="th text-right">Зарплата</th><th className="th text-right">Долг</th><th className="th"></th></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="hover:bg-white/[0.02]">
                  <td className="td text-white whitespace-nowrap">{p.employee?.full_name}</td>
                  <td className="td text-right">{fmtNum(p.worked_days)}/{fmtNum(p.norm_days)}</td>
                  <td className="td text-right">{fmtNum(p.oklad)}</td>
                  <td className="td text-right">{Number(p.bonus) ? fmtNum(p.bonus) : "—"}</td>
                  <td className="td text-right">{Number(p.nadbavka) ? fmtNum(p.nadbavka) : "—"}</td>
                  <td className="td text-right">{Number(p.pitanie) ? fmtNum(p.pitanie) : "—"}</td>
                  <td className="td text-right font-medium text-white">{fmtNum(p.gross)}</td>
                  <td className="td text-right text-rose-300">{fmtNum(p.ndfl)}</td>
                  <td className="td text-right text-slate-400">{fmtNum(p.inps)}</td>
                  <td className="td text-right text-amber-300">{fmtNum(p.esp)}</td>
                  <td className="td text-right font-semibold text-emerald-300">{fmtNum(p.net)}</td>
                  <td className="td text-right text-slate-400">{Number(p.avans) ? fmtNum(p.avans) : "—"}</td>
                  <td className="td text-right">{fmtNum(p.paid)}</td>
                  <td className={`td text-right font-semibold ${Number(p.balance) > 0 ? "text-rose-300" : "text-slate-400"}`}>{fmtNum(p.balance)}</td>
                  <td className="td text-right whitespace-nowrap">
                    {can("payroll:edit") && Number(p.balance) > 0 && <button onClick={() => pay(p)} className="chip bg-emerald-500/12 text-emerald-300 border border-emerald-500/20 mr-2">Выплатить</button>}
                    {can("payroll:delete") && <button onClick={() => remove(p.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                  </td>
                </tr>
              ))}
              <tr className="bg-white/[0.03] font-semibold">
                <td className="td text-white" colSpan={6}>ИТОГО</td>
                <td className="td text-right text-white">{fmtNum(T.gross)}</td>
                <td className="td text-right text-rose-300">{fmtNum(T.ndfl)}</td>
                <td className="td"></td>
                <td className="td text-right text-amber-300">{fmtNum(T.esp)}</td>
                <td className="td text-right text-emerald-300">{fmtNum(T.net)}</td>
                <td className="td" colSpan={2}></td>
                <td className="td text-right text-rose-300">{fmtNum(T.balance)}</td><td className="td"></td>
              </tr>
            </tbody>
          </table></div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title={`Начисление за ${period}`} width="max-w-xl">
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Сотрудник"><select className="input" value={form.employee_id} onChange={(e) => onPickEmp(e.target.value)}><option value="">—</option>{emps?.filter((e) => e.is_active).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></Field></div>
          <Field label="Норма дней"><MoneyInput value={form.norm_days} onChange={(v) => setForm({ ...form, norm_days: v })} /></Field>
          <Field label="Отработано дней"><MoneyInput value={form.worked_days} onChange={(v) => setForm({ ...form, worked_days: v })} /></Field>
          <Field label="Оклад, сум"><MoneyInput value={form.oklad} onChange={(v) => setForm({ ...form, oklad: v })} /></Field>
          <Field label="Премия, сум"><MoneyInput value={form.bonus} onChange={(v) => setForm({ ...form, bonus: v })} /></Field>
          <Field label="Надбавка"><MoneyInput value={form.nadbavka} onChange={(v) => setForm({ ...form, nadbavka: v })} /></Field>
          <Field label="Питание"><MoneyInput value={form.pitanie} onChange={(v) => setForm({ ...form, pitanie: v })} /></Field>
          <Field label="Прочие начисления"><MoneyInput value={form.other_accrued} onChange={(v) => setForm({ ...form, other_accrued: v })} /></Field>
          <Field label="Аванс (выплачен)"><MoneyInput value={form.avans} onChange={(v) => setForm({ ...form, avans: v })} /></Field>
          <Field label="Зарплата (выплачено)"><MoneyInput value={form.paid} onChange={(v) => setForm({ ...form, paid: v })} /></Field>
        </div>
        <p className="text-xs text-slate-500 mt-3">НДФЛ (12%) и ЕСП (12%) рассчитываются автоматически. Начислено считается пропорционально отработанным дням.</p>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving || !form.employee_id}>Начислить</button></div>
      </Modal>
    </>
  );
}
