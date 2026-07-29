import { useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import api, { apiError } from "../api/client";
import { Card, EmptyState, Field, Modal, MoneyInput, SectionTitle, Spinner } from "../components/ui";
import { fmtDate, fmtNum } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface R { id: number; rate_date: string; rate: number }

export default function Exchange() {
  const { can } = useAuth();
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
            <h3 className="font-semibold text-white mb-3">Динамика курса</h3>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chart} margin={{ left: -8, right: 8, top: 6 }}>
                <defs><linearGradient id="gRate" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5b8cff" stopOpacity={0.4} /><stop offset="100%" stopColor="#5b8cff" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="d" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} domain={["dataMin - 30", "dataMax + 30"]} />
                <Tooltip contentStyle={{ background: "#0f1523", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
                <Area type="monotone" dataKey="rate" stroke="#5b8cff" strokeWidth={2} fill="url(#gRate)" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card className="!p-0 overflow-hidden">
            {!data?.length ? <EmptyState text="Нет данных" /> : (
              <table className="w-full">
                <thead><tr className="bg-white/[0.02]"><th className="th">Дата</th><th className="th text-right">Курс (1$ =)</th></tr></thead>
                <tbody>{data.map((r) => (<tr key={r.id} className="hover:bg-white/[0.02]"><td className="td">{fmtDate(r.rate_date)}</td><td className="td text-right font-semibold text-white">{fmtNum(r.rate)} сум</td></tr>))}</tbody>
              </table>
            )}
          </Card>
        </>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Добавить курс">
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Дата"><input type="date" className="input" value={form.rate_date} onChange={(e) => setForm({ ...form, rate_date: e.target.value })} /></Field>
          <Field label="Курс, сум"><MoneyInput value={form.rate} onChange={(v) => setForm({ ...form, rate: Number(v || 0) })} /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving}>Сохранить</button></div>
      </Modal>
    </div>
  );
}
