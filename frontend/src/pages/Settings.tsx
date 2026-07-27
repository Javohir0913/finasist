import { useEffect, useState } from "react";
import api, { apiError } from "../api/client";
import { Card, SectionTitle, Spinner } from "../components/ui";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface S { key: string; value: string; label: string; group: string; kind: string }

export default function Settings() {
  const { user } = useAuth();
  const { data, loading, reload } = useApi<S[]>("/settings");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const editable = !!user?.is_superadmin;

  useEffect(() => {
    if (data) {
      const v: Record<string, string> = {};
      data.forEach((s) => { v[s.key] = s.kind === "percent" ? String(+(Number(s.value) * 100).toFixed(4)) : s.value; });
      setVals(v);
    }
  }, [data]);

  const save = async (s: S) => {
    setErr(""); setMsg(""); setSaving(s.key);
    let value = vals[s.key];
    if (s.kind === "percent") value = String(Number(vals[s.key]) / 100);
    try { await api.put(`/settings/${s.key}`, { value }); setMsg(`«${s.label}» сохранено`); reload(); }
    catch (e) { setErr(apiError(e)); } finally { setSaving(null); }
  };

  if (loading || !data) return <Spinner />;
  const groups = Array.from(new Set(data.map((s) => s.group)));

  return (
    <div>
      <SectionTitle title="Настройки" sub="Ставки налогов и параметры расчёта — задаются здесь, а не в коде" />
      {!editable && <div className="mb-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm px-4 py-3">Только супер-администратор может изменять эти значения.</div>}
      {msg && <div className="mb-4 rounded-xl bg-emerald-500/12 border border-emerald-500/25 text-emerald-300 text-sm px-4 py-2.5">{msg}</div>}
      {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-4 py-2.5">{err}</div>}

      {groups.map((grp) => (
        <Card key={grp} className="mb-4">
          <h3 className="font-semibold text-white mb-4">{grp}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {data.filter((s) => s.group === grp).map((s) => (
              <div key={s.key} className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="label">{s.label}{s.kind === "percent" && " (%)"}</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    disabled={!editable}
                    value={vals[s.key] ?? ""}
                    onChange={(e) => setVals({ ...vals, [s.key]: e.target.value })}
                  />
                </div>
                {editable && (
                  <button className="btn-primary !px-4" onClick={() => save(s)} disabled={saving === s.key}>
                    {saving === s.key ? "…" : "Сохранить"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}
      <p className="text-xs text-slate-500">
        Пример: НДС 12% = введите <b>12</b>. Изменение ставки влияет на новые расчёты (зарплата, НДС в продажах/услугах, налог на прибыль в ОФР).
      </p>
    </div>
  );
}
