import { useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Field, Modal, SearchSelect, SectionTitle, Spinner } from "../components/ui";
import { fmtDate } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface Role { id: number; name: string }
interface Org { id: number; name: string; inn?: string }
interface U { id: number; email: string; full_name: string; is_active: boolean; is_superadmin: boolean; role: Role | null; role_id: number | null; organization_id: number | null; created_at: string }

const empty = { email: "", full_name: "", password: "", role_id: "", organization_id: "", is_active: true };

export default function Users() {
  const { can } = useAuth();
  const { data, loading, reload } = useApi<U[]>("/users");
  const { data: roles } = useApi<Role[]>("/roles");
  const { data: orgs } = useApi<Org[]>("/organizations");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<U | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);

  const openNew = () => { setEditing(null); setForm(empty); setErr(""); setOpen(true); };
  const openEdit = (u: U) => { setEditing(u); setForm({ email: u.email, full_name: u.full_name, password: "", role_id: u.role_id ?? "", organization_id: u.organization_id ?? "", is_active: u.is_active }); setErr(""); setOpen(true); };

  const save = async () => {
    setErr(""); setSaving(true);
    const body: any = {
      full_name: form.full_name, is_active: form.is_active,
      role_id: form.role_id ? Number(form.role_id) : null,
      organization_id: form.organization_id ? Number(form.organization_id) : null,
    };
    try {
      if (editing) { if (form.password) body.password = form.password; await api.put(`/users/${editing.id}`, body); }
      else await api.post("/users", { ...body, email: form.email, password: form.password });
      setOpen(false); reload();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (u: U) => { if (confirm(`Удалить пользователя ${u.email}?`)) { try { await api.delete(`/users/${u.id}`); reload(); } catch (e) { alert(apiError(e)); } } };

  return (
    <div>
      <SectionTitle title="Пользователи" sub="Учётные записи, роли и привязка к контрагентам"
        right={can("users:create") && <button className="btn-primary" onClick={openNew}>+ Пользователь</button>} />

      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Пользователи не найдены" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead><tr className="bg-white/[0.02]">
                <th className="th">Пользователь</th><th className="th">Email</th><th className="th">Роль</th>
                <th className="th">Статус</th><th className="th">Создан</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.02]">
                    <td className="td">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet2 to-accent grid place-items-center text-[11px] font-bold text-white">{u.full_name.split(" ").map((s) => s[0]).slice(0, 2).join("")}</div>
                        <span className="font-medium text-white">{u.full_name}</span>
                      </div>
                    </td>
                    <td className="td text-slate-400">{u.email}</td>
                    <td className="td">{u.is_superadmin ? <Badge tone="violet">Супер-админ</Badge> : u.role ? <Badge tone="accent">{u.role.name}</Badge> : <Badge tone="rose">Без доступа</Badge>}</td>
                    <td className="td">{u.is_active ? <Badge tone="emerald">Активен</Badge> : <Badge tone="slate">Отключён</Badge>}</td>
                    <td className="td text-slate-400">{fmtDate(u.created_at)}</td>
                    <td className="td text-right whitespace-nowrap">
                      {can("users:edit") && !u.is_superadmin && <button onClick={() => openEdit(u)} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                      {can("users:delete") && !u.is_superadmin && <button onClick={() => remove(u)} className="text-slate-500 hover:text-rose-300">✕</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Редактировать пользователя" : "Новый пользователь"} width="max-w-lg">
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="ФИО"><input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field></div>
          <div className="col-span-2"><Field label="Email"><input className="input" value={form.email} disabled={!!editing} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field></div>
          <div className="col-span-2"><Field label={editing ? "Новый пароль (оставьте пустым)" : "Пароль"}><input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field></div>
          <Field label="Роль">
            <select className="input" value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
              <option value="">— без доступа —</option>
              {roles?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Контрагент (поставщик/заказчик)">
            <SearchSelect value={String(form.organization_id || "")} onChange={(v) => setForm({ ...form, organization_id: v })} placeholder="— не привязан —" emptyLabel="— не привязан —"
              options={(orgs || []).map((o) => ({ value: String(o.id), label: o.inn ? `${o.name} · ${o.inn}` : o.name, search: `${o.name} ${o.inn || ""}` }))} />
          </Field>
          <div className="col-span-2 flex items-center gap-2 pt-1">
            <input id="active" type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="h-4 w-4 accent-[#5b8cff]" />
            <label htmlFor="active" className="text-sm text-slate-300">Учётная запись активна</label>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</button></div>
      </Modal>
    </div>
  );
}
