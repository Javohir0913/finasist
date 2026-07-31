import { createContext, Fragment, useContext, useState } from "react";
import { Card, EmptyState, SectionTitle, Spinner } from "../components/ui";
import { ORG_CATS } from "../lib/cats";
import { fmtDate, fmtMoney, fmtMoney2, makeMoney, withUnit } from "../lib/format";
import { ExportButton, PeriodPicker, usePeriod, withPeriod } from "../lib/period";
import { sum } from "../lib/table";
import { useApi } from "../lib/useApi";

// currency context: все отчёты считаются в сумах, конвертация в USD по курсу
const CurCtx = createContext<{ money: (v: number) => string; cur: string }>({ money: (v) => String(v), cur: "uzs" });
const useMoney = () => useContext(CurCtx).money;

/** Отчёт за выбранный в шапке период. */
function useReport<T>(path: string, extra = "") {
  const { qs } = usePeriod();
  const url = withPeriod(path, qs, extra);
  return useApi<T>(url, [url]);
}

const TABS = [
  { k: "pnl", label: "ОФР (P&L)", exp: "pnl" },
  { k: "pnldiv", label: "ОФР по подразделениям", exp: "pnl" },
  { k: "balance", label: "Баланс Ф№1", exp: "balance" },
  { k: "cashflow", label: "Cash Flow (ДДС)", exp: "cashflow" },
  { k: "daily", label: "Остатки по дням", exp: "daily" },
  { k: "counterparties", label: "Дт-Кт", exp: "ledger" },
  { k: "loans", label: "Займы", exp: "loans" },
  { k: "fx", label: "Курсовая разница", exp: "fx" },
  { k: "taxes", label: "Налоги", exp: "taxes" },
  { k: "expenses", label: "Расходы", exp: "expenses" },
  { k: "cost", label: "Себестоимость (С-сть)", exp: "cost" },
  { k: "matturn", label: "Оборот сырья", exp: "materials" },
  { k: "spturn", label: "Оборот запчастей", exp: "materials" },
  { k: "materials", label: "Остаток сырья", exp: "materials" },
  { k: "spare", label: "Остаток запчастей", exp: "materials" },
  { k: "gpturn", label: "ГП оборот", exp: "gp" },
  { k: "products", label: "Остаток ГП", exp: "gp" },
];

export default function Reports() {
  const [tab, setTab] = useState("pnl");
  const [cur, setCur] = useState("uzs");
  const { qs, label } = usePeriod();
  const { data: rates } = useApi<{ rate_date: string; rate: number }[]>("/exchange");
  const rate = rates && rates.length ? Number(rates[0].rate) || 1 : 1; // список по убыванию даты -> [0] последний курс
  const money = makeMoney(cur as "uzs" | "usd", rate);
  const current = TABS.find((t) => t.k === tab);

  return (
    <CurCtx.Provider value={{ money, cur }}>
      <SectionTitle
        title="Финансовые отчёты"
        sub={`ОФР (Форма №2), Баланс (Форма №1), Cash Flow, Дт-Кт, склад — ${label}`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodPicker />
            <div className="flex gap-1 rounded-xl bg-white/5 border border-line p-1">
              {[["uzs", "сум"], ["usd", "$"]].map(([v, l]) => (
                <button key={v} onClick={() => setCur(v)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${cur === v ? "bg-accent text-white" : "text-slate-400 hover:text-white"}`}>{l}</button>
              ))}
            </div>
            <ExportButton url={withPeriod(`/export/reports?only=${current?.exp || "pnl"}`, qs)} label="Этот отчёт" />
            <ExportButton url={withPeriod("/export/reports", qs)} label="Вся книга" title="Выгрузить все отчёты одной книгой Excel" />
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
      {tab === "pnldiv" && <PnLDivisions />}
      {tab === "balance" && <BalanceSheet />}
      {tab === "cashflow" && <CashFlow />}
      {tab === "daily" && <DailyBalance />}
      {tab === "counterparties" && <Counterparties />}
      {tab === "loans" && <LoansReport />}
      {tab === "fx" && <FxDiff />}
      {tab === "taxes" && <TaxesReport />}
      {tab === "expenses" && <Expenses />}
      {tab === "cost" && <CostReport />}
      {tab === "matturn" && <MatTurnover kind="raw" title="Оборот сырья на складе" />}
      {tab === "spturn" && <MatTurnover kind="spare" title="Оборот запчастей на складе" />}
      {tab === "materials" && <Warehouse url="/material-stocks?kind=raw" title="Остатки сырья по объектам" />}
      {tab === "spare" && <Warehouse url="/material-stocks?kind=spare" title="Остатки запчастей по объектам" />}
      {tab === "gpturn" && <GpTurnover />}
      {tab === "products" && <Warehouse url="/product-stocks" title="Остатки готовой продукции по объектам" />}
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
  const { data, loading } = useReport<any>("/reports/pnl", div ? `division=${encodeURIComponent(div)}` : "");
  if (loading || !data) return (<><DivSelect div={div} setDiv={setDiv} /><Spinner /></>);
  return (<><DivSelect div={div} setDiv={setDiv} /><PnLBody data={data} money={money} /></>);
}

/** Форма №2 целиком: от выручки до чистой прибыли, с кодами строк бланка. */
function PnLBody({ data, money }: { data: any; money: (v: number) => string }) {
  const R = (code: string, l: string, v: number, opts: { bold?: boolean; tone?: string; ind?: boolean } = {}) => (
    <div className={`flex items-baseline gap-3 py-2 ${opts.bold ? "border-t border-line font-semibold text-white" : "text-slate-300"} ${opts.ind ? "text-sm text-slate-400" : ""}`}>
      <span className="w-9 shrink-0 font-mono text-xs text-slate-600">{code}</span>
      <span className={`flex-1 ${opts.ind ? "pl-3" : ""}`}>{l}</span>
      <span className={`font-mono tabular-nums ${opts.tone || ""}`}>{money(v)}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <h3 className="font-semibold text-white mb-2">Отчёт о финансовых результатах — Форма №2</h3>
        {R("010", "Чистая выручка от реализации", data.revenue, { tone: "text-emerald-300" })}
        {R("020", "Себестоимость реализованной продукции", -data.cogs, { ind: true })}
        {R("030", "Валовая прибыль (010 − 020)", data.gross, { bold: true })}
        {R("040", "Расходы периода, всего", -data.period, {})}
        {R("050", "Расходы по реализации", -data.sell, { ind: true })}
        {R("060", "Административные расходы", -data.admin, { ind: true })}
        {R("070", "Прочие операционные расходы", -data.other, { ind: true })}
        {R("090", "Прочие доходы", data.other_income, { ind: true, tone: "text-emerald-300" })}
        {R("100", "Прибыль от основной деятельности (030 − 040 + 090)", data.op_profit, { bold: true })}
        {R("120", "Доходы по финансовой деятельности", data.fin_income, { ind: true })}
        {R("", "в т.ч. доходы от валютных курсовых разниц", data.fx_income, { ind: true })}
        {R("130", "Расходы по финансовой деятельности", -data.fin_loss, { ind: true })}
        {R("", "в т.ч. убытки от валютных курсовых разниц", -data.fx_loss, { ind: true })}
        {R("220", "Прибыль от общехозяйственной деятельности", data.gh_profit, { bold: true })}
        {R("230", "Чрезвычайные прибыли и убытки", data.extraordinary, { ind: true })}
        {R("240", "Прибыль до уплаты налога на прибыль", data.before_tax, { bold: true })}
        {R("250", "Налог на прибыль", -data.tax, { ind: true })}
        {R("260", "Прочие налоги и сборы от прибыли", -data.other_taxes, { ind: true })}
        {R("270", "ЧИСТАЯ ПРИБЫЛЬ (240 − 250 − 260)", data.net, { bold: true, tone: data.net >= 0 ? "text-emerald-300" : "text-rose-300" })}
      </Card>
      <div className="grid grid-cols-2 gap-4 content-start">
        <Stat label="Выручка" value={money(data.revenue)} tone="text-emerald-300" />
        <Stat label="Чистая прибыль" value={money(data.net)} tone={data.net >= 0 ? "text-emerald-300" : "text-rose-300"} />
        <Stat label="Валовая маржа" value={`${data.gross_margin}%`} tone="text-accent-soft" />
        <Stat label="Чистая маржа" value={`${data.net_margin}%`} tone="text-violet2" />
        <Stat label="Произв. расходы за период" value={money(data.prod_expenses)} tone="text-amber-300"
          hint="Не строка Формы №2. Оседают в с/с всего выпуска; в 020 попадает только доля проданного." />
        <Stat label="Курсовая разница (нетто)" value={money(data.fx_income - data.fx_loss)}
          tone={data.fx_income - data.fx_loss >= 0 ? "text-emerald-300" : "text-rose-300"} />
      </div>
    </div>
  );
}

/** Свод ОФР по подразделениям — строки Мачстон / Жби / Турк книги. */
function PnLDivisions() {
  const money = useMoney();
  const { data, loading } = useReport<any>("/reports/pnl-divisions");
  if (loading || !data) return <Spinner />;
  const COLS: [string, string][] = [
    ["revenue", "Выручка"], ["cogs", "Себестоимость"], ["gross", "Валовая прибыль"],
    ["sell", "Реализация"], ["admin", "Админ."], ["other", "Прочие"],
    ["period", "Расходы периода"], ["op_profit", "Прибыль от основной"],
  ];
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line"><h3 className="font-semibold text-white">ОФР по подразделениям</h3></div>
      {!data.rows.length ? <EmptyState text="Нет данных по подразделениям за период" /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm">
          <thead><tr className="bg-white/[0.02]">
            <th className="th">Подразделение</th>
            {COLS.map(([, l]) => <th key={l} className="th text-right">{l}</th>)}
          </tr></thead>
          <tbody>
            {data.rows.map((r: any) => (
              <tr key={r.division} className="hover:bg-white/[0.02]">
                <td className="td text-white">{r.division}</td>
                {COLS.map(([k]) => <td key={k} className="td text-right tabular-nums">{money(r[k])}</td>)}
              </tr>
            ))}
            <tr className="bg-white/[0.03] font-semibold text-white">
              <td className="td">ВСЕГО по предприятию</td>
              {COLS.map(([k]) => <td key={k} className="td text-right tabular-nums">{money(data.total[k])}</td>)}
            </tr>
          </tbody>
        </table></div>
      )}
      <p className="text-xs text-slate-500 p-4 border-t border-line">
        Курсовая разница и финансовая деятельность по подразделениям не распределяются —
        это общефирменные величины, они видны только в общем ОФР.
      </p>
    </Card>
  );
}

/** Баланс — Форма №1: строки с кодами бланка. */
function BalanceSheet() {
  const { data, loading } = useReport<any>("/reports/balance");
  const money = useMoney();
  if (loading || !data) return <Spinner />;
  const Side = ({ title, rows }: { title: string; rows: any[] }) => (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line"><h3 className="font-semibold text-white">{title}</h3></div>
      <table className="w-full text-sm">
        <thead><tr className="bg-white/[0.02]">
          <th className="th w-14">№ стр</th><th className="th">Наименование</th>
          <th className="th text-right">На начало</th><th className="th text-right">На конец</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.amount === null ? "bg-white/[0.05]" : r.level === 0 ? "bg-white/[0.03]" : "hover:bg-white/[0.02]"}>
              <td className="td font-mono text-slate-500">{r.code}</td>
              <td className={`td ${r.level === 0 ? "font-semibold text-white" : r.level === 1 ? "text-slate-300 pl-6" : "text-slate-400 pl-10"}`}>{r.name}</td>
              <td className="td text-right tabular-nums text-slate-400">{r.opening === null ? "" : money(r.opening)}</td>
              <td className={`td text-right tabular-nums ${r.level === 0 ? "font-semibold text-white" : "text-slate-300"}`}>{r.amount === null ? "" : money(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
  return (
    <>
      {data.check !== 0 && (
        <div className="mb-4 rounded-xl bg-amber-500/12 border border-amber-500/25 text-amber-300 text-sm px-3.5 py-2.5">
          Актив и пассив расходятся на {money(data.check)} — проверьте входящие сальдо.
        </div>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Side title="АКТИВ" rows={data.asset_rows} />
        <Side title="ПАССИВ" rows={data.liability_rows} />
      </div>
      <p className="text-xs text-slate-500 mt-3">
        Основные средства, нематериальные активы и собственный капитал (строки 010–090, 410–430)
        вводятся в разделе «Настройки» — отдельного модуля учёта ОС пока нет.
        Нераспределённая прибыль (450) — балансирующая величина.
      </p>
    </>
  );
}

function Counterparties() {
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const { data, loading } = useReport<any>("/reports/counterparties", cat ? `category=${cat}` : "");
  const money = useMoney();
  if (loading || !data) return <Spinner />;
  const rows = data.rows.filter((r: any) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.inn || "").includes(q));
  const t = data.totals;
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line">
        <h3 className="font-semibold text-white mb-3">Дебиторская и кредиторская задолженность (сводно)</h3>
        <div className="flex flex-wrap items-center gap-2">
          {[["", "Все"], ...ORG_CATS.map((c) => [c.v, c.l])].map(([v, l]) => (
            <button key={v} onClick={() => setCat(v)} className={`chip ${cat === v ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-white/5 text-slate-400 border border-line"}`}>{l}</button>
          ))}
          <input className="input max-w-xs ml-auto" placeholder="Поиск по названию или ИНН…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="text-xs text-slate-500 mt-2">Раздельные ведомости (СЕЙФ, услуги, З.п, РБП, Офис) — в разделе «Ведомости Дт-Кт».</p>
      </div>
      {!rows.length ? <EmptyState text="Нет оборотов и сальдо за период" /> : (
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
              <td className="td text-right">{money(t.open_debit)}</td><td className="td text-right">{money(t.open_credit)}</td>
              <td className="td text-right">{money(t.turn_debit)}</td><td className="td text-right">{money(t.turn_credit)}</td>
              <td className="td text-right">{money(t.end_debit)}</td><td className="td text-right">{money(t.end_credit)}</td>
            </tr>
          </tbody>
        </table></div>
      )}
    </Card>
  );
}

function LoansReport() {
  const { data, loading } = useReport<any>("/reports/loans");
  const money = useMoney();
  if (loading || !data) return <Spinner />;
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line"><h3 className="font-semibold text-white">Задолженность по выданным и полученным займам</h3></div>
      {!data.rows.length ? <EmptyState text="Займы не заведены" /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm">
          <thead><tr className="bg-white/[0.02]">
            <th className="th">Контрагент</th><th className="th">Тип</th>
            <th className="th text-right">Нач. Дт</th><th className="th text-right">Нач. Кт</th>
            <th className="th text-right">Об. Дт</th><th className="th text-right">Об. Кт</th>
            <th className="th text-right">Кон. Дт</th><th className="th text-right">Кон. Кт</th>
          </tr></thead>
          <tbody>
            {data.rows.map((r: any) => (
              <tr key={r.id} className="hover:bg-white/[0.02]">
                <td className="td text-white">{r.name}</td>
                <td className="td text-slate-400">{r.direction === "given" ? "Выданный" : "Полученный"}</td>
                <td className="td text-right">{money(r.open_debit)}</td><td className="td text-right">{money(r.open_credit)}</td>
                <td className="td text-right text-emerald-300">{money(r.turn_debit)}</td>
                <td className="td text-right text-rose-300">{money(r.turn_credit)}</td>
                <td className="td text-right font-semibold text-white">{money(r.end_debit)}</td>
                <td className="td text-right font-semibold text-white">{money(r.end_credit)}</td>
              </tr>
            ))}
            <tr className="bg-white/[0.03] font-semibold">
              <td className="td text-white" colSpan={2}>ВСЕГО</td>
              <td className="td text-right">{money(data.totals.open_debit)}</td><td className="td text-right">{money(data.totals.open_credit)}</td>
              <td className="td text-right">{money(data.totals.turn_debit)}</td><td className="td text-right">{money(data.totals.turn_credit)}</td>
              <td className="td text-right">{money(data.totals.end_debit)}</td><td className="td text-right">{money(data.totals.end_credit)}</td>
            </tr>
          </tbody>
        </table></div>
      )}
    </Card>
  );
}

function TaxesReport() {
  const { data, loading } = useReport<any>("/reports/taxes");
  const money = useMoney();
  if (loading || !data) return <Spinner />;
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line"><h3 className="font-semibold text-white">Состояние задолженности по видам налогов</h3></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
        <thead><tr className="bg-white/[0.02]">
          <th className="th">Наименование налога</th>
          <th className="th text-right">Долг на начало</th><th className="th text-right">Начислено</th>
          <th className="th text-right">Оплачено</th><th className="th text-right">Долг на конец</th>
          <th className="th text-right">Переплата</th>
        </tr></thead>
        <tbody>
          {data.rows.map((r: any) => (
            <tr key={r.id} className="hover:bg-white/[0.02]">
              <td className="td text-white">{r.name}{r.auto && <span className="chip ml-2 bg-accent/15 text-accent-soft border border-accent/25">авто</span>}</td>
              <td className="td text-right">{money(r.debt_start)}</td>
              <td className="td text-right text-amber-300">{money(r.accrued)}</td>
              <td className="td text-right text-emerald-300">{money(r.paid)}</td>
              <td className="td text-right font-semibold text-white">{money(r.debt_end)}</td>
              <td className="td text-right text-slate-400">{r.overpay ? money(r.overpay) : "—"}</td>
            </tr>
          ))}
          <tr className="bg-white/[0.03] font-semibold">
            <td className="td text-white">ИТОГО</td>
            <td className="td text-right">{money(data.totals.start)}</td>
            <td className="td text-right">{money(data.totals.accrued)}</td>
            <td className="td text-right">{money(data.totals.paid)}</td>
            <td className="td text-right">{money(data.totals.end)}</td>
            <td className="td"></td>
          </tr>
        </tbody>
      </table></div>
    </Card>
  );
}

/** ОСТАТОК UZS/USD — колонка на каждый счёт и кассу, как в Excel. */
function DailyBalance() {
  const [curr, setCurr] = useState("UZS");
  const [div, setDiv] = useState("");
  const extra = [`currency=${curr}`, div ? `division=${encodeURIComponent(div)}` : ""]
    .filter(Boolean).join("&");
  const { data, loading } = useReport<any>("/reports/daily-balance", extra);
  const m = (v: number) => fmtMoney(v);
  return (
    <>
    <DivSelect div={div} setDiv={setDiv} />
    {div && (
      <div className="mb-3 text-xs text-slate-500">
        По подразделению показаны только его кассы и операции с этим объектом —
        банковские счета общефирменные.
      </div>
    )}
    {loading || !data ? <Spinner /> : (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-white">Остаток денежных средств по дням и счетам</h3>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 rounded-xl bg-white/5 border border-line p-1">
            {["UZS", "USD"].map((c) => (
              <button key={c} onClick={() => setCurr(c)} className={`px-3 py-1 rounded-lg text-xs font-semibold ${curr === c ? "bg-accent text-white" : "text-slate-400 hover:text-white"}`}>{c}</button>
            ))}
          </div>
          <span className="text-sm text-slate-400">На конец: <b className="text-white">{m(data.final)}</b></span>
        </div>
      </div>
      <div className="overflow-x-auto max-h-[65vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-base-850 z-10">
            <tr>
              <th className="th">Дата</th>
              <th className="th text-right">Приход</th>
              <th className="th text-right">Расход</th>
              <th className="th text-right border-r border-line">Всего по предприятию</th>
              {data.columns.map((c: any) => <th key={c.key} className="th text-right whitespace-nowrap">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-white/[0.03]">
              <td className="td font-semibold text-white">Остаток на начало</td>
              <td className="td"></td><td className="td"></td>
              <td className="td text-right font-semibold text-white border-r border-line tabular-nums">{m(data.opening.total)}</td>
              {data.columns.map((c: any) => <td key={c.key} className="td text-right text-slate-400 tabular-nums">{m(data.opening.cols[c.key] || 0)}</td>)}
            </tr>
            {data.rows.map((r: any, i: number) => (
              <tr key={i} className="hover:bg-white/[0.02]">
                <td className="td">{new Date(r.date).toLocaleDateString("ru-RU")}</td>
                <td className="td text-right text-emerald-300 tabular-nums">{r.income ? m(r.income) : "—"}</td>
                <td className="td text-right text-rose-300 tabular-nums">{r.expense ? m(r.expense) : "—"}</td>
                <td className="td text-right font-semibold text-white border-r border-line tabular-nums">{m(r.closing)}</td>
                {data.columns.map((c: any) => <td key={c.key} className="td text-right text-slate-400 tabular-nums">{m(r.cols[c.key] || 0)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.rows.length && <EmptyState text="За период нет операций" />}
    </Card>
    )}
    </>
  );
}

function GpTurnover() {
  const [byDiv, setByDiv] = useState(true);
  const { data, loading } = useReport<any>("/reports/gp-turnover", byDiv ? "by_division=true" : "");
  const money = useMoney();
  const n = (v: number) => Number(v || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-white">ГП оборот: остаток на начало + произведено − реализовано = остаток на конец</h3>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={byDiv} onChange={(e) => setByDiv(e.target.checked)} className="h-4 w-4 accent-[#5b8cff]" />
          в разрезе объектов
        </label>
      </div>
      {loading || !data ? <Spinner /> : !data.rows.length ? <EmptyState text="Нет движения ГП" /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="bg-white/[0.02]">
              <th className="th" rowSpan={2}>Объект</th>
              <th className="th" rowSpan={2}>Продукция</th>
              <th className="th text-center" colSpan={2}>Остаток нач.</th>
              <th className="th text-center" colSpan={2}>Произведено</th>
              <th className="th text-center bg-amber-500/[0.06]" colSpan={3}>ВСЕГО (K · M · L)</th>
              <th className="th text-center" colSpan={2}>Реализовано (020)</th>
              <th className="th text-center" colSpan={2}>Остаток кон.</th>
            </tr>
            <tr className="bg-white/[0.02]">
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
              <th className="th text-right bg-amber-500/[0.06]">кол-во</th>
              <th className="th text-right bg-amber-500/[0.06]">сумма</th>
              <th className="th text-right bg-amber-500/[0.06]">средняя</th>
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: any, i: number) => (
              <tr key={i} className="hover:bg-white/[0.02]">
                <td className="td text-slate-400 whitespace-nowrap">{r.division}</td>
                <td className="td text-white">{r.name}</td>
                <td className="td text-right">{n(r.open_qty)}</td><td className="td text-right text-slate-400">{money(r.open_val)}</td>
                <td className="td text-right text-emerald-300">{n(r.prod_qty)}</td><td className="td text-right text-slate-400">{money(r.prod_val)}</td>
                <td className="td text-right bg-amber-500/[0.04]">{n(r.total_qty)}</td>
                <td className="td text-right text-slate-400 bg-amber-500/[0.04]">{money(r.total_val)}</td>
                <td className="td text-right text-amber-300 bg-amber-500/[0.04]">{money(r.avg_cost)}</td>
                <td className="td text-right text-rose-300">{n(r.sold_qty)}</td><td className="td text-right text-slate-400">{money(r.sold_val)}</td>
                <td className="td text-right font-semibold text-white">{n(r.close_qty)}</td><td className="td text-right font-semibold text-white">{money(r.close_val)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-white/[0.03] font-semibold text-white">
              <td className="td" colSpan={2}>ИТОГО</td>
              <td className="td text-right">{n(sum(data.rows, "open_qty"))}</td>
              <td className="td text-right">{money(sum(data.rows, "open_val"))}</td>
              <td className="td text-right">{n(sum(data.rows, "prod_qty"))}</td>
              <td className="td text-right">{money(sum(data.rows, "prod_val"))}</td>
              <td className="td text-right bg-amber-500/[0.06]">{n(sum(data.rows, "total_qty"))}</td>
              <td className="td text-right bg-amber-500/[0.06]">{money(sum(data.rows, "total_val"))}</td>
              <td className="td bg-amber-500/[0.06]" />
              <td className="td text-right">{n(sum(data.rows, "sold_qty"))}</td>
              <td className="td text-right text-amber-300">{money(sum(data.rows, "sold_val"))}</td>
              <td className="td text-right">{n(sum(data.rows, "close_qty"))}</td>
              <td className="td text-right">{money(sum(data.rows, "close_val"))}</td>
            </tr>
          </tfoot>
        </table></div>
      )}
    </Card>
  );
}

const qn = (v: number) => Number(v || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });

/** С-сть ГП: раскладка себестоимости по статьям, как на листе Excel. */
function CostReport() {
  const money = useMoney();
  const [div, setDiv] = useState("");
  const { data, loading } = useReport<any>("/reports/cost", div ? `division=${encodeURIComponent(div)}` : "");
  return (
    <>
      <DivSelect div={div} setDiv={setDiv} />
      {loading || !data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <Stat label="Сырьё в расходе" value={money(data.materials.raw)} tone="text-amber-300" />
            <Stat label="Запчасти" value={money(data.materials.spare)} tone="text-violet2" />
            <Stat label="Солярка / ГСМ" value={money(data.materials.fuel)} tone="text-accent-soft" />
            <Stat label="Выпуск, ед." value={qn(data.produced_qty)} tone="text-white" />
          </div>
          <Card className="!p-0 overflow-hidden">
            <div className="p-4 border-b border-line">
              <h3 className="font-semibold text-white">Себестоимость готовой продукции (С-сть)</h3>
              <p className="text-xs text-slate-500 mt-1">
                В себестоимость входят только производственные затраты: сырьё, запчасти,
                солярка и общие производственные расходы. Расходы по реализации,
                административные, прочие операционные и налог на прибыль в себестоимость
                <b className="text-slate-400"> не входят</b> — они разнесены отдельно
                и дают справочную «Итого стоимость».
              </p>
            </div>
            {!data.rows.length ? <EmptyState text="Нет данных" /> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[1420px] text-sm">
                <thead>
                  <tr className="bg-white/[0.02]">
                    <th className="th" rowSpan={2}>Марка</th>
                    <th className="th text-right" rowSpan={2}>Объём</th>
                    <th className="th text-center border-l border-line bg-emerald-500/[0.06]" colSpan={5}>
                      СЕБЕСТОИМОСТЬ — производственные затраты
                    </th>
                    <th className="th text-center border-l border-line" colSpan={5}>
                      Сверх себестоимости — расходы периода
                    </th>
                    <th className="th text-center border-l border-line" colSpan={4}>Реализация</th>
                  </tr>
                  <tr className="bg-white/[0.02]">
                    <th className="th text-right border-l border-line">Сырьё</th>
                    <th className="th text-right">Запчасти</th>
                    <th className="th text-right">Солярка</th>
                    <th className="th text-right">Общие произв.</th>
                    <th className="th text-right">С/с-ть 1 ед.</th>
                    <th className="th text-right border-l border-line">Реализация</th>
                    <th className="th text-right">Админ.</th>
                    <th className="th text-right">Прочие</th>
                    <th className="th text-right">Налог на приб.</th>
                    <th className="th text-right">Итого стоимость</th>
                    <th className="th text-right border-l border-line">Ср. продажа</th>
                    <th className="th text-right">Разница</th>
                    <th className="th text-right">Прибыль</th>
                    <th className="th text-right">Марж.</th>
                  </tr>
                </thead>
                <tbody>{data.rows.map((r: any, i: number) => (
                  <tr key={i} className="hover:bg-white/[0.02]">
                    <td className="td text-white whitespace-nowrap">{r.code && <span className="text-slate-500 font-mono mr-1.5">{r.code}</span>}{r.name}</td>
                    <td className="td text-right">{withUnit(r.produced, r.unit)}</td>
                    <td className="td text-right text-slate-400 border-l border-line bg-emerald-500/[0.04]">{money(r.raw_cost)}</td>
                    <td className="td text-right text-slate-400 bg-emerald-500/[0.04]">{money(r.spare_cost)}</td>
                    <td className="td text-right text-slate-400 bg-emerald-500/[0.04]">{money(r.fuel_cost)}</td>
                    <td className="td text-right text-slate-400 bg-emerald-500/[0.04]">{money(r.overhead)}</td>
                    <td className="td text-right font-semibold text-emerald-300 bg-emerald-500/[0.04]">{money(r.unit_cost)}</td>
                    <td className="td text-right text-slate-500 border-l border-line">{money(r.sell_unit)}</td>
                    <td className="td text-right text-slate-500">{money(r.admin_unit)}</td>
                    <td className="td text-right text-slate-500">{money(r.other_unit)}</td>
                    <td className="td text-right text-slate-500">{money(r.tax_unit)}</td>
                    <td className="td text-right text-slate-300">{money(r.full_unit_cost)}</td>
                    <td className="td text-right border-l border-line">{money(r.avg_price)}</td>
                    <td className={`td text-right ${r.diff >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(r.diff)}</td>
                    <td className="td text-right font-semibold text-white">{money(r.profit)}</td>
                    <td className={`td text-right ${r.margin >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{r.margin}%</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <p className="text-xs text-slate-500 p-4 border-t border-line">
              «Разница» = средняя продажа − <b className="text-slate-400">себестоимость</b> (как в книге: O = N − K),
              а не «Итого стоимость».
            </p>
          </Card>
        </>
      )}
    </>
  );
}

/** Оборот склада. По умолчанию свод, галочка — разбивка по дробилкам (как в книге). */
function MatTurnover({ kind, title }: { kind: string; title: string }) {
  const money = useMoney();
  const [byDiv, setByDiv] = useState(true);
  const { data, loading } = useReport<any>(
    "/reports/materials-turnover", `kind=${kind}${byDiv ? "&by_division=true" : ""}`
  );
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-white">{title}: остаток нач. + приход − расход = остаток кон.</h3>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={byDiv} onChange={(e) => setByDiv(e.target.checked)} className="h-4 w-4 accent-[#5b8cff]" />
          в разрезе дробилок
        </label>
      </div>
      {loading || !data ? <Spinner /> : !data.rows.length ? <EmptyState text="Нет движения" /> : (
        <div className="overflow-x-auto max-h-[65vh]"><table className="w-full min-w-[1000px] text-sm">
          <thead className="sticky top-0 bg-base-850 z-10">
            <tr>
              <th className="th" rowSpan={2}>Объект</th>
              <th className="th" rowSpan={2}>Наименование</th>
              <th className="th text-center" colSpan={2}>Остаток нач.</th>
              <th className="th text-center" colSpan={2}>Приход</th>
              <th className="th text-center" colSpan={2}>Расход</th>
              <th className="th text-center" colSpan={2}>Остаток кон.</th>
            </tr>
            <tr>
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
              <th className="th text-right">кол-во</th><th className="th text-right">сумма</th>
            </tr>
          </thead>
          <tbody>{data.rows.map((r: any, i: number) => (
            <tr key={i} className="hover:bg-white/[0.02]">
              <td className="td text-slate-400 whitespace-nowrap">{r.division}</td>
              <td className="td text-white">{r.code && <span className="text-slate-500 font-mono mr-1.5">{r.code}</span>}{r.name}</td>
              <td className="td text-right">{qn(r.open_qty)}</td><td className="td text-right text-slate-400">{money(r.open_val)}</td>
              <td className="td text-right text-emerald-300">{qn(r.recv_qty)}</td><td className="td text-right text-slate-400">{money(r.recv_val)}</td>
              <td className="td text-right text-rose-300">{qn(r.iss_qty)}</td><td className="td text-right text-slate-400">{money(r.iss_val)}</td>
              <td className="td text-right font-semibold text-white">{qn(r.close_qty)}</td><td className="td text-right font-semibold text-white">{money(r.close_val)}</td>
            </tr>
          ))}</tbody>
          {/* количества суммируем только внутри одного объекта-номенклатуры,
              поэтому в итоге показываем деньги — они сопоставимы всегда */}
          <tfoot className="sticky bottom-0 bg-base-850">
            <tr className="border-t-2 border-line font-semibold text-white">
              <td className="td" colSpan={2}>ИТОГО</td>
              <td className="td" />
              <td className="td text-right tabular-nums">{money(sum(data.rows, "open_val"))}</td>
              <td className="td" />
              <td className="td text-right tabular-nums text-emerald-300">{money(sum(data.rows, "recv_val"))}</td>
              <td className="td" />
              <td className="td text-right tabular-nums text-rose-300">{money(sum(data.rows, "iss_val"))}</td>
              <td className="td" />
              <td className="td text-right tabular-nums">{money(sum(data.rows, "close_val"))}</td>
            </tr>
          </tfoot>
        </table></div>
      )}
    </Card>
  );
}

/** Курсовая разница считается и показывается в долларах — как в книге. */
function FxDiff() {
  const { data, loading } = useReport<any>("/reports/fx-difference");
  if (loading || !data) return <Spinner />;
  const usd = (v: number) => "$" + fmtMoney2(Number(v || 0));
  return (
    <>
      {(data.warnings || []).map((w: string, i: number) => (
        <div key={i} className="mb-3 rounded-xl bg-amber-500/12 border border-amber-500/25 text-amber-300 text-sm px-3.5 py-2.5">
          ⚠ {w}
        </div>
      ))}
      <Card className="!p-0 overflow-hidden">
        <div className="p-4 border-b border-line">
          <h3 className="font-semibold text-white">Расчёт валютных курсовых разниц</h3>
          <p className="text-xs text-slate-500 mt-1">
            В долларах США, по курсу на конец периода {fmtMoney(data.rate)}.
            Задолженность переоценивается по каждому контрагенту отдельно,
            деньги — ежедневно, займы — по курсу на дату каждого движения.
          </p>
        </div>
        <table className="w-full">
          <thead><tr className="bg-white/[0.02]"><th className="th">Наименование</th><th className="th text-right">Доходы</th><th className="th text-right">Убытки</th></tr></thead>
          <tbody>
            {data.rows.map((r: any, i: number) => (
              <tr key={i} className="hover:bg-white/[0.02]">
                <td className="td text-white">{r.name}</td>
                <td className="td text-right text-emerald-300 tabular-nums">{r.income ? usd(r.income) : "—"}</td>
                <td className="td text-right text-rose-300 tabular-nums">{r.loss ? usd(r.loss) : "—"}</td>
              </tr>
            ))}
            <tr className="bg-white/[0.03] font-semibold">
              <td className="td text-white">ИТОГО</td>
              <td className="td text-right text-emerald-300 tabular-nums">{usd(data.total_income)}</td>
              <td className="td text-right text-rose-300 tabular-nums">{usd(data.total_loss)}</td>
            </tr>
            <tr className="font-semibold">
              <td className="td text-slate-400">Сальдо (доходы − убытки)</td>
              <td className={`td text-right tabular-nums ${data.net >= 0 ? "text-emerald-300" : "text-rose-300"}`} colSpan={2}>
                {usd(data.net)}
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
      <FxDocuments />
    </>
  );
}

/**
 * Расшифровка первой строки свода — до каждого документа.
 * Переоценка сальдо линейна, поэтому вклад документа = его сумма / курс на
 * конец − сумма в валюте по курсу дня; сумма вкладов равна разнице контрагента.
 */
function FxDocuments() {
  const { data, loading } = useReport<any>("/reports/fx-difference/documents");
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [onlyPeriod, setOnlyPeriod] = useState(false);
  if (loading || !data) return <div className="mt-4"><Spinner /></div>;
  const usd = (v: number) => "$" + fmtMoney2(Number(v || 0));
  const orgs = onlyPeriod
    ? data.orgs.filter((o: any) => o.docs.some((d: any) => d.in_period))
    : data.orgs;
  return (
    <Card className="!p-0 overflow-hidden mt-4">
      <div className="p-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">Расшифровка по документам</h3>
          <p className="text-xs text-slate-500 mt-1">
            Строка «Дебиторская и кредиторская задолженность» — по каждому контрагенту
            и документу. Деньги и займы сюда не входят: они переоцениваются не по
            документам, а ежедневно и по курсу на дату движения.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-400 whitespace-nowrap">
          <input type="checkbox" checked={onlyPeriod} onChange={(e) => setOnlyPeriod(e.target.checked)}
            className="h-4 w-4 accent-[#5b8cff]" />
          только с документами периода
        </label>
      </div>
      {!orgs.length ? <EmptyState text="Нет переоценённых контрагентов за период" /> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-sm">
          <thead><tr className="bg-white/[0.02]">
            <th className="th">Контрагент / документ</th>
            <th className="th">Дата</th>
            <th className="th text-right">Сумма, сум</th>
            <th className="th text-right">Курс док.</th>
            <th className="th text-right">Сумма, $</th>
            <th className="th text-right">Курсовая разница, $</th>
          </tr></thead>
          <tbody>
            {orgs.map((o: any) => (
              <Fragment key={o.id}>
                <tr className="bg-white/[0.03] cursor-pointer hover:bg-white/[0.05]"
                    onClick={() => setOpen((s) => ({ ...s, [o.id]: !s[o.id] }))}>
                  <td className="td font-semibold text-white">
                    <span className="text-slate-500 mr-2">{open[o.id] ? "▾" : "▸"}</span>
                    {o.name}
                    <span className="chip ml-2 bg-white/5 text-slate-500 border border-line text-[10px]">
                      {o.docs.length} док.
                    </span>
                  </td>
                  <td className="td" />
                  <td className="td text-right tabular-nums text-slate-300">{fmtMoney(o.closing_uzs)}</td>
                  <td className="td" />
                  <td className="td text-right tabular-nums text-slate-400">{fmtMoney2(o.closing_usd)}</td>
                  <td className={`td text-right font-semibold tabular-nums ${o.fx >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {usd(o.fx)}
                  </td>
                </tr>
                {open[o.id] && o.docs.map((r: any, i: number) => (
                  <tr key={i} className={r.in_period ? "hover:bg-white/[0.02]" : "text-slate-500 hover:bg-white/[0.02]"}>
                    <td className="td pl-10">
                      <span className="text-slate-400">{r.kind}</span>
                      <span className="text-slate-600 mx-1.5">·</span>
                      {r.label}
                    </td>
                    <td className="td whitespace-nowrap text-slate-400">
                      {r.date ? fmtDate(r.date) : "вход. сальдо"}
                    </td>
                    <td className="td text-right tabular-nums">{fmtMoney(r.uzs)}</td>
                    <td className="td text-right tabular-nums text-slate-500">
                      {r.rate_doc ? fmtMoney(r.rate_doc) : "—"}
                    </td>
                    <td className="td text-right tabular-nums text-slate-400">{fmtMoney2(r.usd)}</td>
                    <td className={`td text-right tabular-nums ${r.fx >= 0 ? "text-emerald-300/80" : "text-rose-300/80"}`}>
                      {r.fx ? usd(r.fx) : "—"}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="bg-white/[0.03] font-semibold">
              <td className="td text-white" colSpan={5}>ИТОГО по задолженности</td>
              <td className={`td text-right tabular-nums ${data.totals.net >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {usd(data.totals.net)}
              </td>
            </tr>
          </tbody>
        </table></div>
      )}
    </Card>
  );
}

/** Остатки в разрезе объектов — лист «Остаток сырья и запчастей» / «Остаток ГП». */
function Warehouse({ url, title }: { url: string; title: string }) {
  const { data, loading } = useApi<any>(url, [url]);
  const money = useMoney();
  if (loading || !data) return <Spinner />;
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-line flex justify-between">
        <h3 className="font-semibold text-white">{title}</h3>
        <span className="text-sm text-slate-400">Итого: <b className="text-white">{money(data.total_value)}</b></span>
      </div>
      {!data.rows.length ? <EmptyState text="Пусто" /> : (
        <div className="overflow-x-auto max-h-[65vh]"><table className="w-full">
          <thead className="sticky top-0 bg-base-850 z-10"><tr>
            <th className="th">Объект</th><th className="th">Код</th><th className="th">Наименование</th>
            <th className="th text-right">Остаток</th><th className="th text-right">Ср. цена</th>
            <th className="th text-right">Стоимость</th>
          </tr></thead>
          <tbody>{data.rows.map((r: any, i: number) => (
            <tr key={i} className="hover:bg-white/[0.02]">
              <td className="td text-slate-400 whitespace-nowrap">{r.division}</td>
              <td className="td font-mono text-slate-400">{r.code}</td>
              <td className="td text-white">{r.name}</td>
              <td className="td text-right tabular-nums">{withUnit(r.stock_qty, r.unit)}</td>
              <td className="td text-right tabular-nums">{money(r.avg_cost)}</td>
              <td className="td text-right font-semibold text-white tabular-nums">{money(r.value)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

/** CASH FLOW — разделы, колонки БАНК / КАССА / ВСЕГО, остатки и разрез по объектам. */
function CashFlow() {
  const [div, setDiv] = useState("");
  const { data, loading } = useReport<any>(
    "/reports/cashflow", div ? `division=${encodeURIComponent(div)}` : ""
  );
  const money = useMoney();
  return (
    <>
      <DivSelect div={div} setDiv={setDiv} />
      {div && (
        <div className="mb-4 rounded-xl bg-accent/10 border border-accent/25 text-accent-soft text-sm px-3.5 py-2.5">
          Денежная позиция подразделения «{div}»: обороты — только операции с этим объектом,
          входящий остаток — кассы этого объекта. Банковские счета к подразделениям
          не привязаны, поэтому в их остаток здесь не входят.
        </div>
      )}
      {loading || !data ? <Spinner /> : <CashFlowBody data={data} money={money} div={div} />}
      {!div && <CashFlowDivisions money={money} />}
    </>
  );
}

function CashFlowBody({ data, money, div }: { data: any; money: (v: number) => string; div: string }) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <Stat label="Остаток на начало" value={money(data.total.open)} tone="text-slate-300" />
        <Stat label="Приход всего" value={money(data.total.in)} tone="text-emerald-300" />
        <Stat label="Расход всего" value={money(data.total.out)} tone="text-rose-300" />
        <Stat label="Остаток на конец" value={money(data.total.end)} tone={data.total.end >= 0 ? "text-emerald-300" : "text-rose-300"} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        {(["bank", "kassa"] as const).map((k) => (
          <Card key={k}>
            <h3 className="font-semibold text-white mb-2">{k === "bank" ? "Банк" : "Касса"}</h3>
            <Line l="Остаток на начало" v={money(data[k].open)} />
            <Line l="Приход" v={money(data[k].in)} />
            <Line l="Расход" v={money(data[k].out)} />
            <Line l="Остаток на конец" v={money(data[k].end)} bold />
          </Card>
        ))}
      </div>
      <Card className="!p-0 overflow-hidden">
        <div className="p-4 border-b border-line">
          <h3 className="font-semibold text-white">Движение денежных средств по разделам</h3>
          <p className="text-xs text-slate-500 mt-1">
            Раздел (операционная / инвестиционная / финансовая) задаётся у кода ДДС
            в «Справочниках».
          </p>
        </div>
        {!data.by_code.length ? <EmptyState text="Нет операций за период" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="bg-white/[0.02]">
                <th className="th w-24" rowSpan={2}>Код</th><th className="th" rowSpan={2}>Наименование</th>
                <th className="th text-center border-l border-line" colSpan={2}>БАНК</th>
                <th className="th text-center border-l border-line" colSpan={2}>КАССА</th>
                <th className="th text-center border-l border-line" colSpan={2}>ВСЕГО</th>
              </tr>
              <tr className="bg-white/[0.02]">
                <th className="th text-right border-l border-line">приход</th><th className="th text-right">расход</th>
                <th className="th text-right border-l border-line">приход</th><th className="th text-right">расход</th>
                <th className="th text-right border-l border-line">приход</th><th className="th text-right">расход</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-white/[0.04] font-semibold text-white">
                <td className="td" colSpan={6}>ОСТАТОК ДЕНЕЖНЫХ СРЕДСТВ на начало периода</td>
                <td className="td text-right border-l border-line" colSpan={2}>{money(data.total.open)}</td>
              </tr>
              {data.sections.map((sec: any) => (
                <Fragment key={sec.key}>
                  <tr className="bg-white/[0.04]">
                    <td className="td font-semibold text-white" colSpan={2}>{sec.label}</td>
                    <td className="td" colSpan={4}></td>
                    <td className="td text-right font-semibold text-emerald-300 border-l border-line">{money(sec.in)}</td>
                    <td className="td text-right font-semibold text-rose-300">{money(sec.out)}</td>
                  </tr>
                  {!sec.rows.length && (
                    <tr><td className="td text-slate-600 text-xs" colSpan={8}>операций нет</td></tr>
                  )}
                  {sec.rows.map((r: any, i: number) => (
                    <tr key={i} className="hover:bg-white/[0.02]">
                      <td className="td font-mono text-slate-400 pl-6">{r.code}</td>
                      <td className="td">{r.name}</td>
                      <td className="td text-right text-emerald-300 border-l border-line">{r.bank_in ? money(r.bank_in) : "—"}</td>
                      <td className="td text-right text-rose-300">{r.bank_out ? money(r.bank_out) : "—"}</td>
                      <td className="td text-right text-emerald-300 border-l border-line">{r.kassa_in ? money(r.kassa_in) : "—"}</td>
                      <td className="td text-right text-rose-300">{r.kassa_out ? money(r.kassa_out) : "—"}</td>
                      <td className="td text-right font-semibold text-white border-l border-line">{r.in ? money(r.in) : "—"}</td>
                      <td className="td text-right font-semibold text-white">{r.out ? money(r.out) : "—"}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="bg-white/[0.03] font-semibold">
                <td className="td text-white" colSpan={2}>ИТОГО ОБОРОТЫ</td>
                <td className="td text-right border-l border-line">{money(data.bank.in)}</td><td className="td text-right">{money(data.bank.out)}</td>
                <td className="td text-right border-l border-line">{money(data.kassa.in)}</td><td className="td text-right">{money(data.kassa.out)}</td>
                <td className="td text-right border-l border-line">{money(data.total.in)}</td><td className="td text-right">{money(data.total.out)}</td>
              </tr>
              {Boolean(data.fx) && (
                <tr className="font-semibold">
                  <td className="td text-slate-300" colSpan={6}>КУРСОВАЯ РАЗНИЦА</td>
                  <td className={`td text-right border-l border-line ${data.fx >= 0 ? "text-emerald-300" : "text-rose-300"}`} colSpan={2}>{money(data.fx)}</td>
                </tr>
              )}
              <tr className="bg-white/[0.04] font-semibold text-white">
                <td className="td" colSpan={6}>ОСТАТОК ДЕНЕЖНЫХ СРЕДСТВ на конец периода</td>
                <td className="td text-right border-l border-line" colSpan={2}>{money(data.total.end)}</td>
              </tr>
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

/** Свод денежного потока по объектам — виден, когда фильтр не выбран. */
function CashFlowDivisions({ money }: { money: (v: number) => string }) {
  const { data, loading } = useReport<any>("/reports/cashflow-divisions");
  if (loading || !data) return null;
  if (!data.rows.length) return null;
  return (
    <Card className="!p-0 overflow-hidden mt-4">
      <div className="p-4 border-b border-line">
        <h3 className="font-semibold text-white">Денежный поток по подразделениям</h3>
        <p className="text-xs text-slate-500 mt-1">
          Разрез по объекту, указанному в операции. Выберите подразделение выше,
          чтобы раскрыть его коды ДДС.
        </p>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm">
        <thead><tr className="bg-white/[0.02]">
          <th className="th">Подразделение</th>
          <th className="th text-right">Приход</th>
          <th className="th text-right">Расход</th>
          <th className="th text-right">Чистый поток</th>
          <th className="th text-right border-l border-line">Операционная</th>
          <th className="th text-right">Инвестиционная</th>
          <th className="th text-right">Финансовая</th>
        </tr></thead>
        <tbody>
          {data.rows.map((r: any, i: number) => (
            <tr key={i} className="hover:bg-white/[0.02]">
              <td className="td text-white">{r.division}</td>
              <td className="td text-right text-emerald-300">{money(r.in)}</td>
              <td className="td text-right text-rose-300">{money(r.out)}</td>
              <td className={`td text-right font-semibold ${r.net >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{money(r.net)}</td>
              <td className="td text-right text-slate-400 border-l border-line">{money(r.sections?.operating || 0)}</td>
              <td className="td text-right text-slate-400">{money(r.sections?.investing || 0)}</td>
              <td className="td text-right text-slate-400">{money(r.sections?.financing || 0)}</td>
            </tr>
          ))}
          <tr className="bg-white/[0.03] font-semibold text-white">
            <td className="td">ВСЕГО по предприятию</td>
            <td className="td text-right">{money(data.total.in)}</td>
            <td className="td text-right">{money(data.total.out)}</td>
            <td className="td text-right">{money(data.total.in - data.total.out)}</td>
            <td className="td border-l border-line" colSpan={3}></td>
          </tr>
        </tbody>
      </table></div>
    </Card>
  );
}

/** ВСЕГО расходы — по кодам с разрезом БАНК / КАССА / начислено. */
function Expenses() {
  const money = useMoney();
  const [div, setDiv] = useState("");
  const [zero, setZero] = useState(false);
  const extra = [div ? `division=${encodeURIComponent(div)}` : "", zero ? "with_zero=true" : ""]
    .filter(Boolean).join("&");
  const { data, loading } = useReport<any>("/reports/expenses", extra);
  if (loading || !data) return (<><DivSelect div={div} setDiv={setDiv} /><Spinner /></>);
  const g = data.groups, t = data.totals;
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
        <div className="p-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-white">Расходы по статьям</h3>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} className="h-4 w-4 accent-[#5b8cff]" />
              показывать нулевые статьи
            </label>
            <span className="text-sm text-slate-400">Итого: <b className="text-white">{money(g.total)}</b></span>
          </div>
        </div>
        {!data.rows.length ? <EmptyState text="Нет расходов за период" /> : (
          <div className="overflow-x-auto max-h-[65vh]"><table className="w-full min-w-[980px] text-sm">
            <thead className="sticky top-0 bg-base-850 z-10">
              <tr>
                <th className="th w-24" rowSpan={2}>Код</th><th className="th" rowSpan={2}>Наименование</th>
                <th className="th text-right" rowSpan={2}>Кол-во</th>
                <th className="th text-center border-l border-line" colSpan={2}>БАНК</th>
                <th className="th text-center border-l border-line" colSpan={2}>КАССА</th>
                <th className="th text-right border-l border-line" rowSpan={2}
                  title="Списание сырья и запчастей со склада по этому коду">Со склада</th>
                <th className="th text-right" rowSpan={2}
                  title="Полученные услуги по этому коду">Услуги</th>
                <th className="th text-right border-l border-line" rowSpan={2}>Начислено</th>
                <th className="th text-center border-l border-line" colSpan={2}>ВСЕГО</th>
              </tr>
              <tr>
                <th className="th text-right border-l border-line">UZS</th><th className="th text-right">USD</th>
                <th className="th text-right border-l border-line">UZS</th><th className="th text-right">USD</th>
                <th className="th text-right border-l border-line">UZS</th><th className="th text-right">USD</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r: any, i: number) => (
                <tr key={i} className={r.skip ? "bg-white/[0.03] text-slate-500" : "hover:bg-white/[0.02]"}>
                  <td className="td font-mono text-slate-400">{r.code}</td>
                  <td className="td">
                    {r.name}
                    {r.skip && (
                      <span className="chip ml-2 bg-white/5 text-slate-500 border border-line text-[10px]"
                            title="Итоговая строка книги или покупка ТМЗ — в сумму отчёта и в ОФР не входит">
                        не суммируется
                      </span>
                    )}
                  </td>
                  <td className="td text-right text-slate-500">{r.qty || "—"}</td>
                  <td className="td text-right border-l border-line tabular-nums">{r.bank_uzs ? fmtMoney(r.bank_uzs) : "—"}</td>
                  <td className="td text-right text-slate-500 tabular-nums">{r.bank_usd ? fmtMoney(r.bank_usd) : "—"}</td>
                  <td className="td text-right border-l border-line tabular-nums">{r.kassa_uzs ? fmtMoney(r.kassa_uzs) : "—"}</td>
                  <td className="td text-right text-slate-500 tabular-nums">{r.kassa_usd ? fmtMoney(r.kassa_usd) : "—"}</td>
                  <td className="td text-right border-l border-line text-emerald-300 tabular-nums">{r.stock_uzs ? fmtMoney(r.stock_uzs) : "—"}</td>
                  <td className="td text-right text-violet2 tabular-nums">{r.service_uzs ? fmtMoney(r.service_uzs) : "—"}</td>
                  <td className="td text-right border-l border-line text-amber-300 tabular-nums">{r.accrued_uzs ? fmtMoney(r.accrued_uzs) : "—"}</td>
                  <td className="td text-right border-l border-line font-semibold text-white tabular-nums">{fmtMoney(r.total_uzs)}</td>
                  <td className="td text-right text-slate-500 tabular-nums">{fmtMoney(r.total_usd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-base-850">
              <tr className="font-semibold text-white">
                <td className="td" colSpan={3}>ИТОГО</td>
                <td className="td text-right border-l border-line tabular-nums">{fmtMoney(t.bank_uzs)}</td>
                <td className="td text-right tabular-nums">{fmtMoney(t.bank_usd)}</td>
                <td className="td text-right border-l border-line tabular-nums">{fmtMoney(t.kassa_uzs)}</td>
                <td className="td text-right tabular-nums">{fmtMoney(t.kassa_usd)}</td>
                <td className="td text-right border-l border-line tabular-nums">{fmtMoney(t.stock_uzs)}</td>
                <td className="td text-right tabular-nums">{fmtMoney(t.service_uzs)}</td>
                <td className="td text-right border-l border-line tabular-nums">{fmtMoney(t.accrued_uzs)}</td>
                <td className="td text-right border-l border-line tabular-nums">{fmtMoney(t.total_uzs)}</td>
                <td className="td text-right tabular-nums">{fmtMoney(t.total_usd)}</td>
              </tr>
            </tfoot>
          </table></div>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone: string; hint?: string }) {
  return (
    <Card className="!p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-bold mt-1 ${tone}`}>{value}</div>
      {hint && <div className="text-[11px] leading-snug text-slate-500 mt-1">{hint}</div>}
    </Card>
  );
}
function Line({ l, v, bold }: { l: string; v: string; bold?: boolean }) {
  return <div className={`flex justify-between py-1 text-sm ${bold ? "border-t border-line mt-1 pt-2 font-semibold text-white" : "text-slate-400"}`}><span>{l}</span><span className="font-mono">{v}</span></div>;
}
