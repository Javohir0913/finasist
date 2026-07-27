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
import { fmtUSD, fmtDateTime, fmtNum } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useRealtime } from "../store/realtime";

interface Dash {
  kpi: { income_usd: number; expense_usd: number; profit_usd: number; receivable_usd: number; payable_usd: number; margin: number };
  counts: { organizations: number; products: number; materials: number; transactions: number };
  cashflow: { month: string; income: number; expense: number }[];
  expense_breakdown: { name: string; value: number }[];
  production: {
    raw_receipt: number; spare_receipt: number; raw_issue: number;
    production_value: number; production_qty: number;
    raw_stock: number; spare_stock: number; gp_stock: number;
  };
}

const PIE = ["#5b8cff", "#2dd4a7", "#a78bfa", "#fbbf24", "#fb7185", "#38bdf8"];

function chartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass px-3 py-2 text-xs">
      {label && <div className="text-slate-400 mb-1">{label}</div>}
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-slate-300">{p.name}:</span>
          <span className="text-white font-semibold">{fmtUSD(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { data, loading } = useApi<Dash>("/dashboard");
  const { lastEvent } = useRealtime();
  const [feed, setFeed] = useState<{ t: string; text: string; by: string; tone: string }[]>([]);

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

  return (
    <div>
      <SectionTitle title="Финансовый дашборд" sub="Обзор движения средств за август 2025 · данные в USD" />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="Поступления" value={fmtUSD(k.income_usd)} tone="emerald" delta="Приход денежных средств" icon={<Arrow up />} />
        <KpiCard label="Расходы" value={fmtUSD(k.expense_usd)} tone="rose" delta="Расход денежных средств" icon={<Arrow />} />
        <KpiCard label="Чистая прибыль" value={fmtUSD(k.profit_usd)} tone="accent" delta={`Маржа ${k.margin}%`} icon={<Dollar />} />
        <KpiCard label="Дебиторка / Кредиторка" value={fmtUSD(k.receivable_usd)} tone="violet" delta={`Кредиторка ${fmtUSD(Math.abs(k.payable_usd))}`} icon={<Scale />} />
      </div>

      {/* Производство и склад */}
      <Card className="mt-4">
        <h3 className="font-semibold text-white mb-4">Производство и склад <span className="text-xs font-normal text-slate-500">· сум</span></h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-4 gap-3">
          <WCard label="Приход сырья" value={data.production.raw_receipt} tone="text-emerald-300" />
          <WCard label="Приход запчастей" value={data.production.spare_receipt} tone="text-emerald-300" />
          <WCard label="Расход сырья" value={data.production.raw_issue} tone="text-rose-300" />
          <WCard label="Производство ГП" value={data.production.production_value} tone="text-accent-soft" sub={`${data.production.production_qty.toLocaleString("ru-RU")} ед.`} />
          <WCard label="Остаток сырья" value={data.production.raw_stock} tone="text-white" />
          <WCard label="Остаток запчастей" value={data.production.spare_stock} tone="text-white" />
          <WCard label="Остаток ГП" value={data.production.gp_stock} tone="text-white" />
          <WCard label="Всего на складе" value={data.production.raw_stock + data.production.spare_stock + data.production.gp_stock} tone="text-violet2" />
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-white">Движение денежных средств</h3>
              <p className="text-xs text-slate-500">Поступления и расходы по месяцам</p>
            </div>
            <div className="flex gap-4 text-xs">
              <Legend color="#2dd4a7" label="Приход" />
              <Legend color="#fb7185" label="Расход" />
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data.cashflow} margin={{ left: -18, right: 8, top: 6 }}>
              <defs>
                <linearGradient id="gInc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2dd4a7" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#2dd4a7" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fb7185" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#fb7185" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={chartTooltip} />
              <Area type="monotone" dataKey="income" name="Приход" stroke="#2dd4a7" strokeWidth={2} fill="url(#gInc)" />
              <Area type="monotone" dataKey="expense" name="Расход" stroke="#fb7185" strokeWidth={2} fill="url(#gExp)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h3 className="font-semibold text-white mb-1">Структура расходов</h3>
          <p className="text-xs text-slate-500 mb-2">По статьям, USD</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={data.expense_breakdown} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={3} stroke="none">
                {data.expense_breakdown.map((_, i) => (
                  <Cell key={i} fill={PIE[i % PIE.length]} />
                ))}
              </Pie>
              <Tooltip content={chartTooltip} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 mt-2">
            {data.expense_breakdown.slice(0, 4).map((e, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-slate-400 truncate">
                  <span className="h-2 w-2 rounded-full" style={{ background: PIE[i % PIE.length] }} />
                  <span className="truncate">{e.name}</span>
                </span>
                <span className="text-slate-200 font-medium">{fmtUSD(e.value)}</span>
              </div>
            ))}
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
            <h3 className="font-semibold text-white">Живая лента</h3>
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

function WCard({ label, value, tone, sub }: { label: string; value: number; tone: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/5 border border-line p-3.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-lg font-bold mt-1 ${tone}`}>{fmtNum(value)}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-bold text-white">{value}</div>
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
