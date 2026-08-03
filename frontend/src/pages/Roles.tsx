import { useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Field, Modal, SectionTitle, Spinner } from "../components/ui";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface Role { id: number; name: string; description: string; is_system: boolean; permissions: string[] }
interface CatItem { module: string; label: string; actions: string[] }

const ACT_LABEL: any = {
  view: "Просмотр", create: "Создание", edit: "Изменение", delete: "Удаление",
  export: "Экспорт",
  // только у модуля «Закрытие месяца»: видеть документы закрытых периодов
  history: "Видеть закрытые",
};

export default function Roles() {
  const { can } = useAuth();
  const { data: roles, loading, reload } = useApi<Role[]>("/roles");
  const { data: catalog } = useApi<CatItem[]>("/roles/permissions/catalog");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [form, setForm] = useState<{ name: string; description: string; permissions: string[] }>({ name: "", description: "", permissions: [] });
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);

  const openNew = () => { setEditing(null); setForm({ name: "", description: "", permissions: [] }); setErr(""); setOpen(true); };
  const openEdit = (r: Role) => { setEditing(r); setForm({ name: r.name, description: r.description, permissions: [...r.permissions] }); setErr(""); setOpen(true); };

  const toggle = (perm: string) => setForm((f) => ({ ...f, permissions: f.permissions.includes(perm) ? f.permissions.filter((p) => p !== perm) : [...f.permissions, perm] }));
  const toggleModule = (item: CatItem) => {
    const perms = item.actions.map((a) => `${item.module}:${a}`);
    const allOn = perms.every((p) => form.permissions.includes(p));
    setForm((f) => ({ ...f, permissions: allOn ? f.permissions.filter((p) => !perms.includes(p)) : Array.from(new Set([...f.permissions, ...perms])) }));
  };

  const save = async () => {
    setErr(""); setSaving(true);
    try {
      if (editing) await api.put(`/roles/${editing.id}`, form); else await api.post("/roles", form);
      setOpen(false); reload();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (r: Role) => { if (confirm(`Удалить роль «${r.name}»?`)) { try { await api.delete(`/roles/${r.id}`); reload(); } catch (e) { alert(apiError(e)); } } };

  return (
    <div>
      <SectionTitle title="Роли и доступы" sub="Гранулярное управление правами. Новые роли не имеют прав по умолчанию."
        right={can("roles:create") && <button className="btn-primary" onClick={openNew}>+ Новая роль</button>} />

      {loading ? <Spinner /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {!roles?.length && <Card><EmptyState text="Роли не найдены" /></Card>}
          {roles?.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-ink">{r.name}</h3>
                    {r.is_system && <Badge tone="violet">Системная</Badge>}
                  </div>
                  <p className="text-sm text-slate-400 mt-1">{r.description || "—"}</p>
                </div>
                <div className="whitespace-nowrap">
                  {can("roles:edit") && <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                  {can("roles:delete") && !r.is_system && <button onClick={() => remove(r)} className="text-slate-500 hover:text-rose-300">✕</button>}
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <div className="text-2xl font-bold text-ink">{r.permissions.length}</div>
                <div className="text-xs text-slate-500 leading-tight">назначенных<br />прав</div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Роль: ${editing.name}` : "Новая роль"} width="max-w-3xl">
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <Field label="Название роли"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Описание"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>

        <div className="label mb-2">Матрица прав доступа</div>
        <div className="max-h-[46vh] overflow-y-auto space-y-2 pr-1">
          {catalog?.map((item) => {
            const perms = item.actions.map((a) => `${item.module}:${a}`);
            const allOn = perms.every((p) => form.permissions.includes(p));
            const someOn = perms.some((p) => form.permissions.includes(p));
            return (
              <div key={item.module} className="rounded-xl bg-veil/5 border border-line p-3">
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => toggleModule(item)} className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <span className={`h-4 w-4 rounded grid place-items-center border ${allOn ? "bg-accent border-accent" : someOn ? "bg-accent/40 border-accent/50" : "border-line"}`}>{allOn && <span className="text-[10px] text-white">✓</span>}</span>
                    {item.label}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.actions.map((a) => {
                    const p = `${item.module}:${a}`;
                    const on = form.permissions.includes(p);
                    return (
                      <button key={a} onClick={() => toggle(p)} className={`chip ${on ? "bg-accent/15 text-accent-soft border border-accent/30" : "bg-veil/5 text-slate-400 border border-line"}`}>
                        {ACT_LABEL[a] || a}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-5">
          <span className="text-xs text-slate-500">Выбрано прав: <span className="text-ink font-semibold">{form.permissions.length}</span></span>
          <div className="flex gap-2"><button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button><button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</button></div>
        </div>
      </Modal>
    </div>
  );
}
