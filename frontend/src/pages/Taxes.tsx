import { useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Field, Modal, MoneyInput, SectionTitle, Spinner } from "../components/ui";
import { fmtDate, fmtNum } from "../lib/format";
import { LockedMark, LockedNotice, useLock } from "../lib/lock";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface TRow { id: number; name: string; debt_start: number; accrued: number; auto: boolean; paid: number; debt_end: number; overpay: number; accrued_date: string | null; manual_override: boolean; override_active: boolean }

// НДС и зарплатные налоги считаются из документов — дата берётся оттуда;
// остальные вводятся руками, и без даты попадали бы в каждый период
const AUTO = ["ндс", "ндфл", "есп", "инпс"];
const isAuto = (name: string) => AUTO.some((k) => (name || "").toLowerCase().includes(k));

export default function Taxes() {
  const { can } = useAuth();
  const { isLocked, isPeriodLocked, minOpenDate, hint } = useLock();
  const { data, loading, reload } = useApi<{ rows: TRow[]; totals: any }>("/reports/taxes");
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<TRow | null>(null);
  const empty = { name: "", period: "", accrued_date: "", debt_start: 0, accrued: 0, paid: 0, manual_override: false };
  const [form, setForm] = useState<any>(empty); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const auto = isAuto(form.name);
  const manual = !auto || form.manual_override;
  const dateMissing = manual
    && (!auto ? !!(Number(form.accrued || 0) || Number(form.debt_start || 0)) : !!form.manual_override)
    && !form.accrued_date;

  const save = async () => {
    if (dateMissing) return;
    setErr(""); setSaving(true);
    const body = {
      ...form, debt_start: Number(form.debt_start), accrued: Number(form.accrued),
      paid: Number(form.paid), accrued_date: form.accrued_date || null,
    };
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
            <thead><tr className="bg-veil/[0.02]"><th className="th">Налог</th><th className="th text-right">Долг на начало</th><th className="th text-right">Начислено</th><th className="th text-right">Оплачено</th><th className="th text-right">Долг на конец</th><th className="th text-right">Переплата</th><th className="th"></th></tr></thead>
            <tbody>
              {data.rows.map((t) => (
                <tr key={t.id} className="hover:bg-veil/[0.02]">
                  <td className="td font-medium text-ink">{t.name}</td>
                  <td className="td text-right">{fmtNum(t.debt_start)}</td>
                  <td className="td text-right text-amber-300">
                    {fmtNum(t.accrued)}{" "}
                    {t.override_active
                      ? <Badge tone="amber">qo'lda (bu oy)</Badge>
                      : t.auto
                        ? <Badge tone="emerald">авто</Badge>
                        : t.accrued_date
                          ? <span className="text-xs text-slate-500">{fmtDate(t.accrued_date)}</span>
                          : <span className="text-xs text-amber-300">без даты</span>}
                  </td>
                  <td className="td text-right text-emerald-300">{fmtNum(t.paid)}</td>
                  <td className="td text-right font-semibold text-ink">{fmtNum(t.debt_end)}</td>
                  <td className="td text-right text-slate-400">{t.overpay ? fmtNum(t.overpay) : "—"}</td>
                  <td className="td text-right whitespace-nowrap">
                    {isLocked(t.accrued_date) ? <LockedMark title={hint} /> : <>
                      {can("taxes:edit") && <button onClick={() => { setEditing(t); setForm({ name: t.name, period: "", accrued_date: t.accrued_date || "", debt_start: t.debt_start, accrued: t.accrued, paid: t.paid, manual_override: t.manual_override }); setErr(""); setOpen(true); }} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                      {can("taxes:delete") && <button onClick={() => remove(t.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                    </>}
                  </td>
                </tr>
              ))}
              <tr className="bg-veil/[0.03] font-semibold">
                <td className="td text-ink">Итого</td>
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
        «авто» — начислено считается само и уже разложено по датам первичных документов:
        <b> НДС</b> = НДС с продаж − НДС с покупок (по дате продажи / услуги / прихода ТМЦ);
        <b> НДФЛ/ЕСП/ИНПС</b> — из ведомости зарплаты за её месяц.
        Остальные налоги (прибыль, земельный, прочие) вводятся вручную, и им нужна
        <b> дата начисления</b> — сумма попадёт только в тот период, куда входит эта дата.
        «Оплачено» всегда берётся из операций по кодам (94321 НДС, 94319 прибыль и т.д.) — по дате платежа.
      </p>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Налог: остаток и ручные значения" : "Новый налог"}>
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <LockedNotice date={form.accrued_date} />
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Наименование налога"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!!editing} /></Field></div>
          <Field label="Долг на начало"><MoneyInput value={form.debt_start} onChange={(v) => setForm({ ...form, debt_start: v })} /></Field>
          <Field label="Начислено (для ручных налогов)"><MoneyInput value={form.accrued} onChange={(v) => setForm({ ...form, accrued: v })} /></Field>
          {auto && (
            <div className="col-span-2 flex items-center gap-2">
              <input id="taxoverride" type="checkbox" checked={!!form.manual_override}
                onChange={(e) => setForm({ ...form, manual_override: e.target.checked })}
                className="h-4 w-4 accent-accent" />
              <label htmlFor="taxoverride" className="text-sm text-slate-300">
                Qo'lda kiritish (bu oy uchun avto-hisobni bekor qilish)
              </label>
            </div>
          )}
          {manual && (
            <>
              <Field label="Оплачено"><MoneyInput value={form.paid || 0} onChange={(v) => setForm({ ...form, paid: v })} /></Field>
              <div className="col-span-2">
                <Field label="Дата начисления *">
                  <input type="date" min={minOpenDate || undefined} className="input" value={form.accrued_date || ""}
                    onChange={(e) => setForm({ ...form, accrued_date: e.target.value })} />
                  {dateMissing ? (
                    <p className="mt-1 text-xs text-amber-300">
                      Обязательно: без даты налог попадёт в каждый период отчёта
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">
                      сумма попадёт только в тот период, куда входит эта дата
                    </p>
                  )}
                </Field>
              </div>
            </>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          {auto && form.manual_override
            ? "Перебивка авто-расчёта: начислено/оплачено этого месяца берутся отсюда, а не из документов. Со следующего месяца (другая дата начисления) снова считается авто — ничего выключать не нужно."
            : manual
            ? "Ручной налог: и «начислено», и «долг на начало» учитываются по указанной дате."
            : "Этот налог считается автоматически — начисление и его дата берутся из первичных документов (продажи, услуги, приход ТМЦ, ведомость зарплаты). Дата вручную не нужна."}
        </p>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving || !form.name || dateMissing}
          title={dateMissing ? "Укажите дату начисления" : undefined}>Сохранить</button></div>
      </Modal>
    </div>
  );
}
