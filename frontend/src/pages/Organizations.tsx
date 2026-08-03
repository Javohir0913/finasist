import { useState } from "react";
import api, { apiError } from "../api/client";
import { Badge, Card, EmptyState, Field, Modal, MoneyInput, SectionTitle, Spinner } from "../components/ui";
import { fmtDate, fmtNum } from "../lib/format";
import { ORG_CATS, catLabel, catTone } from "../lib/cats";
import { useOpeningRate } from "../lib/rate";
import { sum } from "../lib/table";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface Org {
  id: number; inn: string; name: string; category: string; ledger: string;
  expense_code: string; belongs_to: string;
  nds_payer: boolean; nds_type: string; phone: string;
  opening_uzs: number; opening_usd: number; opening_rate: number; opening_date: string | null;
  balance_usd: number; balance_uzs: number;
  opening_debit: number; opening_credit: number;
  balance_debit: number; balance_credit: number;
}
interface LedgerType { key: string; label: string }
const empty = {
  inn: "", name: "", category: "customer", ledger: "customers", expense_code: "",
  belongs_to: "Прочие", nds_payer: false, nds_type: "", phone: "",
  open_dt: 0, open_kt: 0, opening_rate: 0, opening_date: "",
};

export default function Organizations() {
  const { can } = useAuth();
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const { data, loading, reload } = useApi<Org[]>(`/organizations?${cat ? `category=${cat}&` : ""}${q ? `q=${encodeURIComponent(q)}` : ""}`, [cat, q]);
  const { data: ledgers } = useApi<LedgerType[]>("/ledger-types");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Org | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const [help, setHelp] = useState(false);
  const ledgerLabel = (k: string) => ledgers?.find((l) => l.key === k)?.label ?? k;
  const { rate, date: rateDate } = useOpeningRate();

  // сальдо без даты и курса запрещено: непонятно, с какого момента оно
  // существует, а валютная база осталась бы нулевой — и всё сальдо ушло бы
  // в курсовой доход
  const openingUzs = Number(form.open_dt || 0) - Number(form.open_kt || 0);
  const dateMissing = !!openingUzs && !form.opening_date;
  const rateMissing = !!openingUzs && !(Number(form.opening_rate) > 0);
  const blocked = dateMissing || rateMissing;
  const openingUsd = openingUzs && Number(form.opening_rate) > 0
    ? openingUzs / Number(form.opening_rate) : 0;

  const openNew = () => {
    setEditing(null);
    // по умолчанию — дата начала учёта и курс на неё; и то и другое можно менять
    setForm({ ...empty, opening_rate: rate || 0, opening_date: rateDate || "" });
    setErr(""); setOpen(true);
  };
  const openEdit = (o: Org) => {
    setEditing(o);
    setForm({
      ...o,
      open_dt: o.opening_debit, open_kt: o.opening_credit,
      opening_rate: o.opening_rate || 0,
      opening_date: o.opening_date || "",
    });
    setErr(""); setOpen(true);
  };

  const save = async () => {
    if (blocked) return;
    setErr(""); setSaving(true);
    // Дебет и кредит — две стороны ОДНОГО сальдо, поэтому в базу уходит
    // разница: дебет со знаком «+», кредит со знаком «−».
    // opening_usd не шлём — сервер считает его как сальдо / курс.
    const body = {
      ...form,
      opening_uzs: openingUzs,
      opening_rate: Number(form.opening_rate || 0),
      opening_date: form.opening_date || null,
    };
    ["open_dt", "open_kt", "opening_usd",
     "opening_debit", "opening_credit", "balance_debit", "balance_credit"].forEach((k) => delete body[k]);
    delete body.balance_usd;   // сальдо считает сервер из документов
    delete body.balance_uzs;
    try {
      if (editing) await api.put(`/organizations/${editing.id}`, body);
      else await api.post("/organizations", body);
      setOpen(false); reload();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };
  const remove = async (id: number) => {
    if (!confirm("Удалить организацию?")) return;
    try { await api.delete(`/organizations/${id}`); reload(); }
    catch (e) { alert(apiError(e)); }
  };

  return (
    <div>
      <SectionTitle
        title="Реестр организаций"
        sub="Поставщики, заказчики и дебиторско-кредиторская задолженность"
        right={can("organizations:create") && <button className="btn-primary" onClick={openNew}>+ Организация</button>}
      />

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {[["", "Все"], ...ORG_CATS.map((c) => [c.v, c.l])].map(([v, l]) => (
          <button key={v} onClick={() => setCat(v)} className={`chip ${cat === v ? "bg-accent/15 text-accent-soft border border-accent/25" : "bg-veil/5 text-slate-400 border border-line"}`}>{l}</button>
        ))}
        <input className="input max-w-xs ml-auto" placeholder="Поиск по названию или ИНН…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <Card className="!p-0 overflow-hidden">
        {loading ? <Spinner /> : !data?.length ? <EmptyState text="Организации не найдены" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead><tr className="bg-veil/[0.02]">
                <th className="th">Наименование</th><th className="th">ИНН</th><th className="th">Категория</th>
                <th className="th">Ведомость Дт-Кт</th>
                <th className="th">НДС</th>
                <th className="th text-right border-l border-line">Входящее Дт</th>
                <th className="th text-right">Входящее Кт</th>
                <th className="th text-right border-l border-line">Сальдо Дт</th>
                <th className="th text-right">Сальдо Кт</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {data.map((o) => (
                  <tr key={o.id} className="hover:bg-veil/[0.02]">
                    <td className="td font-medium text-ink max-w-[240px] truncate">{o.name}</td>
                    <td className="td text-slate-400">{o.inn || "—"}</td>
                    <td className="td"><Badge tone={catTone(o.category)}>{catLabel(o.category)}</Badge></td>
                    <td className="td text-slate-400 text-xs">{ledgerLabel(o.ledger)}</td>
                    <td className="td">{o.nds_payer ? <Badge tone="violet">НДС</Badge> : <span className="text-slate-600">—</span>}</td>
                    <td className="td text-right text-slate-400 tabular-nums border-l border-line">{o.opening_debit ? fmtNum(o.opening_debit) : "—"}</td>
                    <td className="td text-right text-slate-400 tabular-nums">{o.opening_credit ? fmtNum(o.opening_credit) : "—"}</td>
                    <td className="td text-right font-semibold tabular-nums text-emerald-300 border-l border-line">{o.balance_debit ? fmtNum(o.balance_debit) : "—"}</td>
                    <td className="td text-right font-semibold tabular-nums text-rose-300">{o.balance_credit ? fmtNum(o.balance_credit) : "—"}</td>
                    <td className="td text-right whitespace-nowrap">
                      {can("organizations:edit") && <button onClick={() => openEdit(o)} className="text-slate-500 hover:text-accent-soft mr-3">✎</button>}
                      {can("organizations:delete") && <button onClick={() => remove(o.id)} className="text-slate-500 hover:text-rose-300">✕</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-veil/[0.04] font-semibold text-ink">
                  <td className="td whitespace-nowrap text-slate-300" colSpan={5}>
                    Итого по фильтру · {data.length} орг.
                  </td>
                  <td className="td text-right tabular-nums border-l border-line">{fmtNum(sum(data, "opening_debit"))}</td>
                  <td className="td text-right tabular-nums">{fmtNum(sum(data, "opening_credit"))}</td>
                  <td className="td text-right tabular-nums text-emerald-300 border-l border-line">{fmtNum(sum(data, "balance_debit"))}</td>
                  <td className="td text-right tabular-nums text-rose-300">{fmtNum(sum(data, "balance_credit"))}</td>
                  <td className="td" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Редактировать организацию" : "Новая организация"} width="max-w-xl">
        {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2.5">{err}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Field label="Наименование"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
          <Field label="ИНН"><input className="input" value={form.inn} onChange={(e) => setForm({ ...form, inn: e.target.value })} /></Field>
          <Field label="Телефон"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Категория">
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {ORG_CATS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </Field>
          <Field label="Ведомость Дт-Кт">
            <select className="input" value={form.ledger} onChange={(e) => setForm({ ...form, ledger: e.target.value })}>
              {ledgers?.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          </Field>
          <Field label="Цех / принадлежность">
            <select className="input" value={form.belongs_to} onChange={(e) => setForm({ ...form, belongs_to: e.target.value })}>
              {["Прочие", "Махстон", "Турк", "Жби"].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="Код затрат (для ведомости «Офис»)">
            <input className="input" value={form.expense_code} onChange={(e) => setForm({ ...form, expense_code: e.target.value })} />
          </Field>
          <div className="col-span-2 border-t border-line pt-3 flex items-baseline justify-between gap-3">
            <div className="text-sm font-semibold text-ink">Входящее сальдо на начало учёта</div>
            <button type="button" className="text-xs text-slate-500 hover:text-accent-soft"
              onClick={() => setHelp((h) => !h)}>
              {help ? "▾" : "▸"} что это
            </button>
          </div>
          {help && (
            <p className="col-span-2 -mt-2 text-xs text-slate-500">
              Заполняется ОДНА сторона — как в книге на листах «Дт Кт …»:
              <b className="text-emerald-300"> Дебет</b> — контрагент должен нам;
              <b className="text-rose-300"> Кредит</b> — мы должны контрагенту.
              Текущее сальдо считается само: входящее + операции, приход ТМЦ, продажи и услуги.
              Курс задаётся <b>для самого сальдо</b> и работает только на него — документы
              берут курс на свою дату. По нему считается <b>валютная база</b> долга; она больше
              не пересчитывается, и разница между «сальдо ÷ курс на конец периода» и этой базой
              и есть курсовая разница.
            </p>
          )}
          <Field label="ДЕБЕТ, сум — нам должны">
            <MoneyInput value={form.open_dt} onChange={(v) => setForm({ ...form, open_dt: v })} />
          </Field>
          <Field label="КРЕДИТ, сум — мы должны">
            <MoneyInput value={form.open_kt} onChange={(v) => setForm({ ...form, open_kt: v })} />
          </Field>
          <Field label="Дата сальдо *">
            <input type="date" className="input" value={form.opening_date || ""}
              onChange={(e) => setForm({ ...form, opening_date: e.target.value })} />
            {dateMissing ? (
              <p className="mt-1 text-xs text-amber-300">
                Обязательно: на какую дату зафиксирован остаток
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">по ней берётся курс сальдо</p>
            )}
          </Field>
          <Field label="Курс сальдо (1$ = … сум) *">
            <MoneyInput value={form.opening_rate}
              onChange={(v) => setForm({ ...form, opening_rate: v })}
              placeholder={rate ? String(rate) : "12500"} />
            {rateMissing ? (
              <p className="mt-1 text-xs text-amber-300">
                Обязательно: без курса всё сальдо уйдёт в курсовую разницу
              </p>
            ) : rate ? (
              <button type="button" className="mt-1 text-xs text-slate-500 hover:text-accent-soft"
                onClick={() => setForm({ ...form, opening_rate: rate })}>
                подставить курс на начало учёта ({fmtNum(rate)}{rateDate ? ` · ${fmtDate(rateDate)}` : ""})
              </button>
            ) : null}
          </Field>
          <Field label="Валютная база сальдо, $">
            <input className="input disabled:opacity-70" disabled
              value={openingUsd ? fmtNum(Math.abs(Math.round(openingUsd * 100) / 100)) : "—"} />
            <p className="mt-1 text-xs text-slate-500">
              {openingUzs ? (openingUzs > 0 ? "Дебет" : "Кредит") : "считается как сальдо ÷ курс"}
            </p>
          </Field>
          {(Number(form.open_dt || 0) > 0 && Number(form.open_kt || 0) > 0) && (
            <div className="col-span-2 rounded-xl bg-amber-500/10 border border-amber-500/30 px-3.5 py-2.5 text-sm text-amber-200">
              Заполнены обе стороны. В ведомость попадёт разница:{" "}
              <b>
                {Number(form.open_dt) >= Number(form.open_kt)
                  ? `Дебет ${fmtNum(Number(form.open_dt) - Number(form.open_kt))}`
                  : `Кредит ${fmtNum(Number(form.open_kt) - Number(form.open_dt))}`}
              </b>
            </div>
          )}
          {editing && (
            <div className="col-span-2 rounded-xl bg-veil/[0.03] border border-line px-3.5 py-2.5 text-sm">
              <span className="text-slate-400">Текущее сальдо (расчётное): </span>
              {editing.balance_credit
                ? <b className="text-rose-300">Кредит {fmtNum(editing.balance_credit)} сум — мы должны</b>
                : <b className="text-emerald-300">Дебет {fmtNum(editing.balance_debit)} сум — нам должны</b>}
            </div>
          )}
          <div className="col-span-2 flex items-center gap-2 pt-1">
            <input id="nds" type="checkbox" checked={form.nds_payer} onChange={(e) => setForm({ ...form, nds_payer: e.target.checked })} className="h-4 w-4 accent-accent" />
            <label htmlFor="nds" className="text-sm text-slate-300">Плательщик НДС</label>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-ghost" onClick={() => setOpen(false)}>Отмена</button>
          <button className="btn-primary" onClick={save} disabled={saving || blocked}
            title={dateMissing ? "Укажите дату входящего сальдо"
                 : rateMissing ? "Укажите курс для входящего сальдо" : undefined}>{saving ? "Сохранение…" : "Сохранить"}</button>
        </div>
      </Modal>
    </div>
  );
}
