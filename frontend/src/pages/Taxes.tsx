import { useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Field, Modal, MoneyInput, SectionTitle, Spinner } from "../components/ui";
import { fmtNum } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface TRow { id: number; name: string; debt_start: number; accrued: number; auto: boolean; paid: number; debt_end: number; overpay: number }

export default function Taxes() {
  const { can } = useAuth();
  const { data, loading, reload } = useApi<{ rows: TRow[]; totals: any }>("/reports/taxes");
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<TRow | null>(null);
  const empty = { name: "", period: "", debt_start: 0, accrued: 0, paid: 0 };
  const [form, setForm] = useState<any>(empty); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);

  const save = async () => {
    setErr(""); setSaving(true);
    const body = { ...form, debt_start: Number(form.debt_start), accrued: Number(form.accrued), paid: Number(form.paid) };
    try { if (editing) await api.put(`/taxes/${editing.id}`, body); else await api.post("/taxes", body); setOpen(false); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (id: number) => { if (confirm("Удалить налог?")) { await api.delete(`/taxes/${id}`); reload(); } };

  return (
    <div>
      <SectionTitle title="Налоги" sub="Начислено рассчитывается автоматически из операций (как в Excel). Долг = начало + начислено − оплачено"
        right={can("taxes:create") && <button className="btn-primary" onClick={() => { setEditing(null); setForm(empty); setErr(""); setOpen(true); }}>+ Налог</button>} />
      <Card className="!p-0 overflow-hidden">
        {loading || !data ? <Spinner /> : !data.rows.length ? <EmptyState text="Нет данных" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[820px]">
            <thead><tr className="bg-white/[0.02]"><th className="th">Налог</th><th className="th text-right">Долг на начало</th><th className="th text-right">Начислено</th><th className="th text-right">Оплачено</th><th className="th text-right">Долг на конец</th><th className="th text-right">Переплата</th><th className="th"></th></tr></thead>
            <tbody>
              {data.rows.map((t) => (
                <tr key={t.id} className="hover:bg-white/[0.02]">
                  <td className="td font-medium text-white">{t.name}</td>
                  <td className="td text-right">{fmtNum(t.debt_start)}</td>
                  <td className="td text-right text-amber-300">{fmtNum(t.accrued)} {t.auto && <Badge tone="emerald">авто</Badge>}</td>
                  <td className="td text-right text-emerald-300">{fmtNum(t.paid)}</td>
                  <td className="td text-right font-semibold text-white">{fmtNum(t.debt_end)}</td>
                  <td className="td text-right text-slate-400">{t.overpay ? fmtNum(t.overpay) : "—"}</td>
                  <td className="td text-right whitespace-nowrap">
                    {can("taxes:edit") && <button onClick={() => { setEditing(t); setForm({ name: t.name, period: "", debt_start: t.debt_start, accrued: t.accrued, paid: t.paid }); setErr(""); setOpen(true); }} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                    {can("taxes:delete") && <button onClick={() => remove(t.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                  </td>
                </tr>
              ))}
              <tr className="bg-white/[0.03] font-semibold">
                <td className="td text-white">Итого</td>
                <td className="td text-right">{fmtNum(data.totals.start)}</td>
                <td className="td text-right text-amber-300">{fmtNum(data.totals.accrued)}</td>
                <td className="td text-right text-emerald-300">{fmtNum(data.totals.paid)}</td>
                <td className="td text-right text-rose-300">{fmtNum(data.totals.end)}</td>
                <td className="td" colSpan={2}></td>
              </tr>
            </tbody>
          </table></div>
        )}
      </Card>
      <p className="text-xs text-slate-500 mt-3">
        «авто» — начислено считается автоматически: <b>НДС</b> = НДС с продаж − НДС с покупок; <b>НДФЛ/ЕСП/ИНПС</b> — из зарплаты; <b>Налог на прибыль</b> = 15% прибыли. Оплачено берётся из операций по кодам (94321 НДС, 94319 прибыль и т.д.). «Долг на начало» вводится вручную (кнопка ✎).
      </p>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Налог: остаток и ручные значения" : "Новый налог"}>
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Наименование налога"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!!editing} /></Field></div>
          <Field label="Долг на начало"><MoneyInput value={form.debt_start} onChange={(v) => setForm({ ...form, debt_start: v })} /></Field>
          <Field label="Начислено (для ручных налогов)"><MoneyInput value={form.accrued} onChange={(v) => setForm({ ...form, accrued: v })} /></Field>
        </div>
        <p className="text-xs text-slate-500 mt-3">Для НДС, зарплатных налогов и налога на прибыль «начислено» считается автоматически — ручное значение используется только для прочих налогов (земельный и т.п.).</p>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving || !form.name}>Сохранить</button></div>
      </Modal>
    </div>
  );
}
