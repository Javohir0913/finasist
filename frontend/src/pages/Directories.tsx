import { useState } from "react";
import api, { apiError } from "../api/client";
import { Card, EmptyState, Field, SectionTitle, Spinner } from "../components/ui";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface Code { id: number; code: string; name: string }
interface Div { id: number; name: string }

const TABS = [
  { k: "expense-codes", label: "Статьи расходов" },
  { k: "cashflow-codes", label: "Коды Cash Flow" },
  { k: "divisions", label: "Подразделения" },
];

export default function Directories() {
  const { can } = useAuth();
  const [tab, setTab] = useState("expense-codes");
  const [q, setQ] = useState("");

  return (
    <div>
      <SectionTitle title="Справочники" sub="Статьи расходов, коды Cash Flow и подразделения — выбираются при вводе операций" />
      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => { setTab(t.k); setQ(""); }} className={`chip ${tab === t.k ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-white/5 text-slate-400 border border-line"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "divisions" ? <Divisions canEdit={can("articles:create")} canDel={can("articles:delete")} /> : (
        <CodeTable key={tab} kind={tab} q={q} setQ={setQ} canEdit={can("articles:create")} canDel={can("articles:delete")} />
      )}
    </div>
  );
}

function CodeTable({ kind, q, setQ, canEdit, canDel }: { kind: string; q: string; setQ: (s: string) => void; canEdit: boolean; canDel: boolean }) {
  const { data, loading, reload } = useApi<Code[]>(`/${kind}`);
  const [form, setForm] = useState({ code: "", name: "" });
  const [err, setErr] = useState("");
  const filtered = data?.filter((c) => !q || c.code.includes(q) || c.name.toLowerCase().includes(q.toLowerCase()));

  const add = async () => {
    setErr("");
    try { await api.post(`/${kind}`, form); setForm({ code: "", name: "" }); reload(); }
    catch (e) { setErr(apiError(e)); }
  };
  const remove = async (id: number) => { if (confirm("Удалить код?")) { await api.delete(`/${kind}/${id}`); reload(); } };

  return (
    <>
      {canEdit && (
        <Card className="mb-4">
          {err && <div className="mb-3 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-32"><Field label="Код"><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field></div>
            <div className="flex-1 min-w-[200px]"><Field label="Наименование"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
            <button className="btn-primary" onClick={add} disabled={!form.code || !form.name}>+ Добавить</button>
          </div>
        </Card>
      )}
      <Card className="!p-0 overflow-hidden">
        <div className="p-3 border-b border-line">
          <input className="input max-w-sm" placeholder="Поиск по коду или названию…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="text-xs text-slate-500 ml-3">{filtered?.length ?? 0} из {data?.length ?? 0}</span>
        </div>
        {loading ? <Spinner /> : !filtered?.length ? <EmptyState text="Ничего не найдено" /> : (
          <div className="overflow-x-auto max-h-[60vh]">
            <table className="w-full">
              <thead className="sticky top-0 bg-base-850"><tr><th className="th w-32">Код</th><th className="th">Наименование</th><th className="th"></th></tr></thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-white/[0.02]">
                    <td className="td font-mono text-slate-300">{c.code}</td>
                    <td className="td">{c.name}</td>
                    <td className="td text-right">{canDel && <button onClick={() => remove(c.id)} className="text-slate-500 hover:text-rose-300">✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Divisions({ canEdit, canDel }: { canEdit: boolean; canDel: boolean }) {
  const { data, loading, reload } = useApi<Div[]>("/divisions");
  const [name, setName] = useState("");
  const add = async () => { if (name) { await api.post("/divisions", { name }); setName(""); reload(); } };
  const remove = async (id: number) => { if (confirm("Удалить подразделение?")) { await api.delete(`/divisions/${id}`); reload(); } };
  return (
    <>
      {canEdit && (
        <Card className="mb-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-xs"><Field label="Название подразделения"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
            <button className="btn-primary" onClick={add} disabled={!name}>+ Добавить</button>
          </div>
        </Card>
      )}
      {loading ? <Spinner /> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {data?.map((d) => (
            <Card key={d.id} className="flex items-center justify-between !p-4">
              <span className="font-semibold text-white">{d.name}</span>
              {canDel && <button onClick={() => remove(d.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
