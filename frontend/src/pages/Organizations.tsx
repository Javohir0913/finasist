import { useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Field, Modal, MoneyInput, SectionTitle, Spinner } from "../components/ui";
import { fmtNum } from "../lib/format";
import { ORG_CATS, catLabel, catTone } from "../lib/cats";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface Org {
  id: number; inn: string; name: string; category: string; belongs_to: string;
  nds_payer: boolean; nds_type: string; phone: string; balance_usd: number; balance_uzs: number;
}
const empty = { inn: "", name: "", category: "customer", belongs_to: "Прочие", nds_payer: false, nds_type: "", phone: "", balance_usd: 0, balance_uzs: 0 };

export default function Organizations() {
  const { can } = useAuth();
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const { data, loading, reload } = useApi<Org[]>(`/organizations?${cat ? `category=${cat}&` : ""}${q ? `q=${encodeURIComponent(q)}` : ""}`, [cat, q]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Org | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);

  const openNew = () => { setEditing(null); setForm(empty); setErr(""); setOpen(true); };
  const openEdit = (o: Org) => { setEditing(o); setForm({ ...o }); setErr(""); setOpen(true); };

  const save = async () => {
    setErr(""); setSaving(true);
    const body = { ...form, balance_usd: Number(form.balance_usd), balance_uzs: Number(form.balance_uzs) };
    try {
      if (editing) await api.put(`/organizations/${editing.id}`, body);
      else await api.post("/organizations", body);
      setOpen(false); reload();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (id: number) => { if (confirm("Удалить организацию?")) { await api.delete(`/organizations/${id}`); reload(); } };

  return (
    <div>
      <SectionTitle
        title="Реестр организаций"
        sub="Поставщики, заказчики и дебиторско-кредиторская задолженность"
        right={can("organizations:create") && <button className="btn-primary" onClick={openNew}>+ Организация</button>}
      />

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {[["", "Все"], ...ORG_CATS.map((c) => [c.v, c.l])].map(([v, l]) => (
          <button key={v} onClick={() => setCat(v)} className={`chip ${cat === v ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-white/5 text-slate-400 border border-line"}`}>{l}</button>
        ))}
        <input className="input max-w-xs ml-auto" placeholder="Поиск по названию или ИНН…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Организации не найдены" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead><tr className="bg-white/[0.02]">
                <th className="th">Наименование</th><th className="th">ИНН</th><th className="th">Категория</th>
                <th className="th">Цех</th><th className="th">НДС</th><th className="th text-right">Баланс, сум</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {data.map((o) => (
                  <tr key={o.id} className="hover:bg-white/[0.02]">
                    <td className="td font-medium text-white max-w-[240px] truncate">{o.name}</td>
                    <td className="td text-slate-400">{o.inn || "—"}</td>
                    <td className="td"><Badge tone={catTone(o.category)}>{catLabel(o.category)}</Badge></td>
                    <td className="td">{o.belongs_to}</td>
                    <td className="td">{o.nds_payer ? <Badge tone="violet">НДС</Badge> : <span className="text-slate-600">—</span>}</td>
                    <td className={`td text-right font-semibold ${Number(o.balance_uzs) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtNum(o.balance_uzs)}</td>
                    <td className="td text-right whitespace-nowrap">
                      {can("organizations:edit") && <button onClick={() => openEdit(o)} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                      {can("organizations:delete") && <button onClick={() => remove(o.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Редактировать организацию" : "Новая организация"} width="max-w-xl">
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Наименование"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
          <Field label="ИНН"><input className="input" value={form.inn} onChange={(e) => setForm({ ...form, inn: e.target.value })} /></Field>
          <Field label="Телефон"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Категория">
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {ORG_CATS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </Field>
          <Field label="Цех / принадлежность">
            <select className="input" value={form.belongs_to} onChange={(e) => setForm({ ...form, belongs_to: e.target.value })}>
              {["Прочие", "Махстон", "Турк", "Жби"].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="Баланс USD"><MoneyInput value={form.balance_usd} onChange={(v) => setForm({ ...form, balance_usd: v })} /></Field>
          <Field label="Баланс UZS"><MoneyInput value={form.balance_uzs} onChange={(v) => setForm({ ...form, balance_uzs: v })} /></Field>
          <div className="col-span-2 flex items-center gap-2 pt-1">
            <input id="nds" type="checkbox" checked={form.nds_payer} onChange={(e) => setForm({ ...form, nds_payer: e.target.checked })} className="h-4 w-4 accent-[#5b8cff]" />
            <label htmlFor="nds" className="text-sm text-slate-300">Плательщик НДС</label>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</button>
        </div>
      </Modal>
    </div>
  );
}
