import { useState } from "react";
import api, { apiError } from "../api/client";
import StockEditor from "../components/StockEditor";
import { Card, EmptyState, Field, Modal, MoneyInput, SectionTitle, Spinner } from "../components/ui";
import { fmtNum, withUnit } from "../lib/format";
import { FilterBar, text, useFilter, uzs } from "../lib/table";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";
import { UNITS } from "./Materials";

interface P {
  id: number; code: string; name: string; short_name: string; unit: string;
  opening_qty: number; opening_cost: number; stock_qty: number;
  avg_cost: number; sale_price: number; price_usd: number;
}
const empty = {
  code: "", name: "", short_name: "", unit: "м³",
  opening_qty: 0, opening_cost: 0, sale_price: 0, price_usd: 0,
};

export default function Products() {
  const { can } = useAuth();
  const { data, loading, reload } = useApi<P[]>("/products");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<P | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);

  const save = async () => {
    setErr(""); setSaving(true);
    const body = {
      ...form,
      opening_qty: Number(form.opening_qty || 0),
      opening_cost: Number(form.opening_cost || 0),
      sale_price: Number(form.sale_price || 0),
      price_usd: Number(form.price_usd || 0),
    };
    delete body.stock_qty;   // остаток считает сервер: входящий + выпуск − продажи
    delete body.avg_cost;
    try {
      if (editing) await api.put(`/products/${editing.id}`, body); else await api.post("/products", body);
      setOpen(false); reload();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (id: number) => {
    if (!confirm("Удалить позицию?")) return;
    try { await api.delete(`/products/${id}`); reload(); } catch (e) { alert(apiError(e)); }
  };

  const f = useFilter<P>(
    data,
    (p) => text(p.code, p.name, p.unit, p.stock_qty),
    [{ key: "unit", label: "Ед.", of: (p) => p.unit || "" }]
  );

  return (
    <div>
      <SectionTitle title="Готовая продукция" sub="Номенклатура и складские остатки ГП"
        right={can("products:create") && <button className="btn-primary" onClick={() => { setEditing(null); setForm(empty); setOpen(true); }}>+ Продукция</button>} />

      {!loading && !!data?.length && (
        <>
          <FilterBar f={f} placeholder="Код или наименование…" />
          <Card className="!p-4 mb-4 flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-[11px] text-slate-500">Позиций по фильтру</div>
              <div className="text-white font-semibold tabular-nums">{f.rows.length}</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Стоимость остатка ГП</div>
              <div className="text-amber-300 font-semibold tabular-nums">
                {uzs(f.rows.reduce((a, p) => a + Number(p.stock_qty || 0) * Number(p.avg_cost || 0), 0))}
              </div>
            </div>
          </Card>
        </>
      )}

      {loading ? <Spinner /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {!data?.length && <Card><EmptyState text="Продукция не найдена" /></Card>}
          {!!data?.length && !f.rows.length && <Card><EmptyState text="Под фильтр ничего не подошло" /></Card>}
          {f.rows.map((p) => (
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
                <div className="rounded-xl bg-white/5 p-3"><div className="text-[11px] text-slate-500">Остаток</div><div className="text-white font-semibold tabular-nums">{withUnit(p.stock_qty, p.unit)}</div></div>
                <div className="rounded-xl bg-white/5 p-3"><div className="text-[11px] text-slate-500">Себестоимость</div><div className="text-white font-semibold tabular-nums">{fmtNum(p.avg_cost)}</div></div>
                <div className="rounded-xl bg-white/5 p-3"><div className="text-[11px] text-slate-500">Входящий остаток</div><div className="text-slate-300 font-semibold tabular-nums">{withUnit(p.opening_qty, p.unit)}</div></div>
                <div className="rounded-xl bg-white/5 p-3"><div className="text-[11px] text-slate-500">Прайс, сум</div><div className="text-slate-300 font-semibold tabular-nums">{fmtNum(p.sale_price)}</div></div>
              </div>
              <div className="mt-3 text-sm text-slate-400">Стоимость остатка: <span className="text-emerald-300 font-semibold">{fmtNum(Number(p.stock_qty) * Number(p.avg_cost))} сум</span></div>
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
          <Field label="Краткое наименование"><input className="input" value={form.short_name} onChange={(e) => setForm({ ...form, short_name: e.target.value })} /></Field>
          <Field label="Прайс (цена продажи), сум"><MoneyInput value={form.sale_price} onChange={(v) => setForm({ ...form, sale_price: v })} /></Field>
          <div className="col-span-2 border-t border-line pt-3">
            <p className="text-xs text-slate-500">
              Входящий остаток — количество и средняя себестоимость на дату начала учёта (лист «Остаток ГП»).
              Текущий остаток пересчитывается автоматически: входящий + производство − продажи.
            </p>
          </div>
          <Field label="Входящий остаток (общий склад), кол-во"><MoneyInput value={form.opening_qty} onChange={(v) => setForm({ ...form, opening_qty: v })} /></Field>
          <Field label="Входящая себестоимость, сум"><MoneyInput value={form.opening_cost} onChange={(v) => setForm({ ...form, opening_cost: v })} /></Field>
          {editing && <div className="col-span-2"><ProductStocks product={editing} /></div>}
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving}>Сохранить</button></div>
      </Modal>
    </div>
  );
}

/** Остатки ГП по объектам — на каждой дробилке своя себестоимость. */
function ProductStocks({ product }: { product: P }) {
  const { data, reload } = useApi<any>(`/product-stocks?product_id=${product.id}`, [product.id]);
  const { data: divs } = useApi<{ name: string }[]>("/divisions");
  return (
    <StockEditor
      title="Остатки ГП по объектам"
      hint="Входящий остаток — то, что лежало на объекте до начала учёта. Текущий и себестоимость считаются автоматически: входящий + выпуск − продажи."
      costLabel="Входящая с/с"
      url="/product-stocks"
      idField="product_id"
      id={product.id}
      unit={product.unit}
      rows={data?.rows}
      divisions={divs}
      reload={reload}
    />
  );
}
