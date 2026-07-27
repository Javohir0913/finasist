import { createContext, useContext, useState } from "react";
import { Card, EmptyState, SectionTitle, Spinner } from "../components/ui";
import { ORG_CATS } from "../lib/cats";
import { fmtMoney, fmtMoney2 } from "../lib/format";
import { useApi } from "../lib/useApi";

// currency context: все отчёты считаются в сумах, конвертация в USD по курсу
const CurCtx = createContext<{ money: (v: number) => string; cur: string }>({ money: (v) => String(v), cur: "uzs" });
const useMoney = () => useContext(CurCtx).money;

interface CF {
  bank: { in: number; out: number; end: number };
  kassa: { in: number; out: number; end: number };
  total: { in: number; out: number; end: number };
  by_code: { code: string; name: string; in: number; out: number }[];
}
interface Exp {
  groups: { prod: number; sell: number; admin: number; other: number; period: number; total: number };
  items: { code: string; name: string; amount: number }[];
}

const TABS = [
  { k: "pnl", label: "ОФР (P&L)" },
  { k: "balance", label: "Баланс" },
  { k: "cashflow", label: "Cash Flow (ДДС)" },
  { k: "daily", label: "Остатки по дням" },
  { k: "counterparties", label: "Дт-Кт" },
  { k: "fx", label: "Курсовая разница" },
  { k: "expenses", label: "Расходы" },
  { k: "cost", label: "Себестоимость (С-сть)" },
  { k: "matturn", label: "Оборот сырья" },
  { k: "spturn", label: "Оборот запчастей" },
  { k: "materials", label: "Остаток сырья" },
  { k: "spare", label: "Остаток запчастей" },
  { k: "gpturn", label: "ГП оборот" },
  { k: "products", label: "Остаток ГП" },
];

export default function Reports() {
  const [tab, setTab] = useState("pnl");
  const [cur, setCur] = useState("uzs");
  const { data: rates } = useApi<{ rate_date: string; rate: number }[]>("/exchange");
  const rate = rates && rates.length ? Number(rates[0].rate) || 1 : 1; // список по убыванию даты -> [0] последний курс
  const money = (v: number) =>
    cur === "usd" ? "$" + fmtMoney2(Number(v || 0) / rate) : fmtMoney(v) + " сум";

  return (
    <CurCtx.Provider value={{ money, cur }}>
      <SectionTitle
        title="Финансовые отчёты"
        sub="ОФР (Форма №2), Баланс (Форма №1), Cash Flow, Дт-Кт, склад"
        right={
          <div className="flex gap-1 rounded-xl bg-white/5 border border-line p-1">
            {[["uzs", "сум"], ["usd", "$"]].map(([v, l]) => (
              <button key={v} onClick={() => setCur(v)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${cur === v ? "bg-accent text-white" : "text-slate-400 hover:text-white"}`}>{l}</button>
            ))}
          </div>
        }
      />
      {cur === "usd" && <div className="mb-4 text-xs text-slate-500">Пересчёт в USD по последнему курсу: 1$ = {fmtMoney(rate)} сум</div>}
      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`chip ${tab === t.k ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-white/5 text-slate-400 border border-line"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "pnl" && <PnL />}
      {tab === "balance" && <BalanceSheet />}
      {tab === "cashflow" && <CashFlow />}
      {tab === "daily" && <DailyBalance />}
      {tab === "counterparties" && <Counterparties />}
      {tab === "fx" && <FxDiff />}
      {tab === "expenses" && <Expenses />}
      {tab === "cost" && <CostReport />}
      {tab === "matturn" && <MatTurnover kind="raw" title="Оборот сырья на складе" />}
      {tab === "spturn" && <MatTurnover kind="spare" title="Оборот запчастей на складе" />}
      {tab === "materials" && <Warehouse url="/reports/materials?kind=raw" title="Остатки сырья" />}
      {tab === "spare" && <Warehouse url="/reports/materials?kind=spare" title="Остатки запчастей" />}
      {tab === "gpturn" && <GpTurnover />}
      {tab === "products" && <Warehouse url="/reports/products" title="Остатки готовой продукции" />}
    </CurCtx.Provider>
  );
}

function DivSelect({ div, setDiv }: { div: string; setDiv: (v: string) => void }) {
  const { data: divs } = useApi<{ name: string }[]>("/divisions");
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      <button onClick={() => setDiv("")} className={`chip ${!div ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-white/5 text-slate-400 border border-line"}`}>Всё предприятие</button>
      {(divs || []).map((d) => (
        <button key={d.name} onClick={() => setDiv(d.name)} className={`chip ${div === d.name ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-white/5 text-slate-400 border border-line"}`}>{d.name}</button>
      ))}
    </div>
  );
}

function PnL() {
  const money = useMoney();
  const [div, setDiv] = useState("");
  const { data, loading } = useApi<any>(`/reports/pnl${div ? `?division=${encodeURIComponent(div)}` : ""}`, [div]);
  if (loading || !data) return (<><DivSelect div={div} setDiv={setDiv} /><Spinner /></>);
  return (<><DivSelect div={div} setDiv={setDiv} /><PnLBody data={data} money={money} /></>);
}

function PnLBody({ data, money }: { data: any; money: (v: number) => string }) {
  const R = (l: string, v: number, opts: { bold?: boolean; tone?: string; ind?: boolean } = {}) => (
    <div className={`flex justify-between py-2 ${opts.bold ? "border-t border-line font-semibold text-white" : "text-slate-300"} ${opts.ind ? "pl-4 text-sm text-slate-400" : ""}`}>
      <span>{l}</span><span className={`font-mono ${opts.tone || ""}`}>{money(v)}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <h3 className="font-semibold text-white mb-2">Отчёт о финансовых результатах</h3>
        {R("Выручка от реализации (без НДС)", data.revenue, { tone: "text-emerald-300" })}
        {R("Себестоимость реализации", -data.cogs, { ind: true })}
        {R("Валовая прибыль", data.gross, { bold: true })}
        {R("Расходы по реализации (941x)", -data.sell, { ind: true })}
        {R("Административные расходы (942x)", -data.admin, { ind: true })}
        {R("Прочие операц. расходы (943x)", -data.other, { ind: true })}
        {R("Операционная прибыль", data.op_profit, { bold: true })}
        {R("Налог на прибыль (15%)", -data.tax, { ind: true })}
        {R("ЧИСТАЯ ПРИБЫЛЬ", data.net, { bold: true, tone: data.net >= 0 ? "text-emerald-300" : "text-rose-300" })}
      </Card>
      <div className="grid grid-cols-2 gap-4 content-start">
        <Stat label="Выручка" value={money(data.revenue)} tone="text-emerald-300" />
        <Stat label="Чистая прибыль" value={money(data.net)} tone={data.net >= 0 ? "text-emerald-300" : "text-rose-300"} />
        <Stat label="Валовая маржа" value={`${data.gross_margin}%`} tone="text-accent-soft" />
        <Stat label="Чистая маржа" value={`${data.net_margin}%`} tone="text-violet2" />
        <div className="col-span-2"><Stat label="Производственные расходы (в с/с)" value={money(data.prod_expenses)} tone="text-amber-300" /></div>
      </div>
    </div>
  );
}

function BalanceSheet() {
  const { data, loading } = useApi<any>("/reports/balance");
  const money = useMoney();
  if (loading || !data) return <Spinner />;
  const A = data.assets, L = data.liabilities;
  const Row = (l: string, v: number, bold?: boolean) => (
    <div className={`flex justify-between py-2 ${bold ? "border-t border-line font-semibold text-white" : "text-slate-300"}`}><span>{l}</span><span className="font-mono">{money(v)}</span></div>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <h3 className="font-semibold text-white mb-2">Активы</h3>
        {Row("Денежные средства", A.cash)}
        {Row("Сырьё и материалы", A.materials)}
        {Row("Готовая продукция", A.products)}
        {Row("Дебиторская задолженность", A.receivable)}
        {Row("ИТОГО активы", A.total, true)}
      </Card>
      <Card>
        <h3 className="font-semibold text-white mb-2">Пассивы</h3>
        {Row("Кредиторская задолженность", L.payable)}
        {Row("Задолженность по налогам", L.taxes)}
        {Row("Займы полученные", L.loans || 0)}
        {Row("ИТОГО обязательства", L.total, true)}
        <div className="mt-3">{Row("Капитал (чистые активы)", data.equity, true)}</div>
      </Card>
    </div>
  );
}

function Counterparties() {
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const { data, loading } = useApi<any>(`/reports/counterparties${cat ? `?category=${cat}` : ""}`, [cat]);
  const money = useMoney();
  if (loading || !data) return <Spinner />;
  const rows = data.rows.filter((r: any) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.inn || "").includes(q));
  const t = rows.reduce(
    (a: any, r: any) => ({
      debit_open: a.debit_open + r.open_debit, credit_open: a.credit_open + r.open_credit,
      debit_turn: a.debit_turn + r.turn_debit, credit_turn: a.credit_turn + r.turn_credit,
      debit_end: a.debit_end + r.end_debit, credit_end: a.credit_end + r.end_credit,
    }),
    { debit_open: 0, credit_open: 0, debit_turn: 0, credit_turn: 0, debit_end: 0, credit_end: 0 }
  );
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line">
        <h3 className="font-semibold text-white mb-3">Дебиторская и кредиторская задолженность</h3>
        <div className="flex flex-wrap items-center gap-2">
          {[["", "Все"], ...ORG_CATS.map((c) => [c.v, c.l])].map(([v, l]) => (
            <button key={v} onClick={() => setCat(v)} className={`chip ${cat === v ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-white/5 text-slate-400 border border-line"}`}>{l}</button>
          ))}
          <input className="input max-w-xs ml-auto" placeholder="Поиск по названию или ИНН…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {!rows.length ? <EmptyState text="Нет оборотов" /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
          <thead><tr className="bg-white/[0.02]">
            <th className="th">Контрагент</th>
            <th className="th text-right">Нач. Дт</th><th className="th text-right">Нач. Кт</th>
            <th className="th text-right">Об. Дт</th><th className="th text-right">Об. Кт</th>
            <th className="th text-right">Кон. Дт</th><th className="th text-right">Кон. Кт</th>
          </tr></thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id} className="hover:bg-white/[0.02]">
                <td className="td text-white max-w-[220px] truncate">{r.name}</td>
                <td className="td text-right">{r.open_debit ? money(r.open_debit) : "—"}</td>
                <td className="td text-right">{r.open_credit ? money(r.open_credit) : "—"}</td>
                <td className="td text-right text-emerald-300">{r.turn_debit ? money(r.turn_debit) : "—"}</td>
                <td className="td text-right text-rose-300">{r.turn_credit ? money(r.turn_credit) : "—"}</td>
                <td className="td text-right font-semibold text-white">{r.end_debit ? money(r.end_debit) : "—"}</td>
                <td className="td text-right font-semibold text-white">{r.end_credit ? money(r.end_credit) : "—"}</td>
              </tr>
            ))}
            <tr className="bg-white/[0.03] font-semibold">
              <td className="td text-white">ВСЕГО</td>
              <td className="td text-right">{money(t.debit_open)}</td><td className="td text-right">{money(t.credit_open)}</td>
              <td className="td text-right">{money(t.debit_turn)}</td><td className="td text-right">{money(t.credit_turn)}</td>
              <td className="td text-right">{money(t.debit_end)}</td><td className="td text-right">{money(t.credit_end)}</td>
            </tr>
          </tbody>
        </table></div>
      )}
    </Card>
  );
}

function DailyBalance() {
  const { data, loading } = useApi<any>("/reports/daily-balance");
  const money = useMoney();
  if (loading || !data) return <Spinner />;
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line flex justify-between"><h3 className="font-semibold text-white">Остаток денежных средств по дням</h3><span className="text-sm text-slate-400">Конечный: <b className="text-white">{money(data.final)}</b></span></div>
      {!data.rows.length ? <EmptyState text="Нет операций" /> : (
        <table className="w-full">
          <thead><tr className="bg-white/[0.02]"><th className="th">Дата</th><th className="th text-right">Начало</th><th className="th text-right">Приход</th><th className="th text-right">Расход</th><th className="th text-right">Конец</th></tr></thead>
          <tbody>{data.rows.map((r: any, i: number) => (
            <tr key={i} className="hover:bg-white/[0.02]">
              <td className="td">{new Date(r.date).toLocaleDateString("ru-RU")}</td>
              <td className="td text-right text-slate-400">{money(r.opening)}</td>
              <td className="td text-right text-emerald-300">{r.income ? money(r.income) : "—"}</td>
              <td className="td text-right text-rose-300">{r.expense ? money(r.expense) : "—"}</td>
              <td className="td text-right font-semibold text-white">{money(r.closing)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

function GpTurnover() {
  const { data, loading } = useApi<any>("/reports/gp-turnover");
  const money = useMoney();
  if (loading || !data) return <Spinner />;
  const n = (v: number) => Number(v || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line"><h3 className="font-semibold text-white">ГП оборот: остаток на начало + произведено − реализовано = остаток на конец</h3></div>
      {!data.rows.length ? <EmptyState text="Нет движения ГП" /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="bg-white/[0.02]">
              <th className="th" rowSpan={2}>Продукция</th>
              <th className="th text-center" colSpan={2}>Остаток нач.</th>
              <th className="th text-center" colSpan={2}>Произведено</th>
              <th className="th text-center" colSpan={2}>Реализовано</th>
              <th className="th text-center" colSpan={2}>Остаток кон.</th>
            </tr>
            <tr className="bg-white/[0.02]">
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: any, i: number) => (
              <tr key={i} className="hover:bg-white/[0.02]">
                <td className="td text-white">{r.name}</td>
                <td className="td text-right">{n(r.open_qty)}</td><td className="td text-right text-slate-400">{money(r.open_val)}</td>
                <td className="td text-right text-emerald-300">{n(r.prod_qty)}</td><td className="td text-right text-slate-400">{money(r.prod_val)}</td>
                <td className="td text-right text-rose-300">{n(r.sold_qty)}</td><td className="td text-right text-slate-400">{money(r.sold_val)}</td>
                <td className="td text-right font-semibold text-white">{n(r.close_qty)}</td><td className="td text-right font-semibold text-white">{money(r.close_val)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}

const qn = (v: number) => Number(v || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });

function CostReport() {
  const money = useMoney();
  const [div, setDiv] = useState("");
  const { data, loading } = useApi<any>(`/reports/cost${div ? `?division=${encodeURIComponent(div)}` : ""}`, [div]);
  return (
    <>
      <DivSelect div={div} setDiv={setDiv} />
      {loading || !data ? <Spinner /> : (
        <Card className="!p-0 overflow-hidden">
          <div className="p-4 border-b border-line"><h3 className="font-semibold text-white">Себестоимость готовой продукции (С-сть)</h3></div>
          {!data.rows.length ? <EmptyState text="Нет данных" /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
              <thead><tr className="bg-white/[0.02]"><th className="th">Продукция</th><th className="th text-right">Выпуск</th><th className="th text-right">Себест./ед</th><th className="th text-right">Итого себест.</th><th className="th text-right">Продано</th><th className="th text-right">Ср. цена</th><th className="th text-right">Выручка</th><th className="th text-right">Прибыль</th><th className="th text-right">Марж.</th></tr></thead>
              <tbody>{data.rows.map((r: any, i: number) => (
                <tr key={i} className="hover:bg-white/[0.02]">
                  <td className="td text-white">{r.code && <span className="text-slate-500 font-mono mr-1.5">{r.code}</span>}{r.name}</td>
                  <td className="td text-right">{qn(r.produced)} {r.unit}</td>
                  <td className="td text-right">{money(r.unit_cost)}</td>
                  <td className="td text-right text-slate-300">{money(r.total_cost)}</td>
                  <td className="td text-right">{qn(r.sold)}</td>
                  <td className="td text-right">{money(r.avg_price)}</td>
                  <td className="td text-right text-emerald-300">{money(r.revenue)}</td>
                  <td className="td text-right font-semibold text-white">{money(r.profit)}</td>
                  <td className={`td text-right ${r.margin >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{r.margin}%</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}
    </>
  );
}

function MatTurnover({ kind, title }: { kind: string; title: string }) {
  const money = useMoney();
  const { data, loading } = useApi<any>(`/reports/materials-turnover?kind=${kind}`);
  if (loading || !data) return <Spinner />;
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line"><h3 className="font-semibold text-white">{title}: остаток нач. + приход − расход = остаток кон.</h3></div>
      {!data.rows.length ? <EmptyState text="Нет движения" /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="bg-white/[0.02]">
              <th className="th" rowSpan={2}>Наименование</th>
              <th className="th text-center" colSpan={2}>Остаток нач.</th>
              <th className="th text-center" colSpan={2}>Приход</th>
              <th className="th text-center" colSpan={2}>Расход</th>
              <th className="th text-center" colSpan={2}>Остаток кон.</th>
            </tr>
            <tr className="bg-white/[0.02]">
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
            </tr>
          </thead>
          <tbody>{data.rows.map((r: any, i: number) => (
            <tr key={i} className="hover:bg-white/[0.02]">
              <td className="td text-white">{r.code && <span className="text-slate-500 font-mono mr-1.5">{r.code}</span>}{r.name}</td>
              <td className="td text-right">{qn(r.open_qty)}</td><td className="td text-right text-slate-400">{money(r.open_val)}</td>
              <td className="td text-right text-emerald-300">{qn(r.recv_qty)}</td><td className="td text-right text-slate-400">{money(r.recv_val)}</td>
              <td className="td text-right text-rose-300">{qn(r.iss_qty)}</td><td className="td text-right text-slate-400">{money(r.iss_val)}</td>
              <td className="td text-right font-semibold text-white">{qn(r.close_qty)}</td><td className="td text-right font-semibold text-white">{money(r.close_val)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

function FxDiff() {
  const money = useMoney();
  const { data, loading } = useApi<any>("/reports/fx-difference");
  if (loading || !data) return <Spinner />;
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line flex justify-between"><h3 className="font-semibold text-white">Курсовая разница (переоценка по курсу {fmtMoney(data.rate)})</h3></div>
      {!data.rows.length ? <EmptyState text="Нет данных" /> : (
        <table className="w-full">
          <thead><tr className="bg-white/[0.02]"><th className="th">Наименование</th><th className="th text-right">Доходы (прибыль)</th><th className="th text-right">Убытки</th></tr></thead>
          <tbody>
            {data.rows.map((r: any, i: number) => (
              <tr key={i} className="hover:bg-white/[0.02]">
                <td className="td text-white">{r.name}</td>
                <td className="td text-right text-emerald-300">{r.income ? money(r.income) : "—"}</td>
                <td className="td text-right text-rose-300">{r.loss ? money(r.loss) : "—"}</td>
              </tr>
            ))}
            <tr className="bg-white/[0.03] font-semibold">
              <td className="td text-white">ИТОГО</td>
              <td className="td text-right text-emerald-300">{money(data.total_income)}</td>
              <td className="td text-right text-rose-300">{money(data.total_loss)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Warehouse({ url, title }: { url: string; title: string }) {
  const { data, loading } = useApi<any>(url);
  const money = useMoney();
  if (loading || !data) return <Spinner />;
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line flex justify-between"><h3 className="font-semibold text-white">{title}</h3><span className="text-sm text-slate-400">Итого: <b className="text-white">{money(data.total_value)}</b></span></div>
      {!data.rows.length ? <EmptyState text="Пусто" /> : (
        <table className="w-full">
          <thead><tr className="bg-white/[0.02]"><th className="th">Код</th><th className="th">Наименование</th><th className="th text-right">Остаток</th><th className="th text-right">Ср. цена</th><th className="th text-right">Стоимость</th></tr></thead>
          <tbody>{data.rows.map((r: any, i: number) => (
            <tr key={i} className="hover:bg-white/[0.02]"><td className="td font-mono text-slate-400">{r.code}</td><td className="td text-white">{r.name}</td><td className="td text-right">{Number(r.stock_qty).toLocaleString("ru-RU")} {r.unit}</td><td className="td text-right">{money(r.avg_cost)}</td><td className="td text-right font-semibold text-white">{money(r.value)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

function CashFlow() {
  const { data, loading } = useApi<CF>("/reports/cashflow");
  const money = useMoney();
  if (loading || !data) return <Spinner />;
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <Stat label="Приход всего" value={money(data.total.in)} tone="text-emerald-300" />
        <Stat label="Расход всего" value={money(data.total.out)} tone="text-rose-300" />
        <Stat label="Чистый поток" value={money(data.total.end)} tone={data.total.end >= 0 ? "text-emerald-300" : "text-rose-300"} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <Card><h3 className="font-semibold text-white mb-2">Банк</h3><Line l="Приход" v={money(data.bank.in)} /><Line l="Расход" v={money(data.bank.out)} /><Line l="Остаток" v={money(data.bank.end)} bold /></Card>
        <Card><h3 className="font-semibold text-white mb-2">Касса</h3><Line l="Приход" v={money(data.kassa.in)} /><Line l="Расход" v={money(data.kassa.out)} /><Line l="Остаток" v={money(data.kassa.end)} bold /></Card>
      </div>
      <Card className="!p-0 overflow-hidden">
        <div className="p-4 border-b border-line"><h3 className="font-semibold text-white">Движение по кодам (ДДС)</h3></div>
        {!data.by_code.length ? <EmptyState text="Нет операций" /> : (
          <table className="w-full">
            <thead><tr className="bg-white/[0.02]"><th className="th w-24">Код</th><th className="th">Наименование</th><th className="th text-right">Приход</th><th className="th text-right">Расход</th></tr></thead>
            <tbody>
              {data.by_code.map((r, i) => (
                <tr key={i} className="hover:bg-white/[0.02]">
                  <td className="td font-mono text-slate-400">{r.code}</td>
                  <td className="td">{r.name}</td>
                  <td className="td text-right text-emerald-300">{r.in ? money(r.in) : "—"}</td>
                  <td className="td text-right text-rose-300">{r.out ? money(r.out) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function Expenses() {
  const money = useMoney();
  const [div, setDiv] = useState("");
  const { data, loading } = useApi<Exp>(`/reports/expenses${div ? `?division=${encodeURIComponent(div)}` : ""}`, [div]);
  if (loading || !data) return (<><DivSelect div={div} setDiv={setDiv} /><Spinner /></>);
  const g = data.groups;
  return (
    <>
      <DivSelect div={div} setDiv={setDiv} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <Stat label="Производственные" value={money(g.prod)} tone="text-amber-300" />
        <Stat label="Сбытовые (941x)" value={money(g.sell)} tone="text-violet2" />
        <Stat label="Административные (942x)" value={money(g.admin)} tone="text-accent-soft" />
        <Stat label="Прочие (943x)" value={money(g.other)} tone="text-slate-300" />
      </div>
      <Card className="!p-0 overflow-hidden">
        <div className="p-4 border-b border-line flex justify-between"><h3 className="font-semibold text-white">Расходы по статьям</h3><span className="text-sm text-slate-400">Итого: <b className="text-white">{money(g.total)}</b></span></div>
        {!data.items.length ? <EmptyState text="Нет расходов" /> : (
          <table className="w-full">
            <thead><tr className="bg-white/[0.02]"><th className="th w-24">Код</th><th className="th">Статья</th><th className="th text-right">Сумма</th></tr></thead>
            <tbody>
              {data.items.map((r, i) => (
                <tr key={i} className="hover:bg-white/[0.02]"><td className="td font-mono text-slate-400">{r.code}</td><td className="td">{r.name}</td><td className="td text-right font-semibold text-white">{money(r.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <Card className="!p-4"><div className="text-xs text-slate-500">{label}</div><div className={`text-xl font-bold mt-1 ${tone}`}>{value}</div></Card>;
}
function Line({ l, v, bold }: { l: string; v: string; bold?: boolean }) {
  return <div className={`flex justify-between py-1 text-sm ${bold ? "border-t border-line mt-1 pt-2 font-semibold text-white" : "text-slate-400"}`}><span>{l}</span><span className="font-mono">{v}</span></div>;
}
