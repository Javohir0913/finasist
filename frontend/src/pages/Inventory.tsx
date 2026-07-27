import { useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Field, Modal, MoneyInput, SearchSelect, SectionTitle, Spinner } from "../components/ui";
import { fmtDate, fmtNum } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface Ref { id: number; name: string; code?: string; unit?: string; kind?: string; inn?: string }
interface Div { id: number; name: string }
interface Code { id: number; code: string; name: string }

const TABS = [
  { k: "receipt", label: "Приход сырья" },
  { k: "receipt_sp", label: "Приход запчастей" },
  { k: "issue", label: "Расход сырья" },
  { k: "issue_sp", label: "Расход запчастей" },
  { k: "production", label: "Производство ГП" },
  { k: "sale", label: "Продажа ГП" },
];

const today = () => new Date().toISOString().slice(0, 10);

export default function Inventory() {
  const [tab, setTab] = useState("receipt");
  return (
    <div>
      <SectionTitle title="Склад и производство" sub="Приход и расход сырья/запчастей, выпуск и реализация ГП (себестоимость по средней)" />
      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`chip ${tab === t.k ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-white/5 text-slate-400 border border-line"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "receipt" && <Receipts kind="raw" />}
      {tab === "receipt_sp" && <Receipts kind="spare" />}
      {tab === "issue" && <Issues kind="raw" />}
      {tab === "issue_sp" && <Issues kind="spare" />}
      {tab === "production" && <Productions />}
      {tab === "sale" && <Sales />}
    </div>
  );
}

function useRefs() {
  const { data: materials } = useApi<Ref[]>("/materials");
  const { data: products } = useApi<Ref[]>("/products");
  const { data: orgs } = useApi<Ref[]>("/organizations");
  const { data: divs } = useApi<Div[]>("/divisions");
  const { data: expCodes } = useApi<Code[]>("/expense-codes");
  return { materials, products, orgs, divs, expCodes };
}

function Toolbar({ can, onAdd, label }: { can: boolean; onAdd: () => void; label: string }) {
  return can ? <div className="mb-4"><button className="btn-primary" onClick={onAdd}>+ {label}</button></div> : null;
}

// ---------- Приход сырья / запчастей ----------
function Receipts({ kind }: { kind: string }) {
  const { can } = useAuth();
  const { materials, orgs, divs } = useRefs();
  const mats = (materials || []).filter((m) => m.kind === kind);
  const { data: all, loading, reload } = useApi<any[]>("/material-receipts");
  const data = all?.filter((r) => r.material?.kind === kind);
  const [open, setOpen] = useState(false); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const empty = { doc_date: today(), material_id: "", organization_id: "", division: "", qty: 0, price_uzs: 0, vat: false };
  const [form, setForm] = useState<any>(empty); const [editing, setEditing] = useState<any>(null);
  const save = async () => {
    setErr(""); setSaving(true);
    const body = { ...form, material_id: Number(form.material_id), organization_id: form.organization_id ? Number(form.organization_id) : null, qty: Number(form.qty), price_uzs: Number(form.price_uzs) };
    try { if (editing) await api.put(`/material-receipts/${editing.id}`, body); else await api.post("/material-receipts", body); setOpen(false); setForm(empty); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const openEdit = (r: any) => { setEditing(r); setForm({ doc_date: r.doc_date, material_id: String(r.material_id), organization_id: r.organization_id ? String(r.organization_id) : "", division: r.division || "", qty: r.qty, price_uzs: r.price_uzs, vat: r.vat }); setErr(""); setOpen(true); };
  const remove = async (id: number) => { if (confirm("Удалить?")) { await api.delete(`/material-receipts/${id}`); reload(); } };
  return (
    <>
      <Toolbar can={can("materials:create")} onAdd={() => { setEditing(null); setForm(empty); setErr(""); setOpen(true); }} label="Приход" />
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Нет поступлений" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[820px]">
            <thead><tr className="bg-white/[0.02]"><th className="th">Дата</th><th className="th">Материал</th><th className="th">Поставщик</th><th className="th">Подразд.</th><th className="th text-right">Кол-во</th><th className="th text-right">Цена</th><th className="th text-right">Сумма</th><th className="th"></th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className="hover:bg-white/[0.02]">
                <td className="td">{fmtDate(r.doc_date)}</td><td className="td text-white">{r.material?.code && <span className="text-slate-500 font-mono mr-1.5">{r.material.code}</span>}{r.material?.name}</td>
                <td className="td max-w-[160px] truncate">{r.organization?.name || "—"}</td>
                <td className="td">{r.division ? <Badge tone="violet">{r.division}</Badge> : "—"}</td>
                <td className="td text-right">{fmtNum(r.qty)}</td><td className="td text-right">{fmtNum(r.price_uzs)}</td>
                <td className="td text-right font-semibold text-white">{fmtNum(r.amount_uzs)}</td>
                <td className="td text-right whitespace-nowrap">
                  {can("materials:edit") && <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                  {can("materials:delete") && <button onClick={() => remove(r.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title={`${editing ? "Изменить приход" : "Приход"} ${kind === "spare" ? "запчастей" : "сырья"}`}>
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Дата"><input type="date" className="input" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></Field>
          <Field label="Материал"><SearchSelect value={String(form.material_id || "")} onChange={(v) => setForm({ ...form, material_id: v })} placeholder="—" emptyLabel="—" options={mats.map((m) => ({ value: String(m.id), label: m.code ? `${m.code} · ${m.name}` : m.name, search: `${m.code || ""} ${m.name}` }))} /></Field>
          <Field label="Поставщик"><SearchSelect value={String(form.organization_id || "")} onChange={(v) => setForm({ ...form, organization_id: v })} placeholder="—" emptyLabel="—" options={(orgs || []).map((o) => ({ value: String(o.id), label: o.inn ? `${o.name} · ${o.inn}` : o.name, search: `${o.name} ${o.inn || ""}` }))} /></Field>
          <Field label="Подразделение"><SearchSelect value={form.division} onChange={(v) => setForm({ ...form, division: v })} placeholder="—" emptyLabel="—" options={(divs || []).map((d) => ({ value: d.name, label: d.name }))} /></Field>
          <Field label="Количество"><MoneyInput value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} /></Field>
          <Field label="Цена (без НДС), сум"><MoneyInput value={form.price_uzs} onChange={(v) => setForm({ ...form, price_uzs: v })} /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving || !form.material_id}>Сохранить</button></div>
      </Modal>
    </>
  );
}

// ---------- Расход сырья / запчастей ----------
function Issues({ kind }: { kind: string }) {
  const { can } = useAuth();
  const { materials, divs, expCodes } = useRefs();
  const mats = (materials || []).filter((m) => m.kind === kind);
  const { data: all, loading, reload } = useApi<any[]>("/material-issues");
  const data = all?.filter((r) => r.material?.kind === kind);
  const [open, setOpen] = useState(false); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const empty = { doc_date: today(), material_id: "", division: "", expense_code: "", qty: 0, vat: false };
  const [form, setForm] = useState<any>(empty); const [editing, setEditing] = useState<any>(null);
  const save = async () => {
    setErr(""); setSaving(true);
    const body = { ...form, material_id: Number(form.material_id), qty: Number(form.qty) };
    try { if (editing) await api.put(`/material-issues/${editing.id}`, body); else await api.post("/material-issues", body); setOpen(false); setForm(empty); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const openEdit = (r: any) => { setEditing(r); setForm({ doc_date: r.doc_date, material_id: String(r.material_id), division: r.division || "", expense_code: r.expense_code || "", qty: r.qty, vat: r.vat }); setErr(""); setOpen(true); };
  const remove = async (id: number) => { if (confirm("Удалить?")) { await api.delete(`/material-issues/${id}`); reload(); } };
  return (
    <>
      <Toolbar can={can("materials:create")} onAdd={() => { setEditing(null); setForm(empty); setErr(""); setOpen(true); }} label="Расход" />
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Нет расхода" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px]">
            <thead><tr className="bg-white/[0.02]"><th className="th">Дата</th><th className="th">Материал</th><th className="th">Подразд.</th><th className="th">Код</th><th className="th text-right">Кол-во</th><th className="th text-right">Себест.</th><th className="th"></th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className="hover:bg-white/[0.02]">
                <td className="td">{fmtDate(r.doc_date)}</td><td className="td text-white">{r.material?.code && <span className="text-slate-500 font-mono mr-1.5">{r.material.code}</span>}{r.material?.name}</td>
                <td className="td">{r.division ? <Badge tone="violet">{r.division}</Badge> : "—"}</td>
                <td className="td font-mono text-slate-400">{r.expense_code || "—"}</td>
                <td className="td text-right">{fmtNum(r.qty)}</td><td className="td text-right font-semibold text-white">{fmtNum(r.cost_uzs)}</td>
                <td className="td text-right whitespace-nowrap">
                  {can("materials:edit") && <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                  {can("materials:delete") && <button onClick={() => remove(r.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title={`${editing ? "Изменить расход" : "Расход"} ${kind === "spare" ? "запчастей" : "сырья"}`}>
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Дата"><input type="date" className="input" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></Field>
          <Field label="Материал"><SearchSelect value={String(form.material_id || "")} onChange={(v) => setForm({ ...form, material_id: v })} placeholder="—" emptyLabel="—" options={mats.map((m) => ({ value: String(m.id), label: m.code ? `${m.code} · ${m.name}` : m.name, search: `${m.code || ""} ${m.name}` }))} /></Field>
          <Field label="Подразделение"><SearchSelect value={form.division} onChange={(v) => setForm({ ...form, division: v })} placeholder="—" emptyLabel="—" options={(divs || []).map((d) => ({ value: d.name, label: d.name }))} /></Field>
          <Field label="Код расхода"><SearchSelect value={form.expense_code} onChange={(v) => setForm({ ...form, expense_code: v })} placeholder="—" emptyLabel="—" options={(expCodes || []).map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} /></Field>
          <Field label="Количество"><MoneyInput value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} /></Field>
          <div className="col-span-2 flex items-center gap-2"><input id="issvat" type="checkbox" checked={form.vat} onChange={(e) => setForm({ ...form, vat: e.target.checked })} className="h-4 w-4 accent-[#5b8cff]" /><label htmlFor="issvat" className="text-sm text-slate-300">С НДС (12%)</label></div>
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving || !form.material_id}>Сохранить</button></div>
      </Modal>
    </>
  );
}

// ---------- Производство ----------
function Productions() {
  const { can } = useAuth();
  const { products, divs } = useRefs();
  const { data, loading, reload } = useApi<any[]>("/productions");
  const [open, setOpen] = useState(false); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const empty = { doc_date: today(), product_id: "", division: "", qty: 0, unit_cost: 0 };
  const [form, setForm] = useState<any>(empty); const [editing, setEditing] = useState<any>(null);
  const [costHint, setCostHint] = useState<any>(null);
  const autoCost = async (division: string, date: string, qty: any) => {
    if (!division || !date) { setCostHint(null); return; }
    const [y, m] = date.split("-");
    try {
      const { data } = await api.get(`/reports/production-cost?division=${encodeURIComponent(division)}&year=${y}&month=${Number(m)}`);
      // (расход сырья + производств. расходы) / (уже выпущено + текущий выпуск)
      const denom = Number(data.produced_qty || 0) + Number(qty || 0);
      const uc = denom > 0 ? Math.round((Number(data.total_cost) / denom) * 100) / 100 : 0;
      setCostHint({ materials_cost: data.materials_cost, prod_expenses: data.prod_expenses, total_cost: data.total_cost, denom, unit_cost: uc });
      if (uc) setForm((f: any) => ({ ...f, unit_cost: String(uc) }));
    } catch { setCostHint(null); }
  };
  const save = async () => {
    setErr(""); setSaving(true);
    const body = { ...form, product_id: Number(form.product_id), qty: Number(form.qty), unit_cost: Number(form.unit_cost) };
    try { if (editing) await api.put(`/productions/${editing.id}`, body); else await api.post("/productions", body); setOpen(false); setForm(empty); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const openEdit = (r: any) => { setEditing(r); setForm({ doc_date: r.doc_date, product_id: String(r.product_id), division: r.division || "", qty: r.qty, unit_cost: r.unit_cost }); setErr(""); setOpen(true); };
  const remove = async (id: number) => { if (confirm("Удалить?")) { await api.delete(`/productions/${id}`); reload(); } };
  return (
    <>
      <Toolbar can={can("production:create")} onAdd={() => { setEditing(null); setForm(empty); setErr(""); setOpen(true); }} label="Производство" />
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Нет выпуска" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px]">
            <thead><tr className="bg-white/[0.02]"><th className="th">Дата</th><th className="th">Продукция</th><th className="th">Подразд.</th><th className="th text-right">Кол-во</th><th className="th text-right">Себест./ед</th><th className="th text-right">Сумма</th><th className="th"></th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className="hover:bg-white/[0.02]">
                <td className="td">{fmtDate(r.doc_date)}</td><td className="td text-white">{r.product?.code && <span className="text-slate-500 font-mono mr-1.5">{r.product.code}</span>}{r.product?.name}</td>
                <td className="td">{r.division ? <Badge tone="violet">{r.division}</Badge> : "—"}</td>
                <td className="td text-right">{fmtNum(r.qty)}</td><td className="td text-right">{fmtNum(r.unit_cost)}</td>
                <td className="td text-right font-semibold text-white">{fmtNum(r.amount_uzs)}</td>
                <td className="td text-right whitespace-nowrap">
                  {can("production:edit") && <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                  {can("production:delete") && <button onClick={() => remove(r.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Изменить выпуск" : "Производство ГП"}>
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Дата"><input type="date" className="input" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></Field>
          <Field label="Продукция"><SearchSelect value={String(form.product_id || "")} onChange={(v) => setForm({ ...form, product_id: v })} placeholder="—" emptyLabel="—" options={(products || []).map((p) => ({ value: String(p.id), label: p.code ? `${p.code} · ${p.name}` : p.name, search: `${p.code || ""} ${p.name}` }))} /></Field>
          <Field label="Подразделение"><SearchSelect value={form.division} onChange={(v) => { setForm({ ...form, division: v }); autoCost(v, form.doc_date, form.qty); }} placeholder="—" emptyLabel="—" options={(divs || []).map((d) => ({ value: d.name, label: d.name }))} /></Field>
          <Field label="Количество"><MoneyInput value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} /></Field>
          <div className="col-span-2">
            <Field label="Себестоимость за ед., сум (авто из расхода сырья)">
              <div className="flex gap-2">
                <MoneyInput value={form.unit_cost} onChange={(v) => setForm({ ...form, unit_cost: v })} />
                <button type="button" className="btn-ghost !px-3 whitespace-nowrap" onClick={() => autoCost(form.division, form.doc_date, form.qty)} title="Рассчитать из расхода сырья">↻ Авто-расчёт</button>
              </div>
            </Field>
          </div>
        </div>
        {costHint ? (
          <p className="text-xs text-slate-500 mt-2">
            (Сырьё <b className="text-slate-300">{fmtNum(costHint.materials_cost)}</b> + произв. расходы <b className="text-slate-300">{fmtNum(costHint.prod_expenses)}</b>) ÷ выпуск {fmtNum(costHint.denom)} = <b className="text-emerald-300">{fmtNum(costHint.unit_cost)}</b> сум/ед. (можно изменить)
          </p>
        ) : (
          <p className="text-xs text-slate-500 mt-2">Выберите подразделение и кол-во, затем «↻ Авто-расчёт» — себестоимость = (расход сырья + производств. расходы 20xx этого подразделения) ÷ выпуск.</p>
        )}
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving || !form.product_id}>Сохранить</button></div>
      </Modal>
    </>
  );
}

// ---------- Продажа ----------
function Sales() {
  const { can } = useAuth();
  const { products, orgs, divs } = useRefs();
  const { data, loading, reload } = useApi<any[]>("/sales");
  const [open, setOpen] = useState(false); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const empty = { doc_date: today(), product_id: "", organization_id: "", division: "", qty: 0, price_uzs: 0, vat: false };
  const [form, setForm] = useState<any>(empty); const [editing, setEditing] = useState<any>(null);
  const save = async () => {
    setErr(""); setSaving(true);
    const body = { ...form, product_id: Number(form.product_id), organization_id: form.organization_id ? Number(form.organization_id) : null, qty: Number(form.qty), price_uzs: Number(form.price_uzs) };
    try { if (editing) await api.put(`/sales/${editing.id}`, body); else await api.post("/sales", body); setOpen(false); setForm(empty); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const openEdit = (r: any) => { setEditing(r); setForm({ doc_date: r.doc_date, product_id: String(r.product_id), organization_id: r.organization_id ? String(r.organization_id) : "", division: r.division || "", qty: r.qty, price_uzs: r.price_uzs, vat: r.vat }); setErr(""); setOpen(true); };
  const remove = async (id: number) => { if (confirm("Удалить?")) { await api.delete(`/sales/${id}`); reload(); } };
  return (
    <>
      <Toolbar can={can("sales:create")} onAdd={() => { setEditing(null); setForm(empty); setErr(""); setOpen(true); }} label="Продажа" />
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Нет продаж" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[900px]">
            <thead><tr className="bg-white/[0.02]"><th className="th">Дата</th><th className="th">Продукция</th><th className="th">Покупатель</th><th className="th text-right">Кол-во</th><th className="th text-right">Цена</th><th className="th text-right">Выручка</th><th className="th text-right">Себест.</th><th className="th text-right">Прибыль</th><th className="th"></th></tr></thead>
            <tbody>{data.map((r) => (
              <tr key={r.id} className="hover:bg-white/[0.02]">
                <td className="td">{fmtDate(r.doc_date)}</td><td className="td text-white">{r.product?.code && <span className="text-slate-500 font-mono mr-1.5">{r.product.code}</span>}{r.product?.name}</td>
                <td className="td max-w-[150px] truncate">{r.organization?.name || "—"}</td>
                <td className="td text-right">{fmtNum(r.qty)}</td><td className="td text-right">{fmtNum(r.price_uzs)}</td>
                <td className="td text-right text-emerald-300">{fmtNum(r.revenue_net)}</td>
                <td className="td text-right text-slate-400">{fmtNum(r.cogs_uzs)}</td>
                <td className="td text-right font-semibold text-white">{fmtNum(r.revenue_net - r.cogs_uzs)}</td>
                <td className="td text-right whitespace-nowrap">
                  {can("sales:edit") && <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                  {can("sales:delete") && <button onClick={() => remove(r.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Изменить продажу" : "Продажа ГП"}>
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Дата"><input type="date" className="input" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></Field>
          <Field label="Продукция"><SearchSelect value={String(form.product_id || "")} onChange={(v) => setForm({ ...form, product_id: v })} placeholder="—" emptyLabel="—" options={(products || []).map((p) => ({ value: String(p.id), label: p.code ? `${p.code} · ${p.name}` : p.name, search: `${p.code || ""} ${p.name}` }))} /></Field>
          <Field label="Покупатель"><SearchSelect value={String(form.organization_id || "")} onChange={(v) => setForm({ ...form, organization_id: v })} placeholder="—" emptyLabel="—" options={(orgs || []).map((o) => ({ value: String(o.id), label: o.inn ? `${o.name} · ${o.inn}` : o.name, search: `${o.name} ${o.inn || ""}` }))} /></Field>
          <Field label="Подразделение"><SearchSelect value={form.division} onChange={(v) => setForm({ ...form, division: v })} placeholder="—" emptyLabel="—" options={(divs || []).map((d) => ({ value: d.name, label: d.name }))} /></Field>
          <Field label="Количество"><MoneyInput value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} /></Field>
          <Field label="Цена (с НДС), сум"><MoneyInput value={form.price_uzs} onChange={(v) => setForm({ ...form, price_uzs: v })} /></Field>
          <div className="col-span-2 flex items-center gap-2"><input id="svat" type="checkbox" checked={form.vat} onChange={(e) => setForm({ ...form, vat: e.target.checked })} className="h-4 w-4 accent-[#5b8cff]" /><label htmlFor="svat" className="text-sm text-slate-300">С НДС (12%)</label></div>
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving || !form.product_id}>Сохранить</button></div>
      </Modal>
    </>
  );
}
