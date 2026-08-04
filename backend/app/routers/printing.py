"""Печатные формы: ТТН на продажу ГП.

Идея разделения: СЕРВЕР отдаёт данные документа (реквизиты, суммы, сумма
прописью) и настройки бланка, а рисует его фронтенд и печатает средствами
браузера. Так печать не требует ни скачивания файла, ни генератора PDF на
сервере, а «своя форма» настраивается галочками, а не правкой кода.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import settings as app_settings
from ..database import get_db
from ..events import record
from ..money import require_money
from ..models import PrintForm, Sale, User
from ..numwords import money_words
from ..rates import get_rates
from ..security import get_current_user, require

router = APIRouter(prefix="/api/print-forms", tags=["printing"])

TTN = "ttn"

# Значения по умолчанию = полный список того, что умеет конструктор.
# Ключи, которых нет в сохранённом конфиге, берутся отсюда, поэтому новая
# галочка появляется у всех сразу и ничего не ломает.
DEFAULTS: dict[str, dict] = {
    TTN: {
        "title": "ТОВАРНО-ТРАНСПОРТНАЯ НАКЛАДНАЯ",
        "doc_no_prefix": "",
        # реквизиты поставщика — своих в базе нет, задаются здесь
        "seller_name": app_settings.company_name,
        "seller_inn": "",
        "seller_vat_code": "",
        "seller_address": "",
        "seller_phone": "",
        "seller_bank": "",
        "seller_account": "",
        "seller_mfo": "",
        "logo": "",
        # что показывать на бланке
        "show_logo": False,
        "show_seller_req": True,
        "show_buyer_req": True,
        "show_division": True,
        "show_vehicle": True,
        "show_driver_line": True,
        "show_proxy_line": True,
        "show_payment_type": False,
        "show_unit_price_net": False,
        "show_vat_row": True,
        "show_total_words": True,
        "show_tiyin": True,
        "show_stamp": True,
        "show_footer_note": False,
        # ДВА экземпляра на одном листе: лист разрезают пополам — половина
        # покупателю, половина остаётся у продавца. Это обычный порядок
        # отгрузки, поэтому по умолчанию так, а не одна копия на лист.
        "copies_per_page": 2,
        "show_copy_labels": True,
        "copy1_label": "Экземпляр получателя",
        "copy2_label": "Экземпляр отправителя",
        # тексты
        "sign_left": "Отпустил",
        "sign_right": "Принял",
        "note": "",
        "footer": "",
        # 10 pt, потому что по умолчанию на лист идут ДВЕ копии
        "font_size": 10,
    }
}


def merged(key: str, saved: dict | None) -> dict:
    return {**DEFAULTS[key], **(saved or {})}


def _known(key: str) -> None:
    if key not in DEFAULTS:
        raise HTTPException(404, detail=f"Печатная форма «{key}» не описана")


@router.get("/{key}")
async def get_form(
    key: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Настройки бланка. Читать может любой — без них нечего печатать."""
    _known(key)
    row = await db.get(PrintForm, key)
    return {"key": key, "config": merged(key, row.config if row else None),
            "defaults": DEFAULTS[key]}


@router.put("/{key}")
async def save_form(
    key: str,
    body: dict,
    current: User = Depends(require("settings:edit")),
    db: AsyncSession = Depends(get_db),
):
    """Сохранить настройки. Чужие ключи отбрасываем — конфиг не свалка."""
    _known(key)
    incoming = body.get("config") if isinstance(body.get("config"), dict) else body
    clean = {k: v for k, v in (incoming or {}).items() if k in DEFAULTS[key]}
    row = await db.get(PrintForm, key)
    if row is None:
        row = PrintForm(key=key, config=clean)
        db.add(row)
    else:
        row.config = {**(row.config or {}), **clean}
    await db.commit()
    await record(db, current, "edit", "print_form", key)
    row = await db.get(PrintForm, key)
    return {"key": key, "config": merged(key, row.config)}


async def _ttn_payload(db: AsyncSession, sale: Sale, cfg: dict) -> dict:
    """Данные одной строки продажи в виде готового документа."""
    nds = (await get_rates(db))["nds_rate"]
    qty = float(sale.qty or 0)
    price = float(sale.price_uzs or 0)
    gross = round(qty * price, 2)
    net = float(sale.revenue_net or 0)
    vat = float(sale.vat_amount or 0)
    p, o = sale.product, sale.organization
    return {
        "doc_no": f"{cfg['doc_no_prefix']}{sale.id}",
        "doc_date": sale.doc_date.isoformat(),
        "buyer": {"name": o.name if o else "", "inn": o.inn if o else "",
                  "phone": o.phone if o else ""},
        "division": sale.division or "",
        "vehicle_no": sale.vehicle_no or "",
        "payment_type": sale.payment_type or "",
        "vat": bool(sale.vat),
        "vat_rate": nds,
        "line": {
            "name": p.name if p else "",
            "code": p.code if p else "",
            "unit": p.unit if p else "",
            "qty": qty,
            # цена в реестре — из счёта (с НДС внутри, если продажа облагается);
            # для графы «без НДС» её надо очистить, а не пересчитывать заново
            "price": price,
            "price_net": round(net / qty, 2) if qty else 0.0,
            "net": net,
            "vat": vat,
            "gross": gross,
        },
        "total": {"net": net, "vat": vat, "gross": gross},
        "total_words": money_words(gross, tiyin=bool(cfg["show_tiyin"])),
    }


@router.get("/ttn/sale/{sale_id}")
async def ttn_for_sale(
    sale_id: int,
    current: User = Depends(require("sales:view")),
    db: AsyncSession = Depends(get_db),
):
    """Накладная по ОДНОЙ строке продажи — как её печатают из реестра."""
    # в бланке есть цена и сумма прописью — без права «Суммы» его не выдаём
    require_money(current, "накладную")
    sale = await db.scalar(
        select(Sale)
        .options(selectinload(Sale.product), selectinload(Sale.organization))
        .where(Sale.id == sale_id)
    )
    if not sale:
        raise HTTPException(404, detail="Продажа не найдена")
    if current.organization_id and not current.is_superadmin \
            and sale.organization_id != current.organization_id:
        raise HTTPException(403, detail="Нет доступа к этой продаже")
    row = await db.get(PrintForm, TTN)
    cfg = merged(TTN, row.config if row else None)
    return {"config": cfg, "doc": await _ttn_payload(db, sale, cfg)}


@router.get("/ttn/preview")
async def ttn_preview(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Образец для настройки бланка: последняя продажа, а если продаж нет —
    выдуманная строка. Иначе настраивать форму было бы не на чем."""
    row = await db.get(PrintForm, TTN)
    cfg = merged(TTN, row.config if row else None)
    sale = await db.scalar(
        select(Sale)
        .options(selectinload(Sale.product), selectinload(Sale.organization))
        .order_by(Sale.doc_date.desc(), Sale.id.desc())
        .limit(1)
    )
    if sale:
        return {"config": cfg, "doc": await _ttn_payload(db, sale, cfg), "sample": False}
    nds = (await get_rates(db))["nds_rate"]
    gross = 112_000.0
    net = round(gross / (1 + nds), 2)
    return {
        "config": cfg,
        "sample": True,
        "doc": {
            "doc_no": f"{cfg['doc_no_prefix']}128", "doc_date": "2026-08-04",
            "buyer": {"name": "ООО «Пример»", "inn": "301987654", "phone": "+998 90 000-00-00"},
            "division": "Махстон", "vehicle_no": "01 A 123 BC",
            "payment_type": "Перечисление", "vat": True, "vat_rate": nds,
            "line": {"name": "Фракция 5-20", "code": "P1", "unit": "м3", "qty": 50,
                     "price": 2240, "price_net": round(net / 50, 2), "net": net,
                     "vat": round(gross - net, 2), "gross": gross},
            "total": {"net": net, "vat": round(gross - net, 2), "gross": gross},
            "total_words": money_words(gross, tiyin=bool(cfg["show_tiyin"])),
        },
    }
