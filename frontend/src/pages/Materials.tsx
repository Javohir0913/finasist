import { useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Field, Modal, MoneyInput, SectionTitle, Spinner } from "../components/ui";
import { fmtNum, fmtUSD } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface M { id: number; code: string; name: string; unit: string; kind: string; source: string; warehouse: string; stock_qty: number; price_usd: number }
export const UNITS = ["м³", "м²", "пог.м", "литр", "тонн", "кг", "шт", "компл.", "рулон", "пачка", "упак.", "м"];
const empty = { code: "", name: "", unit: "м³", kind: "raw", source: "Местный", warehouse: "Основной", stock_qty: 0, price_usd: 0 };

export default function Materials() {
  const { can } = useAuth();
  const [kind, setKind] = useState("");
  const { data, loading, reload } = useApi<M[]>(`/materials${kind ? `?kind=${kind}` : ""}`, [kind]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<M | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);

  const save = async () => {
    setErr(""); setSaving(true);
    const body = { ...form, stock_qty: Number(form.stock_qty), price_usd: Number(form.price_usd) };
    try { if (editing) await api.put(`/materials/${editing.id}`, body); else await api.post("/materials", body); setOpen(false); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (id: number) => { if (confirm("Удалить материал?")) { await api.delete(`/materials/${id}`); reload(); } };

  return (
    <div>
      <SectionTitle title="Сырьё и запчасти" sub="Складские остатки сырья и запасных частей"
        right={can("materials:create") && <button className="btn-primary" onClick={() => { setEditing(null); setForm(empty); setOpen(true); }}>+ Позиция</button>} />

      <div className="flex gap-2 mb-4">
        {[["", "Все"], ["raw", "Сырьё"], ["spare", "Запчасти"]].map(([v, l]) => (
          <button key={v} onClick={() => setKind(v)} className={`chip ${kind === v ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-white/5 text-slate-400 border border-line"}`}>{l}</button>
        ))}
      </div>

      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Позиции не найдены" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead><tr className="bg-white/[0.02]">
                <th className="th">Код</th><th className="th">Наименование</th><th className="th">Тип</th><th className="th">Источник</th>
                <th className="th">Склад</th><th className="th text-right">Остаток</th><th className="th text-right">Цена, сум</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {data.map((m) => (
                  <tr key={m.id} className="hover:bg-white/[0.02]">
                    <td className="td text-slate-400">{m.code}</td>
                    <td className="td font-medium text-white">{m.name}</td>
                    <td className="td"><Badge tone={m.kind === "raw" ? "amber" : "violet"}>{m.kind === "raw" ? "Сырьё" : "Запчасть"}</Badge></td>
                    <td className="td">{m.source}</td>
                    <td className="td">{m.warehouse}</td>
                    <td className="td text-right text-white">{fmtNum(m.stock_qty)} {m.unit}</td>
                    <td className="td text-right">{fmtNum(m.price_usd)}</td>
                    <td className="td text-right whitespace-nowrap">
                      {can("materials:edit") && <button onClick={() => { setEditing(m); setForm({ ...m }); setOpen(true); }} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                      {can("materials:delete") && <button onClick={() => remove(m.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Редактировать позицию" : "Новая позиция"}>
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Код"><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label="Ед. изм."><select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}{form.unit && !UNITS.includes(form.unit) && <option value={form.unit}>{form.unit}</option>}</select></Field>
          <div className="col-span-2"><Field label="Наименование"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
          <Field label="Тип"><select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="raw">Сырьё</option><option value="spare">Запчасть</option></select></Field>
          <Field label="Источник"><select className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}><option>Местный</option><option>Импорт</option></select></Field>
          <Field label="Склад"><input className="input" value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} /></Field>
          <Field label="Остаток"><MoneyInput value={form.stock_qty} onChange={(v) => setForm({ ...form, stock_qty: v })} /></Field>
          <Field label="Цена, сум"><MoneyInput value={form.price_usd} onChange={(v) => setForm({ ...form, price_usd: v })} /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving}>Сохранить</button></div>
      </Modal>
    </div>
  );
}
