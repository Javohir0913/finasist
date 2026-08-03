import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import api, { apiError } from "../api/client";
import { Card, EmptyState, Field, Modal, MoneyInput, SectionTitle, Spinner } from "../components/ui";
import { fmtDate, fmtNum } from "../lib/format";
import { LockedMark, LockedNotice, useLock } from "../lib/lock";
import { useApi } from "../lib/useApi";
import { useChartColors } from "../lib/chartColors";
import { useAuth } from "../store/auth";

interface R { id: number; rate_date: string; rate: number }

export default function Exchange() {
  const { can } = useAuth();
  const { minOpenDate, isLocked } = useLock();
  const C = useChartColors();
  const { data, loading, reload } = useApi<R[]>("/exchange");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ rate_date: new Date().toISOString().slice(0, 10), rate: 12550 });
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);

  const save = async () => {
    setErr(""); setSaving(true);
    try { await api.post("/exchange", { ...form, rate: Number(form.rate) }); setOpen(false); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };

  const chart = [...(data || [])].reverse().map((r) => ({ d: fmtDate(r.rate_date), rate: Number(r.rate) }));

  return (
    <div>
      <SectionTitle title="Курс доллара" sub="Динамика курса USD/UZS"
        right={can("exchange:create") && <button className="btn-primary" onClick={() => setOpen(true)}>+ Добавить курс</button>} />

      {loading ? <Spinner /> : (
        <>
          <Card className="mb-4">
            <h3 className="font-semibold text-ink mb-3">Динамика курса</h3>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chart} margin={{ left: -8, right: 8, top: 6 }}>
                <defs><linearGradient id="gRate" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.accent} stopOpacity={0.4} /><stop offset="100%" stopColor={C.accent} stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="d" stroke={C.axis} fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke={C.axis} fontSize={11} tickLine={false} axisLine={false} domain={["dataMin - 30", "dataMax + 30"]} />
                {/* Подсказка recharts рисуется инлайн-стилем — цвета берём из переменных темы */}
                <Tooltip
                  contentStyle={{
                    background: "rgb(var(--c-base-850))",
                    border: "1px solid rgb(var(--c-line))",
                    borderRadius: 12,
                    color: "rgb(var(--c-slate-200))",
                  }}
                  labelStyle={{ color: "rgb(var(--c-slate-400))" }}
                  itemStyle={{ color: "rgb(var(--c-slate-200))" }}
                />
                <Area type="monotone" dataKey="rate" stroke={C.accent} strokeWidth={2} fill="url(#gRate)" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card className="!p-0 overflow-hidden">
            {!data?.length ? <EmptyState text="Нет данных" /> : (
              <table className="w-full">
                <thead><tr className="bg-veil/[0.02]"><th className="th">Дата</th><th className="th text-right">Курс (1$ =)</th></tr></thead>
                <tbody>{data.map((r) => (<tr key={r.id} className="hover:bg-veil/[0.02]"><td className="td">{fmtDate(r.rate_date)}</td><td className="td text-right font-semibold text-ink">{fmtNum(r.rate)} сум</td></tr>))}</tbody>
              </table>
            )}
          </Card>
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Добавить курс">
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <LockedNotice date={form.rate_date} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Дата"><input type="date" min={minOpenDate || undefined} className="input" value={form.rate_date} onChange={(e) => setForm({ ...form, rate_date: e.target.value })} /></Field>
          <Field label="Курс, сум"><MoneyInput value={form.rate} onChange={(v) => setForm({ ...form, rate: Number(v || 0) })} /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving}>Сохранить</button></div>
      </Modal>
    </div>
  );
}
