/**
 * Печать ТТН (товарно-транспортной накладной).
 *
 * Печатаем средствами браузера, без скачивания файла и без генератора PDF:
 * документ рисуется этим компонентом, портируется в #print-root, а правило
 * `@media print` прячет всё приложение и оставляет на бумаге только бланк.
 *
 * Бланк намеренно свёрстан ЧЁРНЫМ ПО БЕЛОМУ и не использует переменные темы:
 * на принтере тёмная тема даёт залитый чёрным лист.
 */
import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmtMoney } from "./format";

export interface WaybillCfg {
  title: string;
  doc_no_prefix: string;
  seller_name: string;
  seller_inn: string;
  seller_vat_code: string;
  seller_address: string;
  seller_phone: string;
  seller_bank: string;
  seller_account: string;
  seller_mfo: string;
  logo: string;
  show_logo: boolean;
  show_seller_req: boolean;
  show_buyer_req: boolean;
  show_division: boolean;
  show_vehicle: boolean;
  show_driver_line: boolean;
  show_proxy_line: boolean;
  show_payment_type: boolean;
  show_unit_price_net: boolean;
  show_vat_row: boolean;
  show_total_words: boolean;
  show_tiyin: boolean;
  show_stamp: boolean;
  show_footer_note: boolean;
  copies_per_page: number;
  show_copy_labels: boolean;
  copy1_label: string;
  copy2_label: string;
  sign_left: string;
  sign_right: string;
  note: string;
  footer: string;
  font_size: number;
}

export interface WaybillDoc {
  doc_no: string;
  doc_date: string;
  buyer: { name: string; inn: string; phone: string };
  division: string;
  vehicle_no: string;
  payment_type: string;
  vat: boolean;
  vat_rate: number;
  line: {
    name: string; code: string; unit: string; qty: number;
    price: number; price_net: number; net: number; vat: number; gross: number;
  };
  total: { net: number; vat: number; gross: number };
  total_words: string;
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «04 августа 2026 г.» — в бланках дату пишут словом, а не 04.08.2026. */
export function docDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()} г.`;
}

/** Пустая линия для заполнения от руки. */
const Blank = ({ w = "12rem" }: { w?: string }) => (
  <span style={{ display: "inline-block", width: w, borderBottom: "1px solid #000" }} />
);

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.15rem" }}>
    <span style={{ color: "#333", whiteSpace: "nowrap" }}>{label}</span>
    <span style={{ flex: 1, fontWeight: 600 }}>{children}</span>
  </div>
);

/**
 * A4 целиком: одна копия или ДВЕ с линией отреза посередине.
 *
 * Две копии — обычный порядок отгрузки: лист режут пополам, половина уезжает
 * с грузом, половина остаётся у отправителя. Печатать один и тот же документ
 * дважды и вручную резать — то же самое, только два листа вместо одного.
 */
export function WaybillPage({ cfg, doc }: { cfg: WaybillCfg; doc: WaybillDoc }) {
  const two = Number(cfg.copies_per_page) >= 2;
  if (!two) return <Waybill cfg={cfg} doc={doc} />;
  const label = (t: string) =>
    cfg.show_copy_labels && t ? (
      <div style={{
        textAlign: "right", fontSize: "0.72em", color: "#555",
        fontFamily: "'Times New Roman', Georgia, serif", marginBottom: "2px",
      }}>{t}</div>
    ) : null;
  return (
    <div>
      <div>{label(cfg.copy1_label)}<Waybill cfg={cfg} doc={doc} compact /></div>
      {/* линия отреза: по ней лист разрезают пополам */}
      <div style={{
        borderTop: "1px dashed #999", margin: "6mm 0 5mm", position: "relative",
        fontSize: "8pt", color: "#888", textAlign: "center",
        fontFamily: "'Times New Roman', Georgia, serif",
      }}>
        <span style={{ background: "#fff", padding: "0 8px", position: "relative", top: "-0.7em" }}>
          ✂ линия отреза
        </span>
      </div>
      <div>{label(cfg.copy2_label)}<Waybill cfg={cfg} doc={doc} compact /></div>
    </div>
  );
}

/** Сам бланк. Ширина/поля задаются @page, здесь только содержимое.
 *  `compact` — вариант для двух копий на листе: те же данные, но плотнее. */
export function Waybill({ cfg, doc, compact = false }: {
  cfg: WaybillCfg; doc: WaybillDoc; compact?: boolean;
}) {
  const L = doc.line;
  const withVat = cfg.show_vat_row && doc.vat;
  // на двух копиях каждый миллиметр на счету — режем отступы, а не данные
  const gapTitle = compact ? "0.5rem" : "0.9rem";
  const gapBlock = compact ? "0.3rem" : "0.5rem";
  const gapSign = compact ? "0.9rem" : "1.6rem";
  const tablePad = compact ? "2px 5px" : "4px 6px";
  const cell: React.CSSProperties = { border: "1px solid #000", padding: tablePad };
  const th: React.CSSProperties = { ...cell, background: "#f1f1f1", fontWeight: 600, textAlign: "center" };
  const numCell: React.CSSProperties = { ...cell, textAlign: "right", whiteSpace: "nowrap" };

  return (
    <div style={{
      color: "#000", background: "#fff", fontSize: `${cfg.font_size}pt`,
      fontFamily: "'Times New Roman', Georgia, serif", lineHeight: 1.35,
    }}>
      {cfg.show_logo && cfg.logo && (
        <img src={cfg.logo} alt="" style={{ maxHeight: "56px", marginBottom: "6px" }} />
      )}

      <div style={{ textAlign: "center", marginBottom: gapTitle }}>
        <div style={{ fontSize: "1.15em", fontWeight: 700, letterSpacing: "0.02em" }}>
          {cfg.title} № {doc.doc_no}
        </div>
        <div style={{ marginTop: "0.15rem" }}>от {docDate(doc.doc_date)}</div>
      </div>

      {cfg.show_seller_req && (
        <div style={{ marginBottom: gapBlock }}>
          <Row label="Поставщик:">{cfg.seller_name}</Row>
          {(cfg.seller_inn || cfg.seller_vat_code) && (
            <div style={{ color: "#333" }}>
              {cfg.seller_inn && <>ИНН {cfg.seller_inn}</>}
              {cfg.seller_inn && cfg.seller_vat_code && " · "}
              {cfg.seller_vat_code && <>Рег. код НДС {cfg.seller_vat_code}</>}
            </div>
          )}
          {(cfg.seller_address || cfg.seller_phone) && (
            <div style={{ color: "#333" }}>
              {cfg.seller_address}
              {cfg.seller_address && cfg.seller_phone && " · "}
              {cfg.seller_phone && <>тел. {cfg.seller_phone}</>}
            </div>
          )}
          {(cfg.seller_bank || cfg.seller_account || cfg.seller_mfo) && (
            <div style={{ color: "#333" }}>
              {cfg.seller_bank}
              {cfg.seller_account && <> · р/с {cfg.seller_account}</>}
              {cfg.seller_mfo && <> · МФО {cfg.seller_mfo}</>}
            </div>
          )}
        </div>
      )}

      {cfg.show_buyer_req && (
        <div style={{ marginBottom: gapBlock }}>
          <Row label="Покупатель:">{doc.buyer.name || <Blank w="18rem" />}</Row>
          {(doc.buyer.inn || doc.buyer.phone) && (
            <div style={{ color: "#333" }}>
              {doc.buyer.inn && <>ИНН {doc.buyer.inn}</>}
              {doc.buyer.inn && doc.buyer.phone && " · "}
              {doc.buyer.phone && <>тел. {doc.buyer.phone}</>}
            </div>
          )}
        </div>
      )}

      {cfg.show_division && doc.division && <Row label="Объект отгрузки:">{doc.division}</Row>}
      {cfg.show_payment_type && doc.payment_type && <Row label="Вид оплаты:">{doc.payment_type}</Row>}

      {(cfg.show_vehicle || cfg.show_driver_line) && (
        <div style={{ display: "flex", gap: "1.5rem", marginBottom: "0.15rem", flexWrap: "wrap" }}>
          {cfg.show_vehicle && (
            <span><span style={{ color: "#333" }}>Автомобиль: </span>
              {/* моноширинный и с разрядкой — номер на бланке должны
                  прочитать с первого раза, а не разбирать «01123ABC» */}
              <b style={{ fontFamily: "'Courier New', monospace", letterSpacing: "0.06em" }}>
                {doc.vehicle_no || <Blank w="8rem" />}
              </b></span>
          )}
          {cfg.show_driver_line && (
            <span><span style={{ color: "#333" }}>Водитель: </span><Blank w="12rem" /></span>
          )}
        </div>
      )}
      {cfg.show_proxy_line && (
        <div style={{ marginBottom: "0.15rem", color: "#333" }}>
          Доверенность № <Blank w="6rem" /> от <Blank w="7rem" /> выдана <Blank w="12rem" />
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse",
        margin: compact ? "0.45rem 0 0.35rem" : "0.8rem 0 0.5rem" }}>
        <thead>
          <tr>
            <th style={{ ...th, width: "2.2rem" }}>№</th>
            <th style={th}>Наименование товара</th>
            <th style={{ ...th, width: "4rem" }}>Код</th>
            <th style={{ ...th, width: "3.6rem" }}>Ед.</th>
            <th style={{ ...th, width: "5rem" }}>Кол-во</th>
            {cfg.show_unit_price_net && <th style={{ ...th, width: "7rem" }}>Цена без НДС</th>}
            <th style={{ ...th, width: "7rem" }}>Цена</th>
            {/* по строке, а не за единицу — иначе колонку читают как цену */}
            {withVat && <th style={{ ...th, width: "7rem" }}>в т.ч. НДС</th>}
            <th style={{ ...th, width: "8rem" }}>Сумма</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...cell, textAlign: "center" }}>1</td>
            <td style={cell}>{L.name}</td>
            <td style={{ ...cell, textAlign: "center" }}>{L.code || "—"}</td>
            <td style={{ ...cell, textAlign: "center" }}>{L.unit || "—"}</td>
            <td style={numCell}>{fmtMoney(L.qty)}</td>
            {cfg.show_unit_price_net && <td style={numCell}>{fmtMoney(L.price_net)}</td>}
            <td style={numCell}>{fmtMoney(L.price)}</td>
            {withVat && <td style={numCell}>{fmtMoney(L.vat)}</td>}
            <td style={{ ...numCell, fontWeight: 700 }}>{fmtMoney(L.gross)}</td>
          </tr>
        </tbody>
      </table>

      <table style={{ marginLeft: "auto", borderCollapse: "collapse" }}>
        <tbody>
          {withVat && (
            <>
              <tr>
                <td style={{ padding: "1px 10px 1px 0", color: "#333" }}>Итого без НДС</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtMoney(doc.total.net)}</td>
              </tr>
              <tr>
                <td style={{ padding: "1px 10px 1px 0", color: "#333" }}>
                  НДС {Math.round(doc.vat_rate * 100)}%
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtMoney(doc.total.vat)}</td>
              </tr>
            </>
          )}
          <tr style={{ fontWeight: 700 }}>
            <td style={{ padding: "2px 10px 2px 0" }}>Всего к оплате</td>
            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtMoney(doc.total.gross)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: "0.5rem" }}>
        Всего отпущено <b>1</b> наименование на сумму <b>{fmtMoney(doc.total.gross)}</b> сум
      </div>
      {cfg.show_total_words && (
        <div style={{ marginTop: "0.2rem" }}>
          Сумма прописью: <b>{doc.total_words}</b>
        </div>
      )}

      {cfg.note && <div style={{ marginTop: "0.6rem", color: "#333" }}>{cfg.note}</div>}

      <div style={{ display: "flex", gap: "2rem", marginTop: gapSign, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "13rem" }}>
          <div>{cfg.sign_left} <Blank w="9rem" /></div>
          <div style={{ fontSize: "0.75em", color: "#555", marginTop: "2px" }}>
            подпись / расшифровка
          </div>
          {cfg.show_stamp && (
            <div style={{ marginTop: compact ? "0.6rem" : "1.1rem", color: "#555" }}>М.П.</div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: "13rem" }}>
          <div>{cfg.sign_right} <Blank w="9rem" /></div>
          <div style={{ fontSize: "0.75em", color: "#555", marginTop: "2px" }}>
            подпись / расшифровка
          </div>
        </div>
      </div>

      {cfg.show_footer_note && cfg.footer && (
        <div style={{ marginTop: "1.2rem", fontSize: "0.8em", color: "#555",
          borderTop: "1px solid #ccc", paddingTop: "0.4rem" }}>
          {cfg.footer}
        </div>
      )}
    </div>
  );
}

/**
 * Кладёт содержимое в #print-root — узел-брат #root, который виден ТОЛЬКО при
 * печати. Так на бумагу уходит один бланк, а не весь интерфейс вокруг него.
 */
export function PrintPortal({ children }: { children: ReactNode }) {
  const [node] = useState(() => {
    let el = document.getElementById("print-root");
    if (!el) {
      el = document.createElement("div");
      el.id = "print-root";
      document.body.appendChild(el);
    }
    return el;
  });
  return createPortal(children, node);
}

/** Печать. Ждём кадр, чтобы портал успел отрисоваться до диалога печати. */
export function printNow() {
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

/**
 * Лист A4 для предпросмотра — в НАСТОЯЩИХ пропорциях страницы (210×297 мм
 * минус поля @page). Иначе не видно главного: влезают ли две копии на лист.
 * Если содержимое длиннее — белое поле растянется, и это сразу заметно.
 */
export function Sheet({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo(0, 0); }, []);
  return (
    <div ref={ref} className="overflow-auto rounded-xl border border-line bg-slate-200/60 p-3 sm:p-5">
      <div className="mx-auto bg-white shadow-lg"
        style={{ width: "210mm", maxWidth: "100%", padding: "12mm", minHeight: "297mm" }}>
        {children}
      </div>
    </div>
  );
}
