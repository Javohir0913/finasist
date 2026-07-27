import { useState } from "react";
import api, { apiError } from "../api/client";
import { Card, EmptyState, Field, Modal, MoneyInput, SectionTitle, Spinner } from "../components/ui";
import { fmtNum, fmtUSD } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";
import { UNITS } from "./Materials";

interface P { id: number; code: string; name: string; short_name: string; unit: string; stock_qty: number; price_usd: number }
const empty = { code: "", name: "", short_name: "", unit: "м³", stock_qty: 0, price_usd: 0 };

export default function Products() {
  const { can } = useAuth();
  const { data, loading, reload } = useApi<P[]>("/products");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<P | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);

  const save = async () => {
    setErr(""); setSaving(true);
    const body = { ...form, stock_qty: Number(form.stock_qty), price_usd: Number(form.price_usd) };
    try {
      if (editing) await api.put(`/products/${editing.id}`, body); else await api.post("/products", body);
      setOpen(false); reload();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (id: number) => { if (confirm("Удалить позицию?")) { await api.delete(`/products/${id}`); reload(); } };

  return (
    <div>
      <SectionTitle title="Готовая продукция" sub="Номенклатура и складские остатки ГП"
        right={can("products:create") && <button className="btn-primary" onClick={() => { setEditing(null); setForm(empty); setOpen(true); }}>+ Продукция</button>} />

      {loading ? <Spinner /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {!data?.length && <Card><EmptyState text="Продукция не найдена" /></Card>}
          {data?.map((p) => (
            <Card key={p.id} className="flex flex-col">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-slate-500">Код {p.code}</div>
                  <div className="text-lg font-semibold text-white mt-0.5">{p.name}</div>
                </div>
                <div className="text-right">
                  {can("products:edit") && <button onClick={() => { setEditing(p); setForm({ ...p }); setOpen(true); }} className="text-slate-500 hover:text-accent-soft mr-2">✎</button>}
                  {can("products:delete") && <button onClick={() => remove(p.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/5 p-3"><div className="text-[11px] text-slate-500">Остаток</div><div className="text-white font-semibold">{fmtNum(p.stock_qty)} {p.unit}</div></div>
                <div className="rounded-xl bg-white/5 p-3"><div className="text-[11px] text-slate-500">Цена, сум</div><div className="text-white font-semibold">{fmtNum(p.price_usd)}</div></div>
              </div>
              <div className="mt-3 text-sm text-slate-400">Стоимость остатка: <span className="text-emerald-300 font-semibold">{fmtNum(p.stock_qty * p.price_usd)} сум</span></div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Редактировать продукцию" : "Новая продукция"}>
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Код"><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label="Ед. изм."><select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}{form.unit && !UNITS.includes(form.unit) && <option value={form.unit}>{form.unit}</option>}</select></Field>
          <div className="col-span-2"><Field label="Наименование"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
          <Field label="Остаток"><MoneyInput value={form.stock_qty} onChange={(v) => setForm({ ...form, stock_qty: v })} /></Field>
          <Field label="Цена, сум"><MoneyInput value={form.price_usd} onChange={(v) => setForm({ ...form, price_usd: v })} /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving}>Сохранить</button></div>
      </Modal>
    </div>
  );
}
