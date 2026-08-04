/**
 * Прайс-лист: цена продукции для конкретного покупателя с конкретной даты.
 *
 * Цены живут ИСТОРИЕЙ: 01.08 — 80 000, 07.08 — 100 000. В форму продажи
 * подставляется та, что действовала на дату документа. Уже проведённые
 * продажи прайс не трогает никогда — цена копируется в документ при вводе.
 */
import { useEffect, useMemo, useState } from "react";
import api, { apiError } from "../api/client";
import { Card, EmptyState, MoneyInput, SearchSelect, SectionTitle, Spinner } from "../components/ui";
import { fmtDate, fmtNum } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useAuth } from "../store/auth";

interface Org { id: number; name: string; inn?: string; category?: string }
interface Row {
  product_id: number; code: string; name: string; unit: string;
  price_uzs: number | null; start_date: string | null; vat: boolean;
  own: boolean; own_price: number | null; own_vat: boolean;
}
interface Hist { id: number; start_date: string; price_uzs: number; vat: boolean }

const today = () => new Date().toISOString().slice(0, 10);

export default function Prices() {
  const { can } = useAuth();
  const editable = can("prices:edit");
  const { data: orgs } = useApi<Org[]>("/organizations");
  // покупатели впереди: прайс ведут для них, поставщик тут редкий гость
  const options = useMemo(() => {
    const list = orgs || [];
    const rank = (o: Org) => (o.category === "customer" ? 0 : 1);
    return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ru"))
      .map((o) => ({
        value: String(o.id),
        label: o.category === "customer" ? o.name : `${o.name} · не покупатель`,
        search: `${o.name} ${o.inn || ""}`,
      }));
  }, [orgs]);

  const [org, setOrg] = useState("");
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState<Record<number, string>>({});
  // флажок «с НДС» рядом с ценой — он поедет в продажу вместе с ней
  const [vats, setVats] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [hist, setHist] = useState<{ row: Row; items: Hist[] } | null>(null);

  const load = async () => {
    if (!org || !date) { setRows(null); return; }
    setLoading(true); setErr(""); setMsg("");
    try {
      const { data } = await api.get(`/prices?organization_id=${org}&on=${date}`);
      setRows(data.rows);
      // в поля кладём цену ЭТОГО дня; унаследованная показана отдельной колонкой
      const d: Record<number, string> = {};
      const v: Record<number, boolean> = {};
      data.rows.forEach((r: Row) => {
        if (r.own && r.own_price != null) d[r.product_id] = String(r.own_price);
        v[r.product_id] = !!r.own_vat;
      });
      setDraft(d); setVats(v);
    } catch (e) { setErr(apiError(e)); setRows(null); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [org, date]);

  const dirty = useMemo(() => {
    if (!rows) return false;
    return rows.some((r) => {
      const was = r.own && r.own_price != null ? String(r.own_price) : "";
      const now = draft[r.product_id] ?? "";
      // НДС считаем изменением только у строк с ценой: без цены записи нет
      const vatChanged = now !== "" && !!vats[r.product_id] !== !!r.own_vat;
      return now !== was || vatChanged;
    });
  }, [rows, draft, vats]);

  const save = async () => {
    if (!rows) return;
    setSaving(true); setErr(""); setMsg("");
    const items = rows.map((r) => {
      const v = (draft[r.product_id] ?? "").trim();
      return {
        product_id: r.product_id,
        price_uzs: v === "" ? null : Number(v),
        vat: !!vats[r.product_id],
      };
    });
    try {
      const { data } = await api.put("/prices", { organization_id: Number(org), start_date: date, items });
      setMsg(`Сохранено на ${fmtDate(date)}: цен ${data.saved}${data.removed ? `, снято ${data.removed}` : ""}`);
      await load();
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };

  const openHist = async (r: Row) => {
    try {
      const { data } = await api.get(`/prices/history?organization_id=${org}&product_id=${r.product_id}`);
      setHist({ row: r, items: data });
    } catch (e) { setErr(apiError(e)); }
  };
  const dropHist = async (id: number) => {
    if (!confirm("Убрать эту цену? Проведённые продажи не изменятся.")) return;
    await api.delete(`/prices/${id}`);
    setHist(null);
    load();
  };

  return (
    <div>
      <SectionTitle
        title="Прайс-лист"
        sub="Цены продукции по покупателям. Цена действует С УКАЗАННОЙ ДАТЫ до следующей — проведённые продажи не меняются"
      />

      <Card className="mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_11rem] gap-4">
          <div>
            <label className="label">Покупатель</label>
            <SearchSelect value={org} onChange={setOrg} options={options}
              placeholder="— выберите покупателя —" emptyLabel="— не выбран —" />
          </div>
          <div>
            <label className="label">Цена действует с</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        {!editable && (
          <div className="mt-3 text-xs text-slate-500">
            Только просмотр — для изменения нужно право «Прайс-лист → edit».
          </div>
        )}
      </Card>

      {msg && <div className="mb-4 rounded-xl bg-emerald-500/12 border border-emerald-500/25 text-emerald-300 text-sm px-4 py-2.5">{msg}</div>}
      {err && <div className="mb-4 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-4 py-2.5">{err}</div>}

      {!org ? (
        <Card><EmptyState text="Выберите покупателя — покажем его цены" /></Card>
      ) : loading ? (
        <Card><Spinner /></Card>
      ) : !rows?.length ? (
        <Card><EmptyState text="Нет готовой продукции в справочнике" /></Card>
      ) : (
        <>
          <Card className="!p-0 overflow-hidden">
            <div className="overflow-x-auto"><table className="reg w-full min-w-[720px]">
              <thead><tr className="bg-veil/[0.02]">
                <th className="th">Код</th><th className="th">Наименование</th>
                <th className="th">Ед.</th>
                <th className="th text-right">Действует сейчас</th>
                <th className="th">с даты</th>
                <th className="th text-right">Цена с {fmtDate(date)}</th>
                <th className="th text-center">с НДС</th>
                <th className="th"></th>
              </tr></thead>
              <tbody>{rows.map((r) => {
                const v = draft[r.product_id] ?? "";
                const was = r.own && r.own_price != null ? String(r.own_price) : "";
                return (
                  <tr key={r.product_id} className={v !== was ? "bg-accent/[0.06]" : "hover:bg-veil/[0.02]"}>
                    <td className="td font-mono text-slate-500 whitespace-nowrap">{r.code || "—"}</td>
                    <td className="td text-ink">{r.name}</td>
                    <td className="td text-slate-500">{r.unit || "—"}</td>
                    <td className="td text-right tabular-nums whitespace-nowrap">
                      {r.price_uzs != null ? (
                        <>
                          {fmtNum(r.price_uzs)}
                          <span className="ml-1.5 text-[10px] text-slate-500">
                            {r.vat ? "с НДС" : "без НДС"}
                          </span>
                        </>
                      ) : <span className="text-slate-600">не задана</span>}
                    </td>
                    <td className="td text-slate-400 text-xs whitespace-nowrap">
                      {r.start_date ? fmtDate(r.start_date) : "—"}
                    </td>
                    <td className="td w-[10rem]">
                      <MoneyInput className="input-cell text-right" value={v} disabled={!editable}
                        onChange={(nv) => setDraft((d) => ({ ...d, [r.product_id]: nv }))} />
                    </td>
                    <td className="td text-center">
                      {/* поедет в продажу вместе с ценой: галочка там встанет сама */}
                      <input type="checkbox" className="h-4 w-4 accent-accent" disabled={!editable}
                        title="Цена указана С НДС внутри — в продаже флажок «НДС» встанет сам"
                        checked={!!vats[r.product_id]}
                        onChange={(e) => setVats((s) => ({ ...s, [r.product_id]: e.target.checked }))} />
                    </td>
                    <td className="td text-right whitespace-nowrap">
                      <button onClick={() => openHist(r)} title="История цены"
                        className="text-slate-500 hover:text-accent-soft">🕑</button>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </Card>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            <span className="text-xs text-slate-500">
              Пустое поле — цены на эту дату нет: останется действовать предыдущая.
            </span>
            {editable && (
              <button className="btn-primary ml-auto" onClick={save} disabled={saving || !dirty}>
                {saving ? "Сохраняем…" : dirty ? `Сохранить на ${fmtDate(date)}` : "Изменений нет"}
              </button>
            )}
          </div>
        </>
      )}

      {hist && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <div className="absolute inset-0 backdrop-veil backdrop-blur-sm" onClick={() => setHist(null)} />
          <div className="relative w-full max-w-md glass p-5 modal-panel overflow-y-auto">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="font-semibold text-ink">История цены</h3>
                <p className="text-xs text-slate-500 mt-0.5">{hist.row.name}</p>
              </div>
              <button onClick={() => setHist(null)} className="text-slate-400 hover:text-ink text-xl leading-none">✕</button>
            </div>
            {!hist.items.length ? (
              <p className="text-sm text-slate-500 py-6 text-center">Цены ещё не задавались</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>{hist.items.map((h) => (
                  <tr key={h.id} className="border-t border-line/60">
                    <td className="py-2 text-slate-400 whitespace-nowrap">с {fmtDate(h.start_date)}</td>
                    <td className="py-2 text-right text-ink tabular-nums font-semibold whitespace-nowrap">
                      {fmtNum(h.price_uzs)}
                      <span className="ml-1.5 text-[10px] font-normal text-slate-500">
                        {h.vat ? "с НДС" : "без НДС"}
                      </span>
                    </td>
                    <td className="py-2 text-right w-8">
                      {editable && (
                        <button onClick={() => dropHist(h.id)} title="Убрать"
                          className="text-slate-600 hover:text-rose-300">✕</button>
                      )}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            <p className="text-xs text-slate-500 mt-4">
              Удаление цены из прайса не меняет уже проведённые продажи — там цена своя.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
