import { useState } from "react";
import api, { apiError } from "../api/client";
import StockEditor from "../components/StockEditor";
import { Badge, Card, EmptyState, Field, Modal, MoneyInput, SectionTitle, Spinner } from "../components/ui";
import { fmtNum, withUnit } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface M {
  id: number; code: string; name: string; unit: string; kind: string; source: string;
  warehouse: string; opening_qty: number; opening_cost: number;
  stock_qty: number; avg_cost: number; price_usd: number;
}
export const UNITS = ["м³", "м²", "пог.м", "литр", "тонн", "кг", "шт", "компл.", "рулон", "пачка", "упак.", "м"];
const empty = {
  code: "", name: "", unit: "м³", kind: "raw", source: "Местный", warehouse: "Основной",
  opening_qty: 0, opening_cost: 0, price_usd: 0,
};

export default function Materials() {
  const { can } = useAuth();
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const { data, loading, reload } = useApi<M[]>(`/materials${kind ? `?kind=${kind}` : ""}`, [kind]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<M | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const rows = data?.filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()) || (m.code || "").toLowerCase().includes(q.toLowerCase()));

  const save = async () => {
    setErr(""); setSaving(true);
    const body = {
      ...form,
      opening_qty: Number(form.opening_qty || 0),
      opening_cost: Number(form.opening_cost || 0),
      price_usd: Number(form.price_usd || 0),
    };
    delete body.stock_qty;   // остаток считает сервер: входящий + приход − расход
    delete body.avg_cost;
    try { if (editing) await api.put(`/materials/${editing.id}`, body); else await api.post("/materials", body); setOpen(false); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (id: number) => {
    if (!confirm("Удалить материал?")) return;
    try { await api.delete(`/materials/${id}`); reload(); } catch (e) { alert(apiError(e)); }
  };

  return (
    <div>
      <SectionTitle title="Сырьё и запчасти" sub="Номенклатура, входящие остатки и средняя себестоимость"
        right={can("materials:create") && <button className="btn-primary" onClick={() => { setEditing(null); setForm(empty); setOpen(true); }}>+ Позиция</button>} />

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {[["", "Все"], ["raw", "Сырьё"], ["spare", "Запчасти"]].map(([v, l]) => (
          <button key={v} onClick={() => setKind(v)} className={`chip ${kind === v ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-white/5 text-slate-400 border border-line"}`}>{l}</button>
        ))}
        <input className="input max-w-xs ml-auto" placeholder="Поиск по коду или названию…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-xs text-slate-500">{rows?.length ?? 0} из {data?.length ?? 0}</span>
      </div>

      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !rows?.length ? <EmptyState text="Позиции не найдены" /> : (
          <div className="overflow-x-auto max-h-[65vh]">
            <table className="w-full min-w-[900px]">
              <thead className="sticky top-0 bg-base-850 z-10"><tr>
                <th className="th">Код</th><th className="th">Наименование</th><th className="th">Тип</th><th className="th">Источник</th>
                <th className="th text-right">Входящий остаток</th><th className="th text-right">Текущий остаток</th>
                <th className="th text-right">Ср. себестоимость</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="hover:bg-white/[0.02]">
                    <td className="td text-slate-400 font-mono">{m.code}</td>
                    <td className="td font-medium text-white">{m.name}</td>
                    <td className="td"><Badge tone={m.kind === "raw" ? "amber" : "violet"}>{m.kind === "raw" ? "Сырьё" : "Запчасть"}</Badge></td>
                    <td className="td text-slate-400">{m.source}</td>
                    <td className="td text-right text-slate-400 tabular-nums">{withUnit(m.opening_qty, m.unit)}</td>
                    <td className="td text-right text-white tabular-nums">{withUnit(m.stock_qty, m.unit)}</td>
                    <td className="td text-right tabular-nums">{fmtNum(m.avg_cost)}</td>
                    <td className="td text-right whitespace-nowrap">
                      {can("materials:edit") && <button onClick={() => { setEditing(m); setForm({ ...m }); setOpen(true); }} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                      {can("materials:delete") && <button onClick={() => remove(m.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* количества в разных единицах не складываем — итог только в деньгах */}
              <tfoot className="sticky bottom-0 bg-base-850">
                <tr className="border-t-2 border-line font-semibold text-white">
                  <td className="td whitespace-nowrap text-slate-300" colSpan={6}>
                    Итого по фильтру · {rows.length} позиц. · стоимость запаса
                  </td>
                  <td className="td text-right tabular-nums text-amber-300 whitespace-nowrap">
                    {fmtNum(rows.reduce((a, m) => a + Number(m.stock_qty || 0) * Number(m.avg_cost || 0), 0))}
                  </td>
                  <td className="td" />
                </tr>
              </tfoot>
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
          <Field label="Цена, сум"><MoneyInput value={form.price_usd} onChange={(v) => setForm({ ...form, price_usd: v })} /></Field>
          <div className="col-span-2 border-t border-line pt-3">
            <p className="text-xs text-slate-500">
              Входящий остаток — количество и средняя цена на дату начала учёта (лист «Остаток сырья и запчастей»).
              Текущий остаток пересчитывается автоматически: входящий + приход − расход.
            </p>
          </div>
          <Field label="Входящий остаток (общий склад), кол-во"><MoneyInput value={form.opening_qty} onChange={(v) => setForm({ ...form, opening_qty: v })} /></Field>
          <Field label="Входящая средняя цена, сум"><MoneyInput value={form.opening_cost} onChange={(v) => setForm({ ...form, opening_cost: v })} /></Field>
          {editing && <div className="col-span-2"><StocksByDivision material={editing} /></div>}
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving}>Сохранить</button></div>
      </Modal>
    </div>
  );
}

/** Остатки и входящие сальдо по дробилкам — как на листе «Остаток сырья и запчастей». */
function StocksByDivision({ material }: { material: M }) {
  const { data, reload } = useApi<any>(`/material-stocks?material_id=${material.id}`, [material.id]);
  const { data: divs } = useApi<{ name: string }[]>("/divisions");
  return (
    <StockEditor
      title="Остатки по объектам (дробилкам)"
      hint="Входящий остаток — то, что лежало на объекте до начала учёта. Текущий и средняя цена считаются автоматически: входящий + приход − расход."
      url="/material-stocks"
      idField="material_id"
      id={material.id}
      unit={material.unit}
      rows={data?.rows}
      divisions={divs}
      reload={reload}
    />
  );
}
