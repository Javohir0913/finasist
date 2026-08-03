import { useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Field, Modal, MoneyInput, SearchSelect, SectionTitle, Spinner } from "../components/ui";
import { fmtDate, fmtNum } from "../lib/format";
import { LockedMark, LockedNotice, useLock } from "../lib/lock";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface Org { id: number; name: string; inn?: string }
interface Div { id: number; name: string }
interface Code { id: number; code: string; name: string }
interface Svc { id: number; doc_date: string; direction: string; service_type: string; expense_code: string; division: string; amount: number; vat: boolean; net: number; vat_amount: number; organization: Org | null }

export default function Services() {
  const { can } = useAuth();
  const { isLocked, isPeriodLocked, minOpenDate, hint } = useLock();
  const [dir, setDir] = useState("received");
  const { data, loading, reload } = useApi<Svc[]>(`/services?direction=${dir}`, [dir]);
  const { data: orgs } = useApi<Org[]>("/organizations");
  const { data: divs } = useApi<Div[]>("/divisions");
  const { data: expCodes } = useApi<Code[]>("/expense-codes");
  const [open, setOpen] = useState(false); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const empty = { doc_date: new Date().toISOString().slice(0, 10), direction: dir, organization_id: "", service_type: "", expense_code: "", division: "", amount: 0, vat: false };
  const [form, setForm] = useState<any>(empty);
  const save = async () => {
    setErr(""); setSaving(true);
    try { await api.post("/services", { ...form, direction: dir, organization_id: form.organization_id ? Number(form.organization_id) : null, amount: Number(form.amount) }); setOpen(false); setForm(empty); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (id: number) => { if (confirm("Удалить?")) { await api.delete(`/services/${id}`); reload(); } };
  const total = (data || []).reduce((a, s) => a + Number(s.net), 0);

  return (
    <div>
      <SectionTitle title="Услуги" sub="Полученные и оказанные услуги (с расчётом НДС)"
        right={can("services:create") && <button className="btn-primary" onClick={() => { setForm({ ...empty, direction: dir }); setErr(""); setOpen(true); }}>+ Услуга</button>} />
      <div className="flex gap-2 mb-4">
        {[["received", "Полученные"], ["provided", "Оказанные"]].map(([v, l]) => (
          <button key={v} onClick={() => setDir(v)} className={`chip ${dir === v ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-veil/5 text-slate-400 border border-line"}`}>{l}</button>
        ))}
      </div>
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Нет услуг" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[880px]">
            <thead><tr className="bg-veil/[0.02]"><th className="th">Дата</th><th className="th">Контрагент</th><th className="th">Вид услуги</th><th className="th">Подразд.</th><th className="th text-right">Без НДС</th><th className="th text-right">НДС</th><th className="th text-right">Всего</th><th className="th"></th></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="hover:bg-veil/[0.02]">
                  <td className="td">{fmtDate(s.doc_date)}</td>
                  <td className="td text-ink max-w-[180px] truncate">{s.organization?.name || "—"}</td>
                  <td className="td max-w-[200px] truncate">{s.service_type || "—"}</td>
                  <td className="td">{s.division ? <Badge tone="violet">{s.division}</Badge> : "—"}</td>
                  <td className="td text-right">{fmtNum(s.net)}</td>
                  <td className="td text-right text-slate-400">{fmtNum(s.vat_amount)}</td>
                  <td className="td text-right font-semibold text-ink">{fmtNum(s.amount)}</td>
                  <td className="td text-right">{isLocked(s.doc_date) ? <LockedMark title={hint} /> : can("services:delete") && <button onClick={() => remove(s.id)} className="text-slate-500 hover:text-rose-300">✕</button>}</td>
                </tr>
              ))}
              <tr className="bg-veil/[0.03] font-semibold"><td className="td text-ink" colSpan={4}>Итого (без НДС)</td><td className="td text-right text-ink">{fmtNum(total)}</td><td className="td" colSpan={3}></td></tr>
            </tbody>
          </table></div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title={dir === "received" ? "Полученная услуга" : "Оказанная услуга"} width="max-w-xl">
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <LockedNotice date={form.doc_date} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Дата"><input type="date" min={minOpenDate || undefined} className="input" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></Field>
          <Field label="Контрагент"><SearchSelect value={String(form.organization_id || "")} onChange={(v) => setForm({ ...form, organization_id: v })} placeholder="—" emptyLabel="—" options={(orgs || []).map((o) => ({ value: String(o.id), label: o.inn ? `${o.name} · ${o.inn}` : o.name, search: `${o.name} ${o.inn || ""}` }))} /></Field>
          <div className="col-span-2"><Field label="Вид услуги"><input className="input" value={form.service_type} onChange={(e) => setForm({ ...form, service_type: e.target.value })} placeholder="Транспортные услуги" /></Field></div>
          <Field label="Подразделение"><SearchSelect value={form.division} onChange={(v) => setForm({ ...form, division: v })} placeholder="—" emptyLabel="—" options={(divs || []).map((d) => ({ value: d.name, label: d.name }))} /></Field>
          {dir === "received" && <Field label="Код расхода"><SearchSelect value={form.expense_code} onChange={(v) => setForm({ ...form, expense_code: v })} placeholder="—" emptyLabel="—" options={(expCodes || []).map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} /></Field>}
          <Field label="Сумма (с НДС), сум"><MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></Field>
          <div className="col-span-2 flex items-center gap-2"><input id="svcvat" type="checkbox" checked={form.vat} onChange={(e) => setForm({ ...form, vat: e.target.checked })} className="h-4 w-4 accent-accent" /><label htmlFor="svcvat" className="text-sm text-slate-300">С учётом НДС (12%)</label></div>
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving}>Сохранить</button></div>
      </Modal>
    </div>
  );
}
