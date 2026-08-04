/**
 * Конструктор печатной формы (ТТН).
 *
 * Сознательно НЕ редактор HTML: бланк собирается галочками и текстовыми
 * полями, а рядом сразу виден лист. Так «своя форма» настраивается без вёрстки
 * и без риска сломать документ опечаткой в разметке.
 */
import { useEffect, useState } from "react";
import api, { apiError } from "../api/client";
import { Sheet, WaybillCfg, WaybillDoc, WaybillPage } from "../lib/waybill";
import { Card, Spinner } from "./ui";

const TOGGLES: [keyof WaybillCfg, string][] = [
  ["show_logo", "Логотип"],
  ["show_seller_req", "Реквизиты поставщика"],
  ["show_buyer_req", "Реквизиты покупателя"],
  ["show_division", "Объект отгрузки"],
  ["show_payment_type", "Вид оплаты"],
  ["show_vehicle", "Автомобиль (гос. номер)"],
  ["show_driver_line", "Строка «Водитель»"],
  ["show_proxy_line", "Строка «Доверенность»"],
  ["show_unit_price_net", "Колонка «Цена без НДС»"],
  ["show_vat_row", "Строки НДС"],
  ["show_total_words", "Сумма прописью"],
  ["show_tiyin", "Тийины в сумме прописью"],
  ["show_stamp", "Место печати (М.П.)"],
  ["show_footer_note", "Нижняя сноска"],
];

const SELLER: [keyof WaybillCfg, string][] = [
  ["seller_name", "Наименование"],
  ["seller_inn", "ИНН"],
  ["seller_vat_code", "Рег. код НДС"],
  ["seller_address", "Адрес"],
  ["seller_phone", "Телефон"],
  ["seller_bank", "Банк"],
  ["seller_account", "Расчётный счёт"],
  ["seller_mfo", "МФО"],
];

const TEXTS: [keyof WaybillCfg, string][] = [
  ["title", "Заголовок бланка"],
  ["doc_no_prefix", "Префикс номера (напр. «ГП-»)"],
  ["sign_left", "Подпись слева"],
  ["sign_right", "Подпись справа"],
  ["copy1_label", "Подпись верхней копии"],
  ["copy2_label", "Подпись нижней копии"],
];

export default function PrintFormEditor({ editable }: { editable: boolean }) {
  const [cfg, setCfg] = useState<WaybillCfg | null>(null);
  const [doc, setDoc] = useState<WaybillDoc | null>(null);
  const [sample, setSample] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get("/print-forms/ttn/preview")
      .then((r) => { setCfg(r.data.config); setDoc(r.data.doc); setSample(!!r.data.sample); })
      .catch((e) => setErr(apiError(e)));
  }, []);

  const set = (k: keyof WaybillCfg, v: any) => {
    setCfg((c) => (c ? { ...c, [k]: v } : c));
    setDirty(true); setMsg("");
  };

  const save = async () => {
    if (!cfg) return;
    setSaving(true); setErr(""); setMsg("");
    try {
      const { data } = await api.put("/print-forms/ttn", { config: cfg });
      setCfg(data.config); setDirty(false); setMsg("Форма сохранена");
    } catch (e) { setErr(apiError(e)); } finally { setSaving(false); }
  };

  /** Логотип кладём в конфиг как data-URI: отдельного файлового хранилища нет,
   *  а бланк должен печататься и без обращения к серверу за картинкой. */
  const pickLogo = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 300_000) { setErr("Логотип больше 300 КБ — уменьшите файл"); return; }
    const rd = new FileReader();
    rd.onload = () => { set("logo", String(rd.result)); set("show_logo", true); };
    rd.readAsDataURL(f);
  };

  if (err && !cfg) return <Card><div className="text-rose-300 text-sm">{err}</div></Card>;
  if (!cfg || !doc) return <Spinner />;

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h3 className="font-semibold text-ink">Печатные формы — накладная (ТТН)</h3>
        <span className="text-xs text-slate-500">
          Печатается из «Склад и производство → Продажа ГП» кнопкой 🖨 у строки
        </span>
        {editable && (
          <button className="btn-primary ml-auto !py-1.5" onClick={save} disabled={saving || !dirty}>
            {saving ? "Сохраняем…" : dirty ? "Сохранить форму" : "Сохранено"}
          </button>
        )}
      </div>
      {msg && <div className="mb-3 rounded-xl bg-emerald-500/12 border border-emerald-500/25 text-emerald-300 text-sm px-3.5 py-2">{msg}</div>}
      {err && <div className="mb-3 rounded-xl bg-rose-500/12 border border-rose-500/25 text-rose-300 text-sm px-3.5 py-2">{err}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] gap-5">
        <div className={editable ? "" : "opacity-60 pointer-events-none"}>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Копий на листе</div>
          <div className="flex gap-2 mb-1">
            {[2, 1].map((n) => (
              <button key={n} onClick={() => set("copies_per_page", n)}
                className={`chip flex-1 justify-center py-2 border ${
                  Number(cfg.copies_per_page) === n
                    ? "bg-accent/15 text-accent-soft border-accent/25"
                    : "bg-veil/5 text-slate-400 border-line"}`}>
                {n === 2 ? "Две — лист режется пополам" : "Одна на лист"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer mb-1.5">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={!!cfg.show_copy_labels}
              onChange={(e) => set("show_copy_labels", e.target.checked)} />
            Подписывать копии («получателя» / «отправителя»)
          </label>
          <p className="text-xs text-slate-500 mb-5">
            Если две копии не влезают на лист — уменьшите шрифт ниже или отключите
            лишние строки. В предпросмотре справа лист показан в натуральных
            пропорциях A4.
          </p>

          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Что показывать</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-x-4 gap-y-1.5 mb-5">
            {TOGGLES.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-accent"
                  checked={!!cfg[k]} onChange={(e) => set(k, e.target.checked)} />
                {label}
              </label>
            ))}
          </div>

          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Реквизиты поставщика</div>
          <div className="space-y-2 mb-5">
            {SELLER.map(([k, label]) => (
              <div key={k}>
                <label className="label">{label}</label>
                <input className="input !py-2" value={String(cfg[k] ?? "")}
                  onChange={(e) => set(k, e.target.value)} />
              </div>
            ))}
          </div>

          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Тексты</div>
          <div className="space-y-2 mb-5">
            {TEXTS.map(([k, label]) => (
              <div key={k}>
                <label className="label">{label}</label>
                <input className="input !py-2" value={String(cfg[k] ?? "")}
                  onChange={(e) => set(k, e.target.value)} />
              </div>
            ))}
            <div>
              <label className="label">Примечание под таблицей</label>
              <textarea className="input !py-2" rows={2} value={cfg.note}
                onChange={(e) => set("note", e.target.value)} />
            </div>
            <div>
              <label className="label">Нижняя сноска</label>
              <textarea className="input !py-2" rows={2} value={cfg.footer}
                onChange={(e) => set("footer", e.target.value)} />
            </div>
            <div>
              <label className="label">Размер шрифта: {cfg.font_size} pt</label>
              <input type="range" min={9} max={16} step={0.5} className="w-full accent-accent"
                value={cfg.font_size} onChange={(e) => set("font_size", Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Логотип (PNG/JPG, до 300 КБ)</label>
              <div className="flex items-center gap-2">
                <input type="file" accept="image/*" className="text-xs text-slate-400 flex-1 min-w-0"
                  onChange={(e) => pickLogo(e.target.files?.[0])} />
                {cfg.logo && (
                  <button className="text-xs text-slate-500 hover:text-rose-300 whitespace-nowrap"
                    onClick={() => { set("logo", ""); set("show_logo", false); }}>✕ убрать</button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Предпросмотр</span>
            <span className="text-xs text-slate-500">
              {sample ? "выдуманная строка — продаж ещё нет" : "по последней продаже"}
            </span>
          </div>
          <Sheet><WaybillPage cfg={cfg} doc={doc} /></Sheet>
        </div>
      </div>
    </Card>
  );
}
