import { useEffect, useState } from "react";
import api, { apiError } from "../api/client";
import { Card, EmptyState, Modal, SectionTitle, Spinner } from "../components/ui";
import { fmtMoney } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface Month {
  period: string;
  status: "closed" | "next" | "waiting";
  closed_at: string | null;
  closed_by_name: string;
  note: string;
  snapshot: Record<string, number | null>;
  ended: boolean;
}
interface Overview {
  months: Month[];
  next: string | null;
  last_closed: string | null;
  first_data_period: string | null;
}
interface Check {
  code: string;
  ok: boolean;
  level: "ok" | "warn" | "error" | "info";
  title: string;
  detail: string;
}
interface Checks {
  period: string;
  can_close: boolean;
  checks: Check[];
  snapshot: Record<string, number | null>;
}

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

function periodLabel(p: string) {
  const [y, m] = p.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

export default function Closing() {
  const { can } = useAuth();
  const { data, loading, reload } = useApi<Overview>("/periods/overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // по умолчанию открываем очередной месяц — с ним и работают чаще всего
  useEffect(() => {
    if (data && !selected) setSelected(data.next || data.months[0]?.period || null);
  }, [data]);

  useEffect(() => {
    if (!selected) return;
    const [y, m] = selected.split("-");
    setChecking(true);
    setChecks(null);
    api
      .get<Checks>(`/periods/checks?year=${y}&month=${Number(m)}`)
      .then((r) => setChecks(r.data))
      .catch((e) => setErr(apiError(e)))
      .finally(() => setChecking(false));
  }, [selected, data]);

  const month = data?.months.find((m) => m.period === selected);
  const isClosed = month?.status === "closed";
  const canReopen = can("closing:delete") && isClosed && data?.last_closed === selected;

  const close = async () => {
    setErr("");
    setBusy(true);
    try {
      await api.post(`/periods/${selected}`, { note });
      setConfirm(false);
      setNote("");
      setSelected(null);
      reload();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (!window.confirm(`Открыть ${periodLabel(selected!)} обратно? Документы этого месяца снова можно будет менять.`)) return;
    setErr("");
    setBusy(true);
    try {
      await api.delete(`/periods/${selected}`);
      setSelected(null);
      reload();
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading || !data) return <Spinner />;

  return (
    <div>
      <SectionTitle
        title="Закрытие месяца"
        sub="Месяцы закрываются строго подряд. После закрытия документы этого месяца и всех предыдущих меняться не могут"
      />

      {err && (
        <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-4 py-2.5">
          {err}
        </div>
      )}

      {!data.months.length ? (
        <Card><EmptyState text="В системе ещё нет документов — закрывать нечего" /></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 items-start">
          {/* список месяцев */}
          <Card className="!p-2">
            <div className="max-h-[70vh] overflow-y-auto space-y-1">
              {data.months.map((m) => (
                <button
                  key={m.period}
                  onClick={() => setSelected(m.period)}
                  className={`w-full text-left rounded-xl px-3 py-2.5 border transition-colors ${
                    selected === m.period
                      ? "bg-accent/15 border-accent/25 text-ink"
                      : "border-transparent hover:bg-veil/5 text-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium capitalize">{periodLabel(m.period)}</span>
                    <StatusDot status={m.status} />
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {m.status === "closed"
                      ? `закрыт · ${m.closed_by_name || "—"}`
                      : m.status === "next"
                      ? "очередной на закрытие"
                      : m.ended
                      ? "ждёт очереди"
                      : "месяц ещё идёт"}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {/* проверки выбранного месяца */}
          <div className="space-y-4">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-semibold text-ink capitalize">
                    {selected ? periodLabel(selected) : "—"}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {isClosed
                      ? `Закрыт ${month?.closed_by_name || "—"}${month?.note ? ` · ${month.note}` : ""}`
                      : "Проверки перед закрытием"}
                  </p>
                </div>
                <div className="flex gap-2">
                  {canReopen && (
                    <button className="btn-danger" onClick={reopen} disabled={busy}>
                      Открыть обратно
                    </button>
                  )}
                  {!isClosed && can("closing:create") && (
                    <button
                      className="btn-primary"
                      disabled={!checks?.can_close || busy || checking}
                      onClick={() => { setErr(""); setConfirm(true); }}
                      title={checks?.can_close ? "" : "Сначала устраните красные пункты"}
                    >
                      Закрыть месяц
                    </button>
                  )}
                </div>
              </div>

              {checking || !checks ? (
                <Spinner />
              ) : (
                <div className="space-y-2">
                  {checks.checks.map((c) => (
                    <CheckRow key={c.code} check={c} />
                  ))}
                </div>
              )}
            </Card>

            {checks?.snapshot && <SnapshotCard snapshot={checks.snapshot} closed={isClosed} />}
          </div>
        </div>
      )}

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Закрыть месяц">
        <p className="text-sm text-slate-300">
          После закрытия <b className="text-ink capitalize">{selected && periodLabel(selected)}</b> документы
          этого месяца <b className="text-ink">и всех предыдущих</b> изменить будет нельзя: операции, склад,
          зарплата, курс, налоги. Открыть обратно сможет только тот, у кого есть право «Закрытие месяца — открыть».
        </p>
        <div className="mt-4">
          <label className="label">Примечание (необязательно)</label>
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="например: сдан отчёт в налоговую"
          />
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-ghost" onClick={() => setConfirm(false)}>Отмена</button>
          <button className="btn-primary" onClick={close} disabled={busy}>
            {busy ? "Закрываю…" : "Закрыть месяц"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function StatusDot({ status }: { status: Month["status"] }) {
  const map = {
    closed: ["bg-emerald-500/12 text-emerald-300 border-emerald-500/20", "закрыт"],
    next: ["bg-accent/15 text-accent-soft border-accent/25", "очередь"],
    waiting: ["bg-veil/5 text-slate-500 border-line", "ожидает"],
  } as const;
  const [cls, label] = map[status];
  return <span className={`chip border ${cls}`}>{label}</span>;
}

function CheckRow({ check }: { check: Check }) {
  const tone = {
    ok: ["text-emerald-300", "✓"],
    error: ["text-rose-300", "✕"],
    warn: ["text-amber-300", "!"],
    info: ["text-slate-400", "i"],
  }[check.level];
  return (
    <div className="flex items-start gap-3 rounded-xl bg-veil/[0.02] border border-line px-3.5 py-2.5">
      <span className={`mt-0.5 h-5 w-5 shrink-0 grid place-items-center rounded-full bg-veil/5 text-xs font-bold ${tone[0]}`}>
        {tone[1]}
      </span>
      <div className="min-w-0">
        <div className="text-sm text-slate-200">{check.title}</div>
        {check.detail && <div className="text-xs text-slate-400 mt-0.5">{check.detail}</div>}
      </div>
    </div>
  );
}

function SnapshotCard({ snapshot, closed }: { snapshot: Record<string, number | null>; closed: boolean }) {
  const rows: [string, number | null][] = [
    ["Актив баланса", snapshot.assets],
    ["Пассив баланса", snapshot.passive],
    ["Нераспределённая прибыль", snapshot.retained],
    ["Выручка за месяц", snapshot.revenue],
    ["Чистая прибыль (ОФР)", snapshot.net_profit],
    ["Курс на конец месяца", snapshot.rate],
  ];
  return (
    <Card>
      <h3 className="font-semibold text-ink mb-1">Показатели месяца</h3>
      <p className="text-xs text-slate-500 mb-4">
        {closed
          ? "Слепок на момент закрытия — с ним сверяется текущий пересчёт"
          : "Что будет записано в слепок при закрытии"}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-veil/5 p-3">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="text-ink font-semibold tabular-nums">
              {value === null || value === undefined ? "—" : fmtMoney(value)}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
