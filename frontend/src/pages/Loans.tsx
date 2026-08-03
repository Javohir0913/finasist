import { useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Field, Modal, MoneyInput, SectionTitle, Spinner } from "../components/ui";
import { fmtDate, fmtNum } from "../lib/format";
import { LockedMark, LockedNotice, useLock } from "../lib/lock";
import { FilterBar, sum, text, useFilter, uzs } from "../lib/table";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface L {
  id: number; counterparty: string; direction: string; currency: string;
  principal: number; opening_uzs: number; opening_date: string | null;
  balance: number; note: string;
}
interface Entry {
  id: number; loan_id: number; doc_date: string; kind: string; amount_uzs: number; note: string;
}

export default function Loans() {
  const { can } = useAuth();
  const { isLocked, isPeriodLocked, minOpenDate, hint } = useLock();
  const { data, loading, reload } = useApi<L[]>("/loans");
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<L | null>(null);
  const [moves, setMoves] = useState<L | null>(null);
  const empty = { counterparty: "", direction: "received", currency: "UZS", principal: 0, opening_uzs: 0, opening_date: "", note: "" };
  const [form, setForm] = useState<any>(empty); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  // входящее сальдо без даты учесть нельзя — непонятно, с какого момента оно есть
  const dateMissing = !!Number(form.opening_uzs || 0) && !form.opening_date;

  const save = async () => {
    if (dateMissing) return;
    setErr(""); setSaving(true);
    const body = {
      ...form, principal: Number(form.principal), opening_uzs: Number(form.opening_uzs),
      opening_date: form.opening_date || null,
    };
    delete body.balance;  // сальдо считает сервер из движений
    try { if (editing) await api.put(`/loans/${editing.id}`, body); else await api.post("/loans", body); setOpen(false); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (id: number) => {
    if (!confirm("Удалить займ?")) return;
    try { await api.delete(`/loans/${id}`); reload(); } catch (e) { alert(apiError(e)); }
  };

  const f = useFilter<L>(
    data,
    (l) => text(l.counterparty, l.note, l.currency, l.balance),
    [
      { key: "dir", label: "Тип", of: (l) => (l.direction === "received" ? "Получен" : "Выдан") },
      { key: "cur", label: "Валюта", of: (l) => l.currency || "" },
    ]
  );

  return (
    <div>
      <SectionTitle title="Займы" sub="Выданные и полученные займы: входящее сальдо + движения = остаток"
        right={can("loans:create") && <button className="btn-primary" onClick={() => { setEditing(null); setForm(empty); setErr(""); setOpen(true); }}>+ Займ</button>} />
      {!loading && !!data?.length && (
        <>
          <FilterBar f={f} placeholder="Контрагент, примечание…" />
          <Card className="!p-4 mb-4 flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-[11px] text-slate-500">Входящее сальдо по фильтру</div>
              <div className="text-ink font-semibold tabular-nums">{uzs(sum(f.rows, "opening_uzs"))}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Остаток по фильтру</div>
              <div className="text-amber-300 font-semibold tabular-nums">{uzs(sum(f.rows, "balance"))}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Получено / выдано</div>
              <div className="text-slate-300 font-semibold tabular-nums">
                {uzs(sum(f.rows.filter((l) => l.direction === "received"), "balance"))}
                {" / "}
                {uzs(sum(f.rows.filter((l) => l.direction !== "received"), "balance"))}
              </div>
            </div>
          </Card>
        </>
      )}
      {loading ? <Spinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {!data?.length && <Card><EmptyState text="Нет данных" /></Card>}
          {!!data?.length && !f.rows.length && <Card><EmptyState text="Под фильтр ничего не подошло" /></Card>}
          {f.rows.map((l) => (
            <Card key={l.id}>
              <div className="flex items-center justify-between">
                <Badge tone={l.direction === "received" ? "rose" : "emerald"}>{l.direction === "received" ? "Получен" : "Выдан"}</Badge>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{l.currency}</span>
                  {isLocked(l.opening_date) ? <LockedMark title={hint} /> : <>
                    {can("loans:edit") && <button onClick={() => { setEditing(l); setForm({ ...l }); setErr(""); setOpen(true); }} className="text-slate-500 hover:text-accent-soft">✎</button>}
                    {can("loans:delete") && <button onClick={() => remove(l.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                  </>}
                </div>
              </div>
              <div className="text-lg font-semibold text-ink mt-3">{l.counterparty}</div>
              <div className="text-sm text-slate-400 mt-1">{l.note}</div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-veil/5 p-3"><div className="text-[11px] text-slate-500">Входящее сальдо</div><div className="text-ink font-semibold tabular-nums">{fmtNum(l.opening_uzs)}</div></div>
                <div className="rounded-xl bg-veil/5 p-3"><div className="text-[11px] text-slate-500">Текущий остаток</div><div className="text-amber-300 font-semibold tabular-nums">{fmtNum(l.balance)}</div></div>
              </div>
              <button className="btn-ghost w-full mt-3" onClick={() => setMoves(l)}>Движения по займу</button>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Редактировать займ" : "Новый займ"}>
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <LockedNotice date={form.opening_date} />
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Контрагент"><input className="input" value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} /></Field></div>
          <Field label="Тип"><select className="input" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}><option value="received">Получен</option><option value="given">Выдан</option></select></Field>
          <Field label="Валюта"><select className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}><option>UZS</option><option>USD</option></select></Field>
          <Field label="Сумма договора"><MoneyInput value={form.principal} onChange={(v) => setForm({ ...form, principal: v })} /></Field>
          <Field label="Входящее сальдо"><MoneyInput value={form.opening_uzs} onChange={(v) => setForm({ ...form, opening_uzs: v })} /></Field>
          <Field label="Дата сальдо *">
            <input type="date" min={minOpenDate || undefined} className="input" value={form.opening_date || ""}
              onChange={(e) => setForm({ ...form, opening_date: e.target.value })} />
            {dateMissing && (
              <p className="mt-1 text-xs text-amber-300">
                Обязательно: на какую дату зафиксировано сальдо
              </p>
            )}
          </Field>
          <div className="col-span-2"><Field label="Примечание"><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field></div>
          <p className="col-span-2 text-xs text-slate-500">
            Остаток рассчитывается автоматически: входящее сальдо + выдачи − погашения (вкладка «Движения по займу»).
          </p>
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving || !form.counterparty || dateMissing}
          title={dateMissing ? "Укажите дату входящего сальдо" : undefined}>Сохранить</button></div>
      </Modal>

      {moves && <LoanMoves loan={moves} onClose={() => { setMoves(null); reload(); }} />}
    </div>
  );
}

function LoanMoves({ loan, onClose }: { loan: L; onClose: () => void }) {
  const { can } = useAuth();
  const { isLocked, isPeriodLocked, minOpenDate, hint } = useLock();
  const { data, loading, reload } = useApi<Entry[]>(`/loan-entries?loan_id=${loan.id}`, [loan.id]);
  const blank = { doc_date: new Date().toISOString().slice(0, 10), kind: "debit", amount_uzs: 0, note: "" };
  const [form, setForm] = useState<any>(blank);
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);

  const add = async () => {
    setErr(""); setSaving(true);
    try {
      await api.post("/loan-entries", { ...form, loan_id: loan.id, amount_uzs: Number(form.amount_uzs) });
      setForm(blank); reload();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (id: number) => {
    if (!confirm("Удалить движение?")) return;
    await api.delete(`/loan-entries/${id}`); reload();
  };

  return (
    <Modal open onClose={onClose} title={`Движения — ${loan.counterparty}`} width="max-w-2xl">
      {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
      <LockedNotice date={form.doc_date} />
      {can("loans:create") && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Field label="Дата"><input type="date" min={minOpenDate || undefined} className="input" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></Field>
          <Field label="Операция">
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="debit">Выдача (дебет)</option>
              <option value="credit">Погашение (кредит)</option>
            </select>
          </Field>
          <Field label="Сумма, сум"><MoneyInput value={form.amount_uzs} onChange={(v) => setForm({ ...form, amount_uzs: v })} /></Field>
          <div className="flex items-end"><button className="btn-primary w-full" onClick={add} disabled={saving || !Number(form.amount_uzs)}>+ Добавить</button></div>
        </div>
      )}
      {loading ? <Spinner /> : !data?.length ? <EmptyState text="Движений нет" /> : (
        <div className="max-h-72 overflow-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-base-850">
              <tr><th className="th">Дата</th><th className="th">Операция</th><th className="th text-right">Сумма</th><th className="th">Примечание</th><th className="th"></th></tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className="hover:bg-veil/[0.02]">
                  <td className="td whitespace-nowrap">{fmtDate(e.doc_date)}</td>
                  <td className="td"><Badge tone={e.kind === "debit" ? "emerald" : "rose"}>{e.kind === "debit" ? "Выдача" : "Погашение"}</Badge></td>
                  <td className="td text-right tabular-nums">{fmtNum(e.amount_uzs)}</td>
                  <td className="td text-slate-400">{e.note || "—"}</td>
                  <td className="td text-right">{isLocked(e.doc_date) ? <LockedMark title={hint} /> : can("loans:delete") && <button onClick={() => remove(e.id)} className="text-slate-500 hover:text-rose-300">✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end mt-6"><button className="btn-primary" onClick={onClose}>Готово</button></div>
    </Modal>
  );
}
