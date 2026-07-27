import { useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Field, Modal, MoneyInput, SectionTitle, Spinner } from "../components/ui";
import { fmtNum } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface L { id: number; counterparty: string; direction: string; currency: string; principal: number; balance: number; note: string }

export default function Loans() {
  const { can } = useAuth();
  const { data, loading, reload } = useApi<L[]>("/loans");
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<L | null>(null);
  const empty = { counterparty: "", direction: "received", currency: "UZS", principal: 0, balance: 0, note: "" };
  const [form, setForm] = useState<any>(empty); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);

  const save = async () => {
    setErr(""); setSaving(true);
    const body = { ...form, principal: Number(form.principal), balance: Number(form.balance) };
    try { if (editing) await api.put(`/loans/${editing.id}`, body); else await api.post("/loans", body); setOpen(false); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (id: number) => { if (confirm("Удалить займ?")) { await api.delete(`/loans/${id}`); reload(); } };

  return (
    <div>
      <SectionTitle title="Займы" sub="Выданные и полученные займы"
        right={can("loans:create") && <button className="btn-primary" onClick={() => { setEditing(null); setForm(empty); setErr(""); setOpen(true); }}>+ Займ</button>} />
      {loading ? <Spinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {!data?.length && <Card><EmptyState text="Нет данных" /></Card>}
          {data?.map((l) => (
            <Card key={l.id}>
              <div className="flex items-center justify-between">
                <Badge tone={l.direction === "received" ? "rose" : "emerald"}>{l.direction === "received" ? "Получен" : "Выдан"}</Badge>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{l.currency}</span>
                  {can("loans:edit") && <button onClick={() => { setEditing(l); setForm({ ...l }); setErr(""); setOpen(true); }} className="text-slate-500 hover:text-accent-soft">✎</button>}
                  {can("loans:delete") && <button onClick={() => remove(l.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                </div>
              </div>
              <div className="text-lg font-semibold text-white mt-3">{l.counterparty}</div>
              <div className="text-sm text-slate-400 mt-1">{l.note}</div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/5 p-3"><div className="text-[11px] text-slate-500">Сумма</div><div className="text-white font-semibold">{fmtNum(l.principal)}</div></div>
                <div className="rounded-xl bg-white/5 p-3"><div className="text-[11px] text-slate-500">Остаток</div><div className="text-amber-300 font-semibold">{fmtNum(l.balance)}</div></div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Редактировать займ" : "Новый займ"}>
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Контрагент"><input className="input" value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} /></Field></div>
          <Field label="Тип"><select className="input" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}><option value="received">Получен</option><option value="given">Выдан</option></select></Field>
          <Field label="Валюта"><select className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}><option>UZS</option><option>USD</option></select></Field>
          <Field label="Сумма"><MoneyInput value={form.principal} onChange={(v) => setForm({ ...form, principal: v })} /></Field>
          <Field label="Остаток"><MoneyInput value={form.balance} onChange={(v) => setForm({ ...form, balance: v })} /></Field>
          <div className="col-span-2"><Field label="Примечание"><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field></div>
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving || !form.counterparty}>Сохранить</button></div>
      </Modal>
    </div>
  );
}
