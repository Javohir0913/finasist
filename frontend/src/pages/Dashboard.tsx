import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, KpiCard, SectionTitle, Spinner } from "../components/ui";
import { fmtDateTime, fmtMoney, makeMoney } from "../lib/format";
import { PeriodPicker, usePeriod, withPeriod } from "../lib/period";
import { useApi } from "../lib/useApi";
import { useChartColors } from "../lib/chartColors";
import { useRealtime } from "../store/realtime";

type Pair = { uzs: number; usd: number };
interface Dash {
  rate: number;
  kpi: {
    income_uzs: number; income_usd: number;
    expense_uzs: number; expense_usd: number;
    profit_uzs: number; profit_usd: number;
    receivable_uzs: number; receivable_usd: number;
    payable_uzs: number; payable_usd: number;
    margin: number;
  };
  counts: { organizations: number; products: number; materials: number; transactions: number };
  cashflow: { month: string; income_uzs: number; expense_uzs: number; income_usd: number; expense_usd: number }[];
  expense_breakdown: { name: string; uzs: number; usd: number }[];
  production: {
    raw_receipt: Pair; spare_receipt: Pair; raw_issue: Pair;
    production_value: Pair; production_qty: number;
    raw_stock: Pair; spare_stock: Pair; gp_stock: Pair; total_stock: Pair;
  };
}

export default function Dashboard() {
  const C = useChartColors();
  const PIE = C.pie;
  const [cur, setCur] = useState<"uzs" | "usd">("uzs");
  const { qs, label } = usePeriod();
  const url = withPeriod("/dashboard", qs);
  const { data, loading } = useApi<Dash>(url, [url]);
  const { lastEvent } = useRealtime();
  const [feed, setFeed] = useState<{ t: string; text: string; by: string; tone: string }[]>([]);

  // одна функция форматирования на весь экран — переключатель меняет только её
  // (данные уже приходят в обеих валютах, поэтому пересчёт не нужен)
  const money = makeMoney(cur);
  const pick = (p: Pair) => (cur === "usd" ? p.usd : p.uzs);

  const tooltip = ({ active, payload, label: l }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="glass px-3 py-2 text-xs">
        {l && <div className="text-slate-400 mb-1">{l}</div>}
        {payload.map((p: any) => (
          <div key={p.name} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
            <span className="text-slate-300">{p.name}:</span>
            <span className="text-ink font-semibold">{money(p.value)}</span>
          </div>
        ))}
      </div>
    );
  };

  useEffect(() => {
    if (!lastEvent) return;
    const [entity, action] = lastEvent.event.split(".");
    const map: any = { transaction: "Операция", organization: "Организация", product: "Продукция", material: "Материал", user: "Пользователь", role: "Роль", tax: "Налог", loan: "Займ", exchange: "Курс" };
    if (!map[entity]) return;
    setFeed((f) =>
      [{ t: new Date().toISOString(), text: `${map[entity]}: ${lastEvent.payload?.detail || action}`, by: lastEvent.payload?.by || "система", tone: action === "delete" ? "rose" : action === "create" ? "emerald" : "accent" }, ...f].slice(0, 8)
    );
  }, [lastEvent]);

  if (loading || !data) return <Spinner />;
  const k = data.kpi;
  const P = data.production;
  const kpi = (base: string) => (cur === "usd" ? (k as any)[`${base}_usd`] : (k as any)[`${base}_uzs`]);

  return (
    <div>
      <SectionTitle
        title="Финансовый дашборд"
        sub={`Обзор движения средств ${label} · ${cur === "usd" ? "в долларах" : "в сумах"}`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodPicker />
            <div className="flex gap-1 rounded-xl bg-veil/5 border border-line p-1">
              {([["uzs", "сум"], ["usd", "$"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setCur(v)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${cur === v ? "bg-accent text-white" : "text-slate-400 hover:text-ink"}`}>{l}</button>
              ))}
            </div>
          </div>
        }
      />
      {cur === "usd" && (
        <div className="mb-4 text-xs text-slate-500">
          Денежные операции — по курсу сделки; складские остатки пересчитаны по курсу
          на конец периода: 1$ = {fmtMoney(data.rate)} сум
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="Поступления" value={money(kpi("income"))} tone="emerald" delta="Приход денежных средств" icon={<Arrow up />} />
        <KpiCard label="Расходы" value={money(kpi("expense"))} tone="rose" delta="Расход денежных средств" icon={<Arrow />} />
        <KpiCard label="Денежный поток" value={money(kpi("profit"))} tone="accent" delta={`Приход − расход, ${k.margin}%`} icon={<Dollar />} />
        <KpiCard label="Дебиторка" value={money(kpi("receivable"))} tone="violet" delta={`Кредиторка ${money(Math.abs(kpi("payable")))}`} icon={<Scale />} />
      </div>

      {/* Производство и склад */}
      <Card className="mt-4">
        <h3 className="font-semibold text-ink mb-4">
          Производство и склад
          <span className="text-xs font-normal text-slate-500"> · {cur === "usd" ? "USD" : "сум"}</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-4 gap-3">
          <WCard label="Приход сырья" value={money(pick(P.raw_receipt))} tone="text-emerald-300" />
          <WCard label="Приход запчастей" value={money(pick(P.spare_receipt))} tone="text-emerald-300" />
          <WCard label="Расход сырья" value={money(pick(P.raw_issue))} tone="text-rose-300" />
          <WCard label="Производство ГП" value={money(pick(P.production_value))} tone="text-accent-soft" sub={`${P.production_qty.toLocaleString("ru-RU")} ед.`} />
          <WCard label="Остаток сырья" value={money(pick(P.raw_stock))} tone="text-ink" />
          <WCard label="Остаток запчастей" value={money(pick(P.spare_stock))} tone="text-ink" />
          <WCard label="Остаток ГП" value={money(pick(P.gp_stock))} tone="text-ink" />
          <WCard label="Всего на складе" value={money(pick(P.total_stock))} tone="text-violet2" />
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-ink">Движение денежных средств</h3>
              <p className="text-xs text-slate-500">Поступления и расходы по месяцам</p>
            </div>
            <div className="flex gap-4 text-xs">
              <Legend color={C.income} label="Приход" />
              <Legend color={C.expense} label="Расход" />
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data.cashflow} margin={{ left: -18, right: 8, top: 6 }}>
              <defs>
                <linearGradient id="gInc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.income} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={C.income} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.expense} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={C.expense} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" stroke={C.axis} fontSize={11} tickLine={false} axisLine={false} />
              <YAxis
                stroke={C.axis} fontSize={11} tickLine={false} axisLine={false}
                tickFormatter={(v) =>
                  cur === "usd" ? `$${(v / 1000).toFixed(0)}k` : `${(v / 1_000_000).toFixed(0)} млн`
                }
              />
              <Tooltip content={tooltip} />
              <Area type="monotone" dataKey={`income_${cur}`} name="Приход" stroke={C.income} strokeWidth={2} fill="url(#gInc)" />
              <Area type="monotone" dataKey={`expense_${cur}`} name="Расход" stroke={C.expense} strokeWidth={2} fill="url(#gExp)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h3 className="font-semibold text-ink mb-1">Структура расходов</h3>
          <p className="text-xs text-slate-500 mb-2">По статьям, {cur === "usd" ? "USD" : "сум"}</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={data.expense_breakdown} dataKey={cur} nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={3} stroke="none">
                {data.expense_breakdown.map((_, i) => (
                  <Cell key={i} fill={PIE[i % PIE.length]} />
                ))}
              </Pie>
              <Tooltip content={tooltip} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 mt-2">
            {data.expense_breakdown.slice(0, 4).map((e, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-slate-400 truncate">
                  <span className="h-2 w-2 rounded-full" style={{ background: PIE[i % PIE.length] }} />
                  <span className="truncate">{e.name}</span>
                </span>
                <span className="text-slate-200 font-medium">{money(cur === "usd" ? e.usd : e.uzs)}</span>
              </div>
            ))}
            {!data.expense_breakdown.length && (
              <p className="text-xs text-slate-500 text-center py-4">За период расходов нет</p>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
        <Card className="xl:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Counter label="Организаций" value={data.counts.organizations} />
            <Counter label="Видов продукции" value={data.counts.products} />
            <Counter label="Позиций сырья" value={data.counts.materials} />
            <Counter label="Операций" value={data.counts.transactions} />
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2 mb-3">
            <span className="h-2 w-2 rounded-full bg-emerald2 animate-pulse-dot" />
            <h3 className="font-semibold text-ink">Живая лента</h3>
          </div>
          {feed.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">Ожидание событий… изменения появятся здесь в реальном времени.</p>
          ) : (
            <div className="space-y-2.5">
              {feed.map((f, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${f.tone === "emerald" ? "bg-emerald2" : f.tone === "rose" ? "bg-rose2" : "bg-accent"}`} />
                  <div className="min-w-0">
                    <div className="text-slate-200 truncate">{f.text}</div>
                    <div className="text-[11px] text-slate-500">{f.by} · {fmtDateTime(f.t)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function WCard({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-veil/5 border border-line p-3.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-lg font-bold mt-1 tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-bold text-ink">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-400">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}
function Arrow({ up }: { up?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: up ? "none" : "rotate(180deg)" }}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
function Dollar() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>;
}
function Scale() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18M3 7h18M7 7l-3 6a3 3 0 0 0 6 0L7 7Zm10 0l-3 6a3 3 0 0 0 6 0l-3-6Z" /></svg>;
}
