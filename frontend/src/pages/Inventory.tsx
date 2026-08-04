import clsx from "clsx";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Modal, MoneyInput, SearchSelect, SectionTitle, Spinner } from "../components/ui";
import { fmtDate, fmtNum, withUnit } from "../lib/format";
import { LockedMark, LockedNotice, useLock } from "../lib/lock";
import { PeriodPicker, usePeriod, withPeriod } from "../lib/period";
import { FilterBar, qty, sum, text, TotalRow, useFilter, uzs } from "../lib/table";
import { useApi } from "../lib/useApi";
import { PrintPortal, printNow, Sheet, WaybillCfg, WaybillDoc, WaybillPage } from "../lib/waybill";
import { useAuth } from "../store/auth";

interface Ref { id: number; name: string; code?: string; unit?: string; kind?: string; inn?: string }
interface Div { id: number; name: string }
interface Code { id: number; code: string; name: string }

const TABS = [
  { k: "receipt", label: "Приход сырья" },
  { k: "receipt_sp", label: "Приход запчастей" },
  { k: "issue", label: "Расход сырья" },
  { k: "issue_sp", label: "Расход запчастей" },
  { k: "production", label: "Производство ГП" },
  { k: "sale", label: "Продажа ГП" },
];

const today = () => new Date().toISOString().slice(0, 10);

/** Виды оплаты + ставка НДС одним запросом. Ставка настраивается на сервере,
 *  и подпись в форме не должна расходиться с тем, как он считает. */
function useLookups() {
  const { data } = useApi<{ paymentTypes: string[]; ndsRate: number }>("/lookups");
  const nds = Number(data?.ndsRate ?? 0.12);
  return { paymentTypes: data?.paymentTypes || [], nds, pct: `${+(nds * 100).toFixed(2)}%` };
}

/**
 * Госномер к читаемому виду. То же правило, что на сервере (app/plates.py):
 * первые две цифры — код региона, дальше режем по сменам «цифры/буквы».
 *   01123ABC -> 01 123 ABC     01A123AA -> 01 A 123 AA
 * Перечислять форматы по одному нельзя: прицепы, мотоциклы и спецтехника
 * нумеруются иначе, а неизвестный номер ломать нельзя.
 */
export function formatPlate(v: string): string {
  const raw = String(v || "").replace(/\s+/g, "").toUpperCase();
  if (!raw) return "";
  let head = "";
  let rest = raw;
  if (raw.length > 2 && /^\d{2}/.test(raw)) { head = raw.slice(0, 2); rest = raw.slice(2); }
  const parts = head ? [head] : [];
  parts.push(...(rest.match(/\d+|[A-ZА-ЯЁ]+|[^\dA-ZА-ЯЁ]+/g) || []));
  return parts.filter(Boolean).join(" ").slice(0, 32);
}

/** Госномер: моноширинный, чтобы «01 A 123 BC» читался как номер. */
const Plate = ({ no }: { no?: string }) =>
  no ? <span className="font-mono text-slate-300 whitespace-nowrap">{formatPlate(no)}</span>
     : <span className="text-slate-600">—</span>;

// ═══════════════════ ПАКЕТНЫЙ ВВОД ═══════════════════
// Документы склада вводятся таблицей: одна поставка — сколько угодно строк,
// одно сохранение. Сервер пишет их одной транзакцией (эндпоинты /batch):
// либо проходят все строки, либо ни одной — половина накладной в базе хуже,
// чем отказ целиком.

/**
 * Строки формы.
 *
 * Новая строка наследует «шапочные» поля предыдущей (`carry`): дата,
 * контрагент, объект, вид оплаты, машина у одной поставки обычно совпадают,
 * а номенклатура и количество — своё у каждой строки. Так десять позиций
 * вводятся десятью полями, а не сотней.
 */
function useRows<T extends object>(blank: () => T, carry: (keyof T)[]) {
  const [rows, setRows] = useState<T[]>(() => [blank()]);
  return {
    rows,
    set: (i: number, patch: Partial<T>) =>
      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))),
    add: () =>
      setRows((rs) => {
        const next = blank();
        const prev = rs[rs.length - 1];
        if (prev) for (const k of carry) next[k] = prev[k];
        return [...rs, next];
      }),
    del: (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs)),
    /** Открыть форму: одна пустая строка (создание) или одна заполненная (правка). */
    reset: (one?: T) => setRows([one ?? blank()]),
  };
}

/** Полоска про закрытый месяц, если ХОТЬ ОДНА строка датирована в него. */
function LockedRows({ dates }: { dates: string[] }) {
  const { isLocked } = useLock();
  return <LockedNotice date={dates.find((d) => isLocked(d)) || null} />;
}

/** Хватает ли экрана, чтобы показать таблицу целиком. */
function useFits(px: number) {
  const [fits, setFits] = useState(() => window.innerWidth >= px);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const on = () => setFits(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [px]);
  return fits;
}

/**
 * Колонка формы ввода. Описание ОДНО на оба режима — таблицу и карточки:
 * иначе телефонная вёрстка неизбежно отстала бы от настольной.
 */
interface GridCol<T> {
  label: string;
  /** ширина ячейки в табличном режиме */
  w?: string;
  align?: "right" | "center";
  /** вычисляемое поле: не редактируется, на телефоне уходит в подвал карточки */
  calc?: boolean;
  /** на телефоне занимает всю ширину карточки */
  wide?: boolean;
  cell: (row: T, i: number) => ReactNode;
}

/**
 * Оболочка формы: строки + «ещё строка» + кнопки.
 *
 * Широкая таблица (12 колонок) на телефоне нечитаема: видно один столбец из
 * двенадцати и непонятно, что заполняешь. Поэтому, если экрана не хватает,
 * та же самая строка показывается КАРТОЧКОЙ с подписями над полями.
 */
function GridModal<T>({
  open, onClose, title, err, saving, editing, onAdd, onSave, onDel,
  minWidth, dates, cols, rows, complete, started, need, note, totals,
}: {
  open: boolean; onClose: () => void; title: string; err: string; saving: boolean;
  editing: boolean; onAdd: () => void; onSave: () => void;
  onDel: (i: number) => void; minWidth: number; dates: string[];
  cols: GridCol<T>[]; rows: T[];
  /** строку можно отправлять */
  complete: (row: T) => boolean;
  /** строку начали заполнять — только такую помечаем как ошибочную */
  started: (row: T) => boolean;
  /** чего не хватает в незаполненной строке, для подсказки у кнопки */
  need: string;
  note?: ReactNode; totals?: [string, string][];
}) {
  // +80px — поля модалки: на грани таблица уже упирается в края
  const table = useFits(minWidth + 80);
  const count = rows.length;
  const bad = (r: T) => started(r) && !complete(r);
  const gaps = rows.map((r, i) => (complete(r) ? 0 : i + 1)).filter(Boolean);

  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-[92rem]">
      {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
      <LockedRows dates={dates} />

      {table ? (
        /* -mx-1/px-1 — чтобы кольцо фокуса у крайних полей не срезалось */
        <div className="-mx-1 px-1 pb-1">
          <table className="grid-table" style={{ minWidth }}>
            <thead><tr>
              <th className="rownum" />
              {cols.map((c) => (
                <th key={c.label} className={c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""}>
                  {c.label}
                </th>
              ))}
              <th />
            </tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className={bad(r) ? "row-bad" : ""}>
                <td className="rownum">{i + 1}</td>
                {cols.map((c) => (
                  <td key={c.label} className={clsx(c.w, c.align === "center" && "text-center",
                    c.calc && "pt-2.5 text-right text-[13px] tabular-nums whitespace-nowrap")}>
                    {c.cell(r, i)}
                  </td>
                ))}
                <td className="w-6">{!editing && <DelBtn onClick={() => onDel(i)} disabled={count === 1} />}</td>
              </tr>
            ))}</tbody>
            {!editing && count > 1 && totals?.length ? (
              <GridTotal cols={cols.length + 2} items={totals} />
            ) : null}
          </table>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className={clsx("rounded-xl border p-3", bad(r) ? "border-rose-500/25 bg-rose-500/[0.04]" : "border-line bg-veil/[0.02]")}>
              {!editing && (
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-500">Строка {i + 1}</span>
                  <button onClick={() => onDel(i)} disabled={count === 1}
                    className="text-xs text-slate-500 hover:text-rose-300 disabled:opacity-30">✕ убрать</button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {cols.filter((c) => !c.calc).map((c) => (
                  <div key={c.label} className={c.wide ? "col-span-2" : ""}>
                    <label className="label">{c.label}</label>
                    {c.cell(r, i)}
                  </div>
                ))}
              </div>
              {cols.filter((c) => c.calc).map((c) => (
                <div key={c.label} className="flex items-baseline justify-between gap-3 mt-2.5 pt-2.5 border-t border-line text-xs text-slate-500">
                  <span>{c.label}</span>
                  <b className="text-slate-300 tabular-nums">{c.cell(r, i)}</b>
                </div>
              ))}
            </div>
          ))}
          {!editing && count > 1 && totals?.length ? (
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 pt-1">
              {totals.map(([label, value]) => (
                <span key={label}>{label} <b className="text-slate-300 tabular-nums">{value}</b></span>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {!editing && (
        <button className="btn-ghost mt-3 !py-1.5 !px-3 text-sm w-full sm:w-auto" onClick={onAdd}>
          + Ещё строка
        </button>
      )}
      {note}
      <div className="flex flex-wrap items-center gap-2 mt-6">
        {/* Кнопка заблокирована — говорим, ЧТО именно мешает: иначе непонятно,
            почему «Сохранить» серая. */}
        <span className="text-xs text-slate-500">
          {gaps.length ? (
            <>Заполните <b className="text-slate-300">{need}</b>
              {!editing && <> {gaps.length > 1 ? "в строках" : "в строке"} {gaps.join(", ")}</>}
            </>
          ) : !editing ? (
            <>Строк: <b className="text-slate-300">{count}</b></>
          ) : null}
        </span>
        <button className="btn-ghost ml-auto" onClick={onClose}>Отмена</button>
        <button className="btn-primary" onClick={onSave} disabled={saving || !!gaps.length}>
          {saving ? "Сохраняем…" : editing ? "Сохранить" : `Сохранить ${count}`}
        </button>
      </div>
    </Modal>
  );
}

// ---- ячейки таблицы ввода: те же поля, только плотнее ----
const CellDate = ({ value, min, onChange }: { value: string; min?: string; onChange: (v: string) => void }) => (
  <input type="date" min={min} className="input-cell" value={value} onChange={(e) => onChange(e.target.value)} />
);

/** Пока печатают — только регистр (иначе курсор прыгает через пробелы),
 *  а на выходе из поля номер раскладывается на группы. */
const CellPlate = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <input className="input-cell font-mono uppercase placeholder:normal-case placeholder:font-sans"
    placeholder="01 A 123 BC" maxLength={32} value={value}
    onChange={(e) => onChange(e.target.value.toUpperCase())}
    onBlur={(e) => onChange(formatPlate(e.target.value))} />
);

const CellPay = ({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) => (
  <select className="input-cell" value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">—</option>
    {options.map((t) => <option key={t} value={t}>{t}</option>)}
  </select>
);

const CellVat = ({ checked, title, onChange }: { checked: boolean; title: string; onChange: (v: boolean) => void }) => (
  <input type="checkbox" className="h-4 w-4 mt-1.5 accent-accent" title={title}
    checked={checked} onChange={(e) => onChange(e.target.checked)} />
);

const DelBtn = ({ onClick, disabled }: { onClick: () => void; disabled: boolean }) => (
  <button onClick={onClick} disabled={disabled} title="Убрать строку"
    className="pt-2 text-slate-600 hover:text-rose-300 disabled:opacity-25 disabled:hover:text-slate-600">✕</button>
);

// ---- варианты для выпадающих списков (одни и те же в четырёх формах) ----
const optItem = (xs?: Ref[] | null) => (xs || []).map((x) => ({
  value: String(x.id), label: x.code ? `${x.code} · ${x.name}` : x.name, search: `${x.code || ""} ${x.name}`,
}));
const optOrg = (xs?: Ref[] | null) => (xs || []).map((o) => ({
  value: String(o.id), label: o.inn ? `${o.name} · ${o.inn}` : o.name, search: `${o.name} ${o.inn || ""}`,
}));
const optDiv = (xs?: Div[] | null) => (xs || []).map((d) => ({ value: d.name, label: d.name }));
const optCode = (xs?: Code[] | null) => (xs || []).map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }));

const num = (v: any) => Number(v) || 0;

/**
 * Право «Суммы и цены» (amounts:view).
 *
 * Кладовщику нужен реестр прихода и расхода, но не нужны цены и
 * себестоимость. Колонки с деньгами прячутся целиком — сервер их всё равно
 * гасит нулями (см. app/money.py), так что «спрятать» тут не косметика.
 *
 * Приход и продажу без этого права ЗАВОДИТЬ нельзя: в них вводится цена, и
 * документ с невидимым полем ушёл бы с нулём, занизив среднюю по складу.
 */
const useMoney = () => useAuth().can("amounts:view");

/** Объясняем пустое место там, где обычно деньги — иначе выглядит как сбой. */
const MoneyHidden = ({ what }: { what?: string }) => (
  <div className="mb-4 rounded-xl bg-veil/[0.04] border border-line text-slate-400 text-sm px-4 py-2.5">
    Цены и суммы скрыты — нет права «Суммы и цены».
    {what && <> Заводить {what} тоже нельзя: в документе есть цена.</>}
  </div>
);

/**
 * Числовое поле формы держим как «число ИЛИ строка»: MoneyInput отдаёт
 * очищенную строку («1234.5»), и приводить её к числу на каждое нажатие
 * клавиши нельзя — «1234.» и «0.0» превратились бы в 1234 и 0 прямо под
 * курсором. Number() применяется один раз, при отправке.
 */
type NumField = number | string;

interface ReceiptRow {
  doc_date: string; material_id: string; organization_id: string; division: string;
  vehicle_no: string; qty: NumField; price_uzs: NumField; vat: boolean; payment_type: string;
}
interface IssueRow {
  doc_date: string; material_id: string; division: string; expense_code: string;
  vehicle_no: string; qty: NumField;
}
interface ProdRow { doc_date: string; product_id: string; division: string; qty: NumField }
interface SaleRow {
  doc_date: string; product_id: string; organization_id: string; division: string;
  vehicle_no: string; qty: NumField; price_uzs: NumField; vat: boolean; payment_type: string;
  /** дата прайса, из которого подставилась цена — показываем под полем */
  price_from?: string;
  /** цену поставил прайс и её ещё не трогали руками: такую можно заменить,
   *  введённую вручную — никогда */
  price_auto?: boolean;
}

/**
 * Прайс покупателя: цена, действующая на ДАТУ ДОКУМЕНТА.
 *
 * Ответы кэшируются по паре «покупатель + дата»: в таблице десяток строк
 * одной отгрузки, и дёргать сервер на каждую — лишнее.
 *
 * Прайс только ПОДСТАВЛЯЕТ цену. В самой продаже цена своя, поэтому новая
 * цена в прайсе не меняет ни эту строку после ввода, ни прошлые продажи.
 */
type PriceHit = { price_uzs: number; start_date: string; vat: boolean };
function usePriceList() {
  const cache = useRef<Record<string, Promise<Record<string, PriceHit>>>>({});
  return useCallback((orgId: string, on: string): Promise<Record<string, PriceHit>> => {
    if (!orgId || !on) return Promise.resolve({});
    const key = `${orgId}|${on}`;
    if (!cache.current[key]) {
      cache.current[key] = api
        .get(`/prices/effective?organization_id=${orgId}&on=${on}`)
        .then((r) => r.data as Record<string, PriceHit>)
        .catch(() => ({}));   // прайса нет или нет прав — просто не подставляем
    }
    return cache.current[key];
  }, []);
}
/** Строка готова к отправке: выбрана номенклатура и количество больше нуля. */
const filled = (idKey: string) => (r: any) => !!r[idKey] && num(r.qty) > 0;
/**
 * Строку уже начали заполнять.
 *
 * Нужно, чтобы НЕ красить красным нетронутую пустую строку: свежая форма —
 * не ошибка. Подсвечиваем только начатую и недоделанную, там правда чего-то
 * не хватает. Какие строки мешают сохранить, форма пишет отдельной подсказкой.
 */
const started = (idKey: string) => (r: any) => !!r[idKey] || num(r.qty) > 0;

/**
 * Накладная по одной строке продажи: предпросмотр + печать браузером.
 *
 * Печатаем не сразу по кнопке, а через предпросмотр: бланк настраиваемый, и
 * увидеть лист до того, как он уйдёт на принтер, дешевле, чем испортить его.
 */
function WaybillModal({ saleId, onClose }: { saleId: number | null; onClose: () => void }) {
  const [data, setData] = useState<{ config: WaybillCfg; doc: WaybillDoc } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!saleId) { setData(null); setErr(""); return; }
    let alive = true;
    api.get(`/print-forms/ttn/sale/${saleId}`)
      .then((r) => alive && setData(r.data))
      .catch((e) => alive && setErr(apiError(e)));
    return () => { alive = false; };
  }, [saleId]);

  return (
    <Modal open={!!saleId} onClose={onClose} title="Накладная" width="max-w-4xl">
      {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
      {!data && !err ? <Spinner /> : data && (
        <>
          <Sheet><WaybillPage cfg={data.config} doc={data.doc} /></Sheet>
          {/* тот же лист, но вне модалки — именно он уходит на принтер,
              поэтому вокруг него не печатается интерфейс */}
          <PrintPortal><WaybillPage cfg={data.config} doc={data.doc} /></PrintPortal>
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <span className="text-xs text-slate-500">
              Вид бланка настраивается в «Настройки → Печатные формы»
            </span>
            <button className="btn-ghost ml-auto" onClick={onClose}>Закрыть</button>
            <button className="btn-primary" onClick={printNow}>🖨 Печать</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Итог по всем строкам формы — видно, что уйдёт в реестр, до сохранения. */
function GridTotal({ cols, items }: { cols: number; items: [string, string][] }) {
  return (
    <tfoot>
      <tr>
        <td colSpan={cols} className="pt-3">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 border-t border-line pt-2.5">
            {items.map(([label, value]) => (
              <span key={label}>{label} <b className="text-slate-300 tabular-nums">{value}</b></span>
            ))}
          </div>
        </td>
      </tr>
    </tfoot>
  );
}

export default function Inventory() {
  const [tab, setTab] = useState("receipt");
  return (
    <div>
      <SectionTitle
        title="Склад и производство"
        sub="Приход и расход сырья/запчастей, выпуск и реализация ГП (себестоимость по средней)"
        right={<PeriodPicker />}
      />
      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`chip ${tab === t.k ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-veil/5 text-slate-400 border border-line"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "receipt" && <Receipts kind="raw" />}
      {tab === "receipt_sp" && <Receipts kind="spare" />}
      {tab === "issue" && <Issues kind="raw" />}
      {tab === "issue_sp" && <Issues kind="spare" />}
      {tab === "production" && <Productions />}
      {tab === "sale" && <Sales />}
    </div>
  );
}

function useRefs() {
  const { data: materials } = useApi<Ref[]>("/materials");
  const { data: products } = useApi<Ref[]>("/products");
  const { data: orgs } = useApi<Ref[]>("/organizations");
  const { data: divs } = useApi<Div[]>("/divisions");
  const { data: expCodes } = useApi<Code[]>("/expense-codes");
  return { materials, products, orgs, divs, expCodes };
}

function Toolbar({ can, onAdd, label }: { can: boolean; onAdd: () => void; label: string }) {
  return can ? <div className="mb-4"><button className="btn-primary" onClick={onAdd}>+ {label}</button></div> : null;
}

// ---------- Приход сырья / запчастей ----------
function Receipts({ kind }: { kind: string }) {
  const { can } = useAuth();
  const money = useMoney();
  const { isLocked, isPeriodLocked, minOpenDate, hint } = useLock();
  const { qs } = usePeriod();
  const { materials, orgs, divs } = useRefs();
  const mats = (materials || []).filter((m) => m.kind === kind);
  const url = withPeriod("/material-receipts", qs);
  const { data: all, loading, reload } = useApi<any[]>(url, [url]);
  const data = all?.filter((r) => r.material?.kind === kind);
  const [open, setOpen] = useState(false); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const blank = (): ReceiptRow => ({ doc_date: today(), material_id: "", organization_id: "", division: "", vehicle_no: "", qty: 0, price_uzs: 0, vat: false, payment_type: "" });
  const { rows, set, add, del, reset } = useRows(blank, ["doc_date", "organization_id", "division", "vehicle_no", "payment_type", "vat"]);
  const [editing, setEditing] = useState<any>(null);
  const { paymentTypes, nds, pct } = useLookups();
  // приход: цена БЕЗ НДС, налог начисляется сверху
  const bNet = rows.reduce((a, r) => a + num(r.qty) * num(r.price_uzs), 0);
  const bVat = rows.reduce((a, r) => a + (r.vat ? num(r.qty) * num(r.price_uzs) * nds : 0), 0);
  const f = useFilter<any>(
    data,
    (r) => text(r.doc_date, r.material?.code, r.material?.name, r.organization?.name,
                r.division, r.vehicle_no, r.payment_type, r.qty, r.amount_uzs),
    [
      { key: "mat", label: "Материал", of: (r) => r.material?.name || "" },
      { key: "org", label: "Поставщик", of: (r) => r.organization?.name || "" },
      { key: "div", label: "Дробилка", of: (r) => r.division || "" },
      { key: "car", label: "Авто", of: (r) => r.vehicle_no || "" },
      { key: "pay", label: "Оплата", of: (r) => r.payment_type || "" },
    ]
  );
  const body = (r: any) => ({
    doc_date: r.doc_date, material_id: Number(r.material_id),
    organization_id: r.organization_id ? Number(r.organization_id) : null,
    division: r.division, vehicle_no: r.vehicle_no, payment_type: r.payment_type,
    qty: Number(r.qty), price_uzs: Number(r.price_uzs), vat: r.vat,
  });
  const save = async () => {
    setErr(""); setSaving(true);
    try {
      if (editing) await api.put(`/material-receipts/${editing.id}`, body(rows[0]));
      else await api.post("/material-receipts/batch", { items: rows.map(body) });
      setOpen(false); reload();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const openEdit = (r: any) => { setEditing(r); reset({ doc_date: r.doc_date, material_id: String(r.material_id), organization_id: r.organization_id ? String(r.organization_id) : "", division: r.division || "", vehicle_no: r.vehicle_no || "", qty: r.qty, price_uzs: r.price_uzs, vat: r.vat, payment_type: r.payment_type || "" }); setErr(""); setOpen(true); };
  const remove = async (id: number) => { if (confirm("Удалить?")) { await api.delete(`/material-receipts/${id}`); reload(); } };
  return (
    <>
      <Toolbar can={can("materials:create") && money} onAdd={() => { setEditing(null); reset(); setErr(""); setOpen(true); }} label="Приход" />
      {!money && <MoneyHidden what="приход" />}
      {!loading && !!data?.length && <FilterBar f={f} placeholder="Материал, поставщик, дата…" />}
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Нет поступлений" /> :
         !f.rows.length ? <EmptyState text="Под фильтр ничего не подошло" /> : (
          <div className="overflow-x-auto"><table className="reg w-full min-w-[1000px]">
            <thead><tr className="bg-veil/[0.02]">
              <th className="th">Дата</th><th className="th">Материал</th><th className="th">Поставщик</th>
              <th className="th">Дробилка</th><th className="th">Авто номер</th>
              <th className="th">Вид оплаты</th><th className="th">НДС</th>
              <th className="th text-right">Кол-во</th>
              {money && <>
                <th className="th text-right">Цена без НДС</th>
                <th className="th text-right">Сумма без НДС</th><th className="th text-right">Сумма НДС</th>
                <th className="th text-right">Сумма с НДС</th>
              </>}
              <th className="th"></th>
            </tr></thead>
            <tbody>{f.rows.map((r) => (
              <tr key={r.id} className="hover:bg-veil/[0.02]">
                <td className="td whitespace-nowrap">{fmtDate(r.doc_date)}</td><td className="td text-ink">{r.material?.code && <span className="text-slate-500 font-mono mr-1.5">{r.material.code}</span>}{r.material?.name}</td>
                <td className="td max-w-[150px] truncate" title={r.organization?.name || ""}>{r.organization?.name || "—"}</td>
                <td className="td">{r.division ? <Badge tone="violet">{r.division}</Badge> : "—"}</td>
                <td className="td"><Plate no={r.vehicle_no} /></td>
                <td className="td text-slate-400 text-xs">{r.payment_type || "—"}</td>
                <td className="td text-xs">{r.vat ? <Badge tone="violet">с НДС</Badge> : <span className="text-slate-600">без НДС</span>}</td>
                <td className="td text-right">{withUnit(r.qty, r.material?.unit)}</td>
                {money && <>
                  <td className="td text-right">{fmtNum(r.price_uzs)}</td>
                  <td className="td text-right">{fmtNum(r.amount_uzs)}</td>
                  <td className="td text-right text-slate-400">{Number(r.vat_amount) ? fmtNum(r.vat_amount) : "—"}</td>
                  <td className="td text-right font-semibold text-ink">{fmtNum(r.amount_gross)}</td>
                </>}
                <td className="td text-right whitespace-nowrap">
                  {isLocked(r.doc_date) ? <LockedMark title={hint} /> : <>
                    {can("materials:edit") && <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                    {can("materials:delete") && <button onClick={() => remove(r.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                  </>}
                </td>
              </tr>))}</tbody>
            {/* количество разных материалов не складываем — только деньги,
                поэтому без права «Суммы» итог просто нечего показывать */}
            {money && (
              <TotalRow cells={[null, null, null, null, null, null, null, null,
                                uzs(sum(f.rows, "amount_uzs")),
                                uzs(sum(f.rows, "vat_amount")),
                                uzs(sum(f.rows, "amount_gross")), null]} />
            )}
          </table></div>
        )}
      </Card>
      <GridModal<ReceiptRow>
        open={open} onClose={() => setOpen(false)} err={err} saving={saving}
        editing={!!editing} minWidth={1180} rows={rows} dates={rows.map((r) => r.doc_date)}
        complete={filled("material_id")} started={started("material_id")} need="материал и количество"
        onAdd={add} onDel={del} onSave={save}
        title={`${editing ? "Изменить приход" : "Приход"} ${kind === "spare" ? "запчастей" : "сырья"}`}
        totals={[
          ["Сумма без НДС", fmtNum(bNet)],
          ["НДС", fmtNum(bVat)],
          ["К оплате", fmtNum(bNet + bVat)],
        ]}
        cols={[
          { label: "Дата", w: "w-[8.5rem]", cell: (r, i) => <CellDate value={r.doc_date} min={minOpenDate || undefined} onChange={(v) => set(i, { doc_date: v })} /> },
          { label: "Материал", w: "min-w-[11rem]", wide: true, cell: (r, i) => <SearchSelect className="input-cell" value={String(r.material_id || "")} onChange={(v) => set(i, { material_id: v })} placeholder="—" emptyLabel="—" options={optItem(mats)} /> },
          { label: "Поставщик", w: "min-w-[10rem]", wide: true, cell: (r, i) => <SearchSelect className="input-cell" value={String(r.organization_id || "")} onChange={(v) => set(i, { organization_id: v })} placeholder="—" emptyLabel="—" options={optOrg(orgs)} /> },
          { label: "Подразделение", w: "min-w-[8rem]", cell: (r, i) => <SearchSelect className="input-cell" value={r.division} onChange={(v) => set(i, { division: v })} placeholder="—" emptyLabel="—" options={optDiv(divs)} /> },
          { label: "Авто номер", w: "w-[8rem]", cell: (r, i) => <CellPlate value={r.vehicle_no} onChange={(v) => set(i, { vehicle_no: v })} /> },
          { label: "Вид оплаты", w: "w-[8rem]", cell: (r, i) => <CellPay value={r.payment_type} options={paymentTypes} onChange={(v) => set(i, { payment_type: v })} /> },
          { label: `НДС ${pct}`, w: "w-14", align: "center", cell: (r, i) => <CellVat checked={r.vat} title={`Поставщик — плательщик НДС (${pct} сверху цены)`} onChange={(v) => set(i, { vat: v })} /> },
          { label: "Кол-во", w: "w-[6.5rem]", align: "right", cell: (r, i) => <MoneyInput className="input-cell text-right" value={r.qty} onChange={(v) => set(i, { qty: v })} /> },
          { label: "Цена без НДС", w: "w-[8rem]", align: "right", cell: (r, i) => <MoneyInput className="input-cell text-right" value={r.price_uzs} onChange={(v) => set(i, { price_uzs: v })} /> },
          {
            label: "Сумма с НДС", w: "w-[8rem]", align: "right", calc: true,
            cell: (r) => {
              const net = num(r.qty) * num(r.price_uzs);
              return net ? fmtNum(net + (r.vat ? net * nds : 0)) : "—";
            },
          },
        ]}
        note={
          <p className="mt-3 text-xs text-slate-500">
            Цена — <b className="text-slate-300">без НДС</b>: при галочке «НДС» налог {pct}{" "}
            начисляется сверху. Подразделение — дробилка, на склад которой приходуется
            материал: остаток и средняя цена ведутся отдельно по каждому объекту.
          </p>
        }
      />
    </>
  );
}

// ---------- Расход сырья / запчастей ----------
function Issues({ kind }: { kind: string }) {
  const { can } = useAuth();
  const money = useMoney();
  const { isLocked, isPeriodLocked, minOpenDate, hint } = useLock();
  const { qs } = usePeriod();
  const { materials, divs, expCodes } = useRefs();
  const mats = (materials || []).filter((m) => m.kind === kind);
  const url = withPeriod("/material-issues", qs);
  const { data: all, loading, reload } = useApi<any[]>(url, [url]);
  const data = all?.filter((r) => r.material?.kind === kind);
  const [open, setOpen] = useState(false); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const blank = (): IssueRow => ({ doc_date: today(), material_id: "", division: "", expense_code: "", vehicle_no: "", qty: 0 });
  const { rows, set, add, del, reset } = useRows(blank, ["doc_date", "division", "expense_code", "vehicle_no"]);
  const [editing, setEditing] = useState<any>(null);
  const f = useFilter<any>(
    data,
    (r) => text(r.doc_date, r.material?.code, r.material?.name, r.division, r.expense_code, r.vehicle_no, r.cost_uzs),
    [
      { key: "mat", label: "Материал", of: (r) => r.material?.name || "" },
      { key: "div", label: "Объект", of: (r) => r.division || "" },
      { key: "code", label: "Код", of: (r) => r.expense_code || "" },
      { key: "car", label: "Авто", of: (r) => r.vehicle_no || "" },
    ]
  );
  const body = (r: any) => ({
    doc_date: r.doc_date, material_id: Number(r.material_id), division: r.division,
    expense_code: r.expense_code, vehicle_no: r.vehicle_no, qty: Number(r.qty),
  });
  const save = async () => {
    setErr(""); setSaving(true);
    try {
      if (editing) await api.put(`/material-issues/${editing.id}`, body(rows[0]));
      else await api.post("/material-issues/batch", { items: rows.map(body) });
      setOpen(false); reload();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const openEdit = (r: any) => { setEditing(r); reset({ doc_date: r.doc_date, material_id: String(r.material_id), division: r.division || "", expense_code: r.expense_code || "", vehicle_no: r.vehicle_no || "", qty: r.qty }); setErr(""); setOpen(true); };
  const remove = async (id: number) => { if (confirm("Удалить?")) { await api.delete(`/material-issues/${id}`); reload(); } };
  return (
    <>
      <Toolbar can={can("materials:create")} onAdd={() => { setEditing(null); reset(); setErr(""); setOpen(true); }} label="Расход" />
      {!loading && !!data?.length && <FilterBar f={f} placeholder="Материал, объект, код…" />}
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Нет расхода" /> :
         !f.rows.length ? <EmptyState text="Под фильтр ничего не подошло" /> : (
          <div className="overflow-x-auto"><table className="reg w-full min-w-[760px]">
            <thead><tr className="bg-veil/[0.02]">
              <th className="th">Дата</th><th className="th">Материал</th><th className="th">Объект</th>
              <th className="th">Код расхода</th><th className="th">Авто номер</th>
              <th className="th text-right">Кол-во</th>
              {money && <><th className="th text-right">Цена</th><th className="th text-right">Сумма</th></>}
              <th className="th"></th>
            </tr></thead>
            <tbody>{f.rows.map((r) => (
              <tr key={r.id} className="hover:bg-veil/[0.02]">
                <td className="td whitespace-nowrap">{fmtDate(r.doc_date)}</td><td className="td text-ink">{r.material?.code && <span className="text-slate-500 font-mono mr-1.5">{r.material.code}</span>}{r.material?.name}</td>
                <td className="td">{r.division ? <Badge tone="violet">{r.division}</Badge> : "—"}</td>
                <td className="td font-mono text-slate-400">{r.expense_code || "—"}</td>
                <td className="td"><Plate no={r.vehicle_no} /></td>
                <td className="td text-right">{withUnit(r.qty, r.material?.unit)}</td>
                {money && <>
                  <td className="td text-right text-slate-400">{Number(r.qty) ? fmtNum(Number(r.cost_uzs) / Number(r.qty)) : "—"}</td>
                  <td className="td text-right font-semibold text-ink">{fmtNum(r.cost_uzs)}</td>
                </>}
                <td className="td text-right whitespace-nowrap">
                  {isLocked(r.doc_date) ? <LockedMark title={hint} /> : <>
                    {can("materials:edit") && <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                    {can("materials:delete") && <button onClick={() => remove(r.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                  </>}
                </td>
              </tr>))}</tbody>
            {money && (
              <TotalRow cells={[null, null, null, null, null, null,
                                uzs(sum(f.rows, "cost_uzs")), null]} />
            )}
          </table></div>
        )}
      </Card>
      <GridModal<IssueRow>
        open={open} onClose={() => setOpen(false)} err={err} saving={saving}
        editing={!!editing} minWidth={880} rows={rows} dates={rows.map((r) => r.doc_date)}
        complete={filled("material_id")} started={started("material_id")} need="материал и количество"
        onAdd={add} onDel={del} onSave={save}
        title={`${editing ? "Изменить расход" : "Расход"} ${kind === "spare" ? "запчастей" : "сырья"}`}
        cols={[
          { label: "Дата", w: "w-[8.5rem]", cell: (r, i) => <CellDate value={r.doc_date} min={minOpenDate || undefined} onChange={(v) => set(i, { doc_date: v })} /> },
          { label: "Материал", w: "min-w-[13rem]", wide: true, cell: (r, i) => <SearchSelect className="input-cell" value={String(r.material_id || "")} onChange={(v) => set(i, { material_id: v })} placeholder="—" emptyLabel="—" options={optItem(mats)} /> },
          { label: "Объект", w: "min-w-[9rem]", cell: (r, i) => <SearchSelect className="input-cell" value={r.division} onChange={(v) => set(i, { division: v })} placeholder="—" emptyLabel="—" options={optDiv(divs)} /> },
          { label: "Код расхода", w: "min-w-[10rem]", wide: true, cell: (r, i) => <SearchSelect className="input-cell" value={r.expense_code} onChange={(v) => set(i, { expense_code: v })} placeholder="—" emptyLabel="—" options={optCode(expCodes)} /> },
          { label: "Авто номер", w: "w-[8rem]", cell: (r, i) => <CellPlate value={r.vehicle_no} onChange={(v) => set(i, { vehicle_no: v })} /> },
          { label: "Кол-во", w: "w-[7rem]", align: "right", cell: (r, i) => <MoneyInput className="input-cell text-right" value={r.qty} onChange={(v) => set(i, { qty: v })} /> },
        ]}
        note={
          /* Флажка «С НДС» здесь нет: расход — внутреннее списание со своего
             склада, НДС в нём не возникает и на сумму никогда не влиял. */
          <p className="mt-3 text-xs text-slate-500">
            Сумма не вводится: материал списывается по средней себестоимости того
            объекта, с которого его берут. Если строк по одному материалу несколько,
            остаток проверяется по их сумме.
          </p>
        }
      />
    </>
  );
}

// ---------- Производство ----------
function Productions() {
  const { can } = useAuth();
  const money = useMoney();
  const { isLocked, isPeriodLocked, minOpenDate, hint } = useLock();
  const { qs } = usePeriod();
  const { products, divs } = useRefs();
  const url = withPeriod("/productions", qs);
  const { data, loading, reload } = useApi<any[]>(url, [url]);
  const [open, setOpen] = useState(false); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const blank = (): ProdRow => ({ doc_date: today(), product_id: "", division: "", qty: 0 });
  const { rows, set, add, del, reset } = useRows(blank, ["doc_date", "division"]);
  const [editing, setEditing] = useState<any>(null);
  const f = useFilter<any>(
    data,
    (r) => text(r.doc_date, r.product?.code, r.product?.name, r.division, r.qty, r.amount_uzs),
    [
      { key: "prod", label: "Продукция", of: (r) => r.product?.name || "" },
      { key: "div", label: "Объект", of: (r) => r.division || "" },
    ]
  );
  /**
   * Себестоимость НЕ вводится — её считает сервер и переписывает у ВСЕХ
   * документов выпуска подразделения за месяц: (расход сырья + производственные
   * расходы) ÷ выпуск месяца.
   *
   * Поэтому подсказка считается не по строке, а по ГРУППЕ «подразделение +
   * месяц»: две строки одного объекта за один месяц делят общие расходы на
   * свою суммарную выработку, и показывать им разные цифры было бы враньём.
   */
  const groups = useMemo(() => {
    const g: Record<string, { division: string; year: string; month: string; qty: number }> = {};
    for (const r of rows) {
      if (!r.doc_date) continue;
      const [year, month] = r.doc_date.split("-");
      const key = `${r.division}|${year}-${month}`;
      (g[key] ||= { division: r.division, year, month, qty: 0 }).qty += num(r.qty);
    }
    return g;
  }, [rows]);
  const [costs, setCosts] = useState<Record<string, any>>({});
  const groupKey = JSON.stringify(groups);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const out: Record<string, any> = {};
      await Promise.all(Object.entries(groups).map(async ([key, g]) => {
        const p = new URLSearchParams({
          division: g.division, year: g.year, month: String(Number(g.month)),
          add_qty: String(g.qty),
        });
        // при правке своё же количество исключаем из делителя, иначе оно
        // попало бы в выпуск месяца дважды
        if (editing) p.set("exclude_id", String(editing.id));
        try { out[key] = (await api.get(`/reports/production-cost?${p}`)).data; } catch { /* подсказка не критична */ }
      }));
      if (alive) setCosts(out);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, open, editing]);

  const body = (r: any) => ({
    doc_date: r.doc_date, product_id: Number(r.product_id),
    division: r.division, qty: Number(r.qty),
  });
  const save = async () => {
    setErr(""); setSaving(true);
    try {
      if (editing) await api.put(`/productions/${editing.id}`, body(rows[0]));
      else await api.post("/productions/batch", { items: rows.map(body) });
      setOpen(false); reload();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const openEdit = (r: any) => {
    setEditing(r);
    reset({ doc_date: r.doc_date, product_id: String(r.product_id), division: r.division || "", qty: r.qty });
    setErr(""); setOpen(true);
  };
  const remove = async (id: number) => { if (confirm("Удалить?")) { await api.delete(`/productions/${id}`); reload(); } };
  return (
    <>
      <Toolbar can={can("production:create")} onAdd={() => { setEditing(null); reset(); setCosts({}); setErr(""); setOpen(true); }} label="Производство" />
      {!loading && !!data?.length && <FilterBar f={f} placeholder="Продукция, объект, дата…" />}
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Нет выпуска" /> :
         !f.rows.length ? <EmptyState text="Под фильтр ничего не подошло" /> : (
          <div className="overflow-x-auto"><table className="reg w-full min-w-[640px]">
            <thead><tr className="bg-veil/[0.02]"><th className="th">Дата</th><th className="th">Продукция</th><th className="th">Подразд.</th><th className="th text-right">Кол-во</th>
              {money && <><th className="th text-right">Себест./ед</th><th className="th text-right">Сумма</th></>}
              <th className="th"></th></tr></thead>
            <tbody>{f.rows.map((r) => (
              <tr key={r.id} className="hover:bg-veil/[0.02]">
                <td className="td whitespace-nowrap">{fmtDate(r.doc_date)}</td><td className="td text-ink">{r.product?.code && <span className="text-slate-500 font-mono mr-1.5">{r.product.code}</span>}{r.product?.name}</td>
                <td className="td">{r.division ? <Badge tone="violet">{r.division}</Badge> : "—"}</td>
                <td className="td text-right">{fmtNum(r.qty)}</td>
                {money && <>
                  <td className="td text-right">{fmtNum(r.unit_cost)}</td>
                  <td className="td text-right font-semibold text-ink">{fmtNum(r.amount_uzs)}</td>
                </>}
                <td className="td text-right whitespace-nowrap">
                  {isLocked(r.doc_date) ? <LockedMark title={hint} /> : <>
                    {can("production:edit") && <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                    {can("production:delete") && <button onClick={() => remove(r.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                  </>}
                </td>
              </tr>))}</tbody>
            {/* средняя себестоимость по фильтру = сумма ÷ количество, а не сумма цен */}
            <TotalRow cells={[null, null,
                              qty(sum(f.rows, "qty")),
                              ...(money ? [
                                uzs(sum(f.rows, "qty") ? sum(f.rows, "amount_uzs") / sum(f.rows, "qty") : 0),
                                uzs(sum(f.rows, "amount_uzs")),
                              ] : []),
                              null]} />
          </table></div>
        )}
      </Card>
      <GridModal<ProdRow>
        open={open} onClose={() => setOpen(false)} err={err} saving={saving}
        editing={!!editing} minWidth={720} rows={rows} dates={rows.map((r) => r.doc_date)}
        complete={filled("product_id")} started={started("product_id")} need="продукцию и количество"
        onAdd={add} onDel={del} onSave={save}
        title={editing ? "Изменить выпуск" : "Производство ГП"}
        cols={[
          { label: "Дата", w: "w-[8.5rem]", cell: (r, i) => <CellDate value={r.doc_date} min={minOpenDate || undefined} onChange={(v) => set(i, { doc_date: v })} /> },
          { label: "Продукция", w: "min-w-[15rem]", wide: true, cell: (r, i) => <SearchSelect className="input-cell" value={String(r.product_id || "")} onChange={(v) => set(i, { product_id: v })} placeholder="—" emptyLabel="—" options={optItem(products)} /> },
          { label: "Подразделение", w: "min-w-[11rem]", cell: (r, i) => <SearchSelect className="input-cell" value={r.division} onChange={(v) => set(i, { division: v })} placeholder="—" emptyLabel="—" options={optDiv(divs)} /> },
          { label: "Кол-во (выпуск)", w: "w-[8rem]", align: "right", cell: (r, i) => <MoneyInput className="input-cell text-right" value={r.qty} onChange={(v) => set(i, { qty: v })} /> },
        ]}
        note={
          Object.keys(costs).length ? (
            <div className="mt-3 space-y-2">
              {Object.entries(groups).map(([key, g]) => {
                const c = costs[key];
                if (!c) return null;
                return (
                  <div key={key} className="rounded-xl bg-veil/[0.03] border border-line px-3.5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-slate-400">
                        Себестоимость за ед. — {g.division || "общий объект"}, {g.month}.{g.year}
                      </span>
                      <b className="text-xl text-emerald-300 tabular-nums whitespace-nowrap">
                        {fmtNum(c.unit_cost)} сум
                      </b>
                    </div>
                    <div className="text-xs text-slate-500 mt-2 space-y-0.5">
                      <div>
                        (сырьё <b className="text-slate-300">{fmtNum(c.materials_cost)}</b>
                        {" + "}произв. расходы <b className="text-slate-300">{fmtNum(c.prod_expenses)}</b>)
                        {" ÷ "}выпуск <b className="text-slate-300">{fmtNum(c.produced_qty)}</b>
                      </div>
                      <div className="text-slate-600">
                        выпуск = уже проведено за месяц {fmtNum(c.saved_qty)}
                        {" + "}вводится сейчас {fmtNum(c.add_qty)}
                        {editing ? " (текущий документ из подсчёта исключён)" : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-amber-300/80">
                Расходы месяца делятся на ВЕСЬ выпуск месяца, поэтому после сохранения
                себестоимость пересчитается сразу у всех документов выпуска этого
                подразделения — и у введённых ранее тоже.
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 mt-3">
              Себестоимость считается автоматически: (расход сырья + производств. расходы
              подразделения) ÷ выпуск за месяц. Вручную она не задаётся — иначе документы
              одного месяца разошлись бы между собой.
            </p>
          )
        }
      />
    </>
  );
}

// ---------- Продажа ----------
function Sales() {
  const { can } = useAuth();
  const money = useMoney();
  const { isLocked, isPeriodLocked, minOpenDate, hint } = useLock();
  const { qs } = usePeriod();
  const { products, orgs, divs } = useRefs();
  const url = withPeriod("/sales", qs);
  const { data, loading, reload } = useApi<any[]>(url, [url]);
  const [open, setOpen] = useState(false); const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const blank = (): SaleRow => ({ doc_date: today(), product_id: "", organization_id: "", division: "", vehicle_no: "", qty: 0, price_uzs: 0, vat: false, payment_type: "" });
  const { rows, set, add, del, reset } = useRows(blank, ["doc_date", "organization_id", "division", "vehicle_no", "payment_type", "vat"]);
  const [editing, setEditing] = useState<any>(null);
  const { paymentTypes, nds, pct } = useLookups();
  // продажа: цена ИЗ СЧЁТА. Если продажа с НДС — налог сидит ВНУТРИ неё и
  // выделяется обратным счётом, а не начисляется сверху (как в приходе).
  /**
   * Подставить из прайса покупателя цену И флажок НДС на дату документа.
   *
   * НДС едет вместе с ценой: в прайсе отмечено «с НДС» — в продаже галочка
   * встаёт сама, снято — гаснет. Иначе цену подставляли бы автоматом, а
   * режим налога всё равно щёлкали руками на каждой строке.
   *
   * Затираем только то, что пусто или само же и подставилось: если цену или
   * НДС тронули руками, прайс их не перебивает — иначе правка молча
   * откатывалась бы при смене даты.
   */
  const priceList = usePriceList();
  const fillPrice = async (i: number, row: SaleRow) => {
    if (!row.organization_id || !row.product_id || !row.doc_date) return;
    if (num(row.price_uzs) && !row.price_auto) return;
    const hit = (await priceList(row.organization_id, row.doc_date))[row.product_id];
    set(i, hit
      ? { price_uzs: hit.price_uzs, vat: hit.vat, price_from: hit.start_date, price_auto: true }
      : { price_from: undefined, ...(row.price_auto ? { price_uzs: 0, price_auto: false } : {}) });
  };
  /** Изменили дату/покупателя/товар — цену пересобираем. */
  const setSale = (i: number, patch: Partial<SaleRow>) => {
    const next = { ...rows[i], ...patch };
    set(i, patch);
    if ("organization_id" in patch || "product_id" in patch || "doc_date" in patch) {
      void fillPrice(i, next);
    }
  };

  const rowGross = (r: any) => num(r.qty) * num(r.price_uzs);
  const rowNet = (r: any) => (r.vat ? rowGross(r) / (1 + nds) : rowGross(r));
  const bGross = rows.reduce((a, r) => a + rowGross(r), 0);
  const bNetRev = rows.reduce((a, r) => a + rowNet(r), 0);
  const f = useFilter<any>(
    data,
    (r) => text(r.doc_date, r.product?.code, r.product?.name, r.organization?.name,
                r.division, r.vehicle_no, r.payment_type, r.qty, r.revenue_net),
    [
      { key: "prod", label: "Продукция", of: (r) => r.product?.name || "" },
      { key: "org", label: "Покупатель", of: (r) => r.organization?.name || "" },
      { key: "div", label: "Дробилка", of: (r) => r.division || "" },
      { key: "car", label: "Авто", of: (r) => r.vehicle_no || "" },
      { key: "pay", label: "Оплата", of: (r) => r.payment_type || "" },
    ]
  );
  const body = (r: any) => ({
    doc_date: r.doc_date, product_id: Number(r.product_id),
    organization_id: r.organization_id ? Number(r.organization_id) : null,
    division: r.division, vehicle_no: r.vehicle_no, payment_type: r.payment_type,
    qty: Number(r.qty), price_uzs: Number(r.price_uzs), vat: r.vat,
  });
  const save = async () => {
    setErr(""); setSaving(true);
    try {
      if (editing) await api.put(`/sales/${editing.id}`, body(rows[0]));
      else await api.post("/sales/batch", { items: rows.map(body) });
      setOpen(false); reload();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const openEdit = (r: any) => { setEditing(r); reset({ doc_date: r.doc_date, product_id: String(r.product_id), organization_id: r.organization_id ? String(r.organization_id) : "", division: r.division || "", vehicle_no: r.vehicle_no || "", qty: r.qty, price_uzs: r.price_uzs, vat: r.vat, payment_type: r.payment_type || "" }); setErr(""); setOpen(true); };
  const remove = async (id: number) => { if (confirm("Удалить?")) { await api.delete(`/sales/${id}`); reload(); } };
  // накладная печатается по каждой строке отдельно — как её и отгружают
  const [billId, setBillId] = useState<number | null>(null);
  return (
    <>
      <Toolbar can={can("sales:create") && money} onAdd={() => { setEditing(null); reset(); setErr(""); setOpen(true); }} label="Продажа" />
      {!money && <MoneyHidden what="продажу" />}
      {!loading && !!data?.length && <FilterBar f={f} placeholder="Продукция, покупатель, объект…" />}
      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Нет продаж" /> :
         !f.rows.length ? <EmptyState text="Под фильтр ничего не подошло" /> : (
          <div className="overflow-x-auto"><table className="reg w-full min-w-[1100px]">
            <thead><tr className="bg-veil/[0.02]">
              <th className="th">Дата</th><th className="th">Продукция</th><th className="th">Покупатель</th>
              <th className="th">Дробилка</th><th className="th">Авто номер</th><th className="th">Вид оплаты</th>
              <th className="th text-right">Кол-во</th>
              {money && <>
                <th className="th text-right">Цена</th>
                <th className="th text-right">Сумма по счёту</th><th className="th text-right">НДС</th>
                <th className="th text-right">Выручка без НДС</th><th className="th text-right">Себест.</th>
                <th className="th text-right">Прибыль</th>
              </>}
              <th className="th"></th>
            </tr></thead>
            <tbody>{f.rows.map((r) => (
              <tr key={r.id} className="hover:bg-veil/[0.02]">
                <td className="td whitespace-nowrap">{fmtDate(r.doc_date)}</td><td className="td text-ink">{r.product?.code && <span className="text-slate-500 font-mono mr-1.5">{r.product.code}</span>}{r.product?.name}</td>
                <td className="td max-w-[140px] truncate" title={r.organization?.name || ""}>{r.organization?.name || "—"}</td>
                <td className="td">{r.division ? <Badge tone="violet">{r.division}</Badge> : "—"}</td>
                <td className="td"><Plate no={r.vehicle_no} /></td>
                <td className="td text-slate-400 text-xs">{r.payment_type || "—"}</td>
                <td className="td text-right">{withUnit(r.qty, r.product?.unit)}</td>
                {money && <>
                  <td className="td text-right">{fmtNum(r.price_uzs)}</td>
                  <td className="td text-right">{fmtNum(Number(r.qty) * Number(r.price_uzs))}</td>
                  <td className="td text-right text-slate-400">{Number(r.vat_amount) ? fmtNum(r.vat_amount) : "—"}</td>
                  <td className="td text-right text-emerald-300">{fmtNum(r.revenue_net)}</td>
                  <td className="td text-right text-slate-400">{fmtNum(r.cogs_uzs)}</td>
                  <td className="td text-right font-semibold text-ink">{fmtNum(r.revenue_net - r.cogs_uzs)}</td>
                </>}
                <td className="td text-right whitespace-nowrap">
                  {/* в накладной есть цена — без права «Суммы» её не печатают */}
                  {money && <button onClick={() => setBillId(r.id)} title="Накладная (печать)"
                    className="text-slate-500 hover:text-accent-soft mr-3">🖨</button>}
                  {isLocked(r.doc_date) ? <LockedMark title={hint} /> : <>
                    {can("sales:edit") && <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                    {can("sales:delete") && <button onClick={() => remove(r.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                  </>}
                </td>
              </tr>))}</tbody>
            <TotalRow cells={[null, null, null, null, null,
                              qty(sum(f.rows, "qty")),
                              ...(money ? [
                                null,
                                uzs(f.rows.reduce((a, r) => a + Number(r.qty || 0) * Number(r.price_uzs || 0), 0)),
                                uzs(sum(f.rows, "vat_amount")),
                                uzs(sum(f.rows, "revenue_net")),
                                uzs(sum(f.rows, "cogs_uzs")),
                                uzs(sum(f.rows, "revenue_net") - sum(f.rows, "cogs_uzs")),
                              ] : []),
                              null]} />
          </table></div>
        )}
      </Card>
      <GridModal<SaleRow>
        open={open} onClose={() => setOpen(false)} err={err} saving={saving}
        editing={!!editing} minWidth={1220} rows={rows} dates={rows.map((r) => r.doc_date)}
        complete={filled("product_id")} started={started("product_id")} need="продукцию и количество"
        onAdd={add} onDel={del} onSave={save}
        title={editing ? "Изменить продажу" : "Продажа ГП"}
        totals={[
          ["Сумма по счёту", fmtNum(bGross)],
          ["НДС", fmtNum(bGross - bNetRev)],
          ["Выручка без НДС", fmtNum(bNetRev)],
        ]}
        cols={[
          { label: "Дата", w: "w-[8.5rem]", cell: (r, i) => <CellDate value={r.doc_date} min={minOpenDate || undefined} onChange={(v) => setSale(i, { doc_date: v })} /> },
          { label: "Продукция", w: "min-w-[11rem]", wide: true, cell: (r, i) => <SearchSelect className="input-cell" value={String(r.product_id || "")} onChange={(v) => setSale(i, { product_id: v })} placeholder="—" emptyLabel="—" options={optItem(products)} /> },
          { label: "Покупатель", w: "min-w-[10rem]", wide: true, cell: (r, i) => <SearchSelect className="input-cell" value={String(r.organization_id || "")} onChange={(v) => setSale(i, { organization_id: v })} placeholder="—" emptyLabel="—" options={optOrg(orgs)} /> },
          { label: "Дробилка", w: "min-w-[8rem]", cell: (r, i) => <SearchSelect className="input-cell" value={r.division} onChange={(v) => set(i, { division: v })} placeholder="—" emptyLabel="—" options={optDiv(divs)} /> },
          { label: "Авто номер", w: "w-[8rem]", cell: (r, i) => <CellPlate value={r.vehicle_no} onChange={(v) => set(i, { vehicle_no: v })} /> },
          { label: "Вид оплаты", w: "w-[8rem]", cell: (r, i) => <CellPay value={r.payment_type} options={paymentTypes} onChange={(v) => set(i, { payment_type: v })} /> },
          {
            label: `НДС ${pct}`, w: "w-14", align: "center",
            // ручное переключение снимает признак «из прайса»: дальше ни цену,
            // ни НДС этой строки прайс не перебивает
            cell: (r, i) => <CellVat checked={r.vat} onChange={(v) => set(i, { vat: v, price_auto: false })}
              title={r.price_auto && r.price_from
                ? `Из прайса от ${fmtDate(r.price_from)}: цена ${r.vat ? "с НДС" : "без НДС"}`
                : `Продажа облагается НДС ${pct} (налог внутри цены)`} />,
          },
          { label: "Кол-во", w: "w-[6.5rem]", align: "right", cell: (r, i) => <MoneyInput className="input-cell text-right" value={r.qty} onChange={(v) => set(i, { qty: v })} /> },
          {
            label: "Цена", w: "w-[9rem]", align: "right",
            cell: (r, i) => (
              <>
                {/* правка руками снимает признак «из прайса»: дальше цену
                    не перебивает ни смена даты, ни смена покупателя */}
                <MoneyInput className="input-cell text-right" value={r.price_uzs}
                  onChange={(v) => set(i, { price_uzs: v, price_auto: false })} />
                {r.price_from && r.price_auto && (
                  <div className="mt-0.5 text-[10px] text-emerald-300/80 text-right whitespace-nowrap"
                    title="Цена и НДС подставлены из прайс-листа покупателя">
                    прайс от {fmtDate(r.price_from)} · {r.vat ? "с НДС" : "без НДС"}
                  </div>
                )}
              </>
            ),
          },
          {
            label: "Выручка без НДС", w: "w-[8rem]", align: "right", calc: true,
            cell: (r) => <span className="text-emerald-300">{rowGross(r) ? fmtNum(rowNet(r)) : "—"}</span>,
          },
        ]}
        note={
          <p className="mt-3 text-xs text-slate-500">
            Цену вводите <b className="text-slate-300">как в счёте-фактуре</b>: при галочке
            «НДС» налог {pct} не добавляется сверху, а выделяется изнутри
            (выручка = сумма ÷ {(1 + nds).toFixed(2)}). Списание идёт со склада выбранной
            дробилки, по её себестоимости.
          </p>
        }
      />
      <WaybillModal saleId={billId} onClose={() => setBillId(null)} />
    </>
  );
}
