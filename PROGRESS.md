# PROFIT DIVIDER — Qurilish holati

> Manba (source of truth): **`Баланс Август отчёт 2025-PROFIT DIVIDER.xlsx`** (48 varaq).
> HTML namuna (`PROFIT_DIVIDER_Web korgazma.html`) — yordamchi, unda xato bo'lishi mumkin.
> Dizayn: **dark premium**. Ma'lumot: **barcha kataloglar 0 balans bilan yuklangan**.

## Ishga tushirish
```bash
docker compose up -d --build      # barcha servislar
docker compose restart backend    # backend kodi o'zgarganda (manba mount qilingan)
docker compose down -v            # toza qayta yaratish (0-holat)
```
- Frontend: http://localhost:3000 · API/Swagger: http://localhost:8000/docs
- PostgreSQL: localhost:**5434** (finasist/finasist)
- Super-admin: **admin@profitdivider.uz** / **Admin12345!**

**Migratsiya**: `app/migrate.py` har startda modellarni `information_schema` bilan solishtirib,
yetishmayotgan ustunlarni `ALTER TABLE ADD COLUMN` bilan qo'shadi. Hech narsa o'chirmaydi.
**Seed idempotent**: har startda kataloglar to'ldiriladi, kiritilgan ma'lumot buzilmaydi.

---

## ✅ EXCEL VARAQLARI ↔ WEB (48/48 qamrab olingan)

| Excel varaq | Web bo'limi |
|---|---|
| INFO зарплата, INFO | `/lookups` — kategoriya, guruh, status, holat, to'lov turi |
| Зарплата, Зарплата (свод) | `/payroll` — 3 tab: hisob, obyektlar bo'yicha svod, xodimlar |
| Офис Note, Офис қоплаши керак, РБП | `/ledgers` — `office` va `rbp` vedomostlari |
| Баланс USD | Отчёты → **Баланс Ф№1** — schyot kodlari, «на начало»+«на конец», aktiv = passiv |
| ОФР USD + Махстон/Турк/Жби | Отчёты → **ОФР** (to'liq Ф№2) + **ОФР по подразделениям** |
| ВСЕГО расходы + Махстон/Турк/Жби | Отчёты → **Расходы** (БАНК/КАССА/ВСЕГО × UZS/USD) |
| Курс доллара | `/exchange` |
| ОСТАТОК UZS / USD | Отчёты → **Остатки по дням** (har hisob va kassa alohida ustun) |
| БАНК, КАССА | `/transactions` (счёт, № док, МФО, ИНН корресп., назначение) |
| CASH FLOW | Отчёты → **Cash Flow** — 3 bo'lim (операц./инвест./финанс.) + курсовая |
| Курсовая разница | Отчёты → **Курсовая разница** (5 qator) + ОФР 120/130 qatorlari |
| Дт Кт поставщ/покуп/СЕЙФ/прочие/услуги/З.п | `/ledgers` — 9 ta alohida vedomost |
| Займы | `/loans` + harakatlar + Отчёты → **Займы** |
| Налоги | `/taxes` + Отчёты → **Налоги** (avto-hisob) |
| Полученные / Оказанные УСЛУГИ | `/services` |
| Наименование ГП / сырья / запчастей | `/products`, `/materials` (232 zapchast yuklangan) |
| Продажа Расход ГП, Производства Приход ГП | `/inventory` |
| ГП оборот, Остаток ГП, С-сть ГП | Отчёты → **drobilkalar kesimida** (Махстон/Турк/Жби alohida) |
| РЕЕСТР организации | `/organizations` (118 ta, vedomost bo'yicha tasniflangan) |
| Приход сырья / запчастей, Расход, Склад оборот, Остаток | `/inventory` + Отчёты, **har obyekt alohida** |
| Черновик | qasddan tashlab ketilgan (ish varag'i) |

Bo'linmalar ro'yxati (Махстон, Турк, Жби, Офис, Сement, Помпа, Сементовоз) —
`Справочники` → **«Подразделения»**: qo'shish, nomini o'zgartirish (barcha hujjatlarda
avtomatik yangilanadi) va o'chirish (ishlatilayotgani himoyalangan).

---

## Asosiy me'moriy qarorlar

**Ochilish qoldiqlari (входящее сальдо).** Har bir obyektda hisob boshlanish sanasidagi
qoldiq saqlanadi: `Organization.opening_uzs/usd`, `Material.opening_qty/cost`,
`Product.opening_qty/cost`, `BankAccount`/`CashRegister.opening_uzs/usd`, `Loan.opening_uzs`.
Joriy qoldiq = ochilish + hujjatlar bo'yicha aylanma.

**Дт-Кт — to'liq derived (`app/ledger.py`).** Kontragent saldosi endi inkremental
yig'ilmaydi (bu tahrirlash/o'chirishda xatoga olib kelardi), balki har safar birlamchi
hujjatlardan qayta hisoblanadi: pul operatsiyalari + ТМЦ prixodi + ГП sotuvi + xizmatlar.
**Tuzatilgan bug**: xizmatlar (`/services`) umuman kontragent balansiga tushmasdi.

**Ombor — drobilkalar kesimida, to'liq replay.** Excel'dagidek qoldiq
`material × bo'linma` bo'yicha yuritiladi (`material_stocks`, `product_stocks`):
Махстон'da ШАГАЛ o'z narxida, Турк'da o'z narxida. Rasxod va COGS **o'z obyektining**
o'rtacha narxida hisoblanadi. Bo'sh obyektdan yozib bo'lmaydi — aks holda tannarx
jimgina 0 chiqardi. Har `create/update/delete`da to'liq qayta hisob.

**Kodlar tasnifi — spravochnikda.** Har xarajat kodida `pnl_group` (ОФР qaysi qatoriga
tushishi), har CF kodida `activity` (ДДС qaysi bo'limi). Ilgari bu prefiks bo'yicha
qattiq yozilgan edi; endi `Справочники` sahifasidan o'zgartiriladi.

**ОФР — to'liq Форма №2.** 010→020→030→040→090→100→120/130→220→230→240→250/260→270.
Курсовая разница 120/130 qatorlariga tushadi va sof foydani o'zgartiradi.
`Прочие доходы (090)` — `pnl_group=income` kodli kirim operatsiyalari.

**Курсовая разница — Excel metodikasi 1:1.** Hisob dollarda:
- *задолженность* — har kontragent bo'yicha alohida: `сальдо сум / курс на конец − валютная база`.
  Foyda va zarar **qatorlar bo'yicha alohida** yig'iladi (Excel'dagi `R`/`S` formulalari),
  bir kontragentdagi foyda boshqasidagi zararni yashirmaydi.
- *деньги* — kunlik qayta baholash (`ОСТАТОК UZS` B/D/F ustunlari):
  `qoldiq × (1/kurs_bugun − 1/kurs_kecha)`.
- *займы* — valyuta bazasi har harakat sanasidagi kurs bo'yicha.
  (Excel'da «Полученные займы» qatori qattiq 0 — bizda ishlaydi.)

Kurs jadvalida bo'shliq bo'lsa hisobot ogohlantiradi: davr boshidan oldingi kun uchun
kurs kiritilmagan bo'lsa yoki davr ichida kunlar tushib qolgan bo'lsa.

---

## Testlar

```bash
# scratchpad/ ichida, shu tartibda
py t_a.py       # ochilish qoldiqlari, ledger, счета/кассы — 12/12
py t_b.py       # hisobotlar Excel formatida — 8/8
py t_cd.py      # zarplata, eksport, import — 10/10
py t_fx.py      # курсовая разница o'zgaruvchan kurs bilan — 7/7
py t_forms.py   # ОФР Ф№2, ДДС bo'limlari, Баланс Ф№1 — 9/9
py t_wh.py      # ombor drobilkalar kesimida — 10/10
py t_dash.py    # dashboard UZS/USD + davr filtri — 6/6
py t_full.py    # sqvoz stsenariy: 0 dan hisobotlargacha — 20/20
py t_salary_ledger.py  # zarplata → «Дт Кт З.п» hisob-kitobi — 4/4
py t_cogs.py    # 020 = «ГП оборот» P = N×L (davr o'rtachasi) — 5/5
py t_smoke.py   # frontend ishlatadigan barcha endpointlar — 63/63
py cleanup.py   # test ma'lumotlarini bazadan tozalash
```
Har to'plam o'zidan keyin tozalaydi va o'z pul qoldiqlarini `setup_cash()` bilan
o'zi o'rnatadi — shuning uchun istalgan tartibda qayta chopish mumkin.

**020 СЕБЕСТОИМОСТЬ РЕАЛИЗАЦИИ (kitobdagi formula).** `ОФР!D19 = SUM(D20:D22)`,
har bo'linma esa `='ГП оборот'!P5`. «ГП оборот» varag'ida (8–12 qatorlar):

| Ustun | Formula | Ma'nosi |
|---|---|---|
| K | `= E + H` | boshlang'ich qoldiq + chiqarilgan, dona |
| M | `= G + J` | boshlang'ich qoldiq + chiqarilgan, so'm |
| **L** | `= M / K` | **davr o'rtacha tannarxi** |
| O, P | `= L`, `= N × O` | sotilgan — **shu 020 qatori** |
| Q, R, S | `= K − N`, `= L`, `= Q × R` | oxirgi qoldiq |

Ya'ni oyning **hamma** sotuvi **bitta** o'rtacha bilan baholanadi (sotuv sanasidagi
skolzyashiy o'rtacha bilan emas): sotuv narxi (O) va qoldiq narxi (R) — bir xil L
katakchasi. Bizda ham shunday: `/api/reports/gp-turnover` shu formulani hisoblaydi,
ОФР 020 esa undan olinadi. Farq sotuv chiqarishdan **oldin** bo'lganda ko'rinadi —
`t_cogs.py` aynan shuni tekshiradi.

**ЗАРПЛАТА ↔ БАНК/КАССА (kitobdagi mantiq).** Har obyektning zarplata «kontragenti»
bor — `Ойлик(МАХСТОН)` / `Ойлик(ТУРК)` / `Ойлик(ЖБИ)` (`ledger='salary'`, `inn` =
obyekt nomi). «Зарплата» varag'idagi **к выдаче** oy oxirgi kuni **КРЕДИТ**ga tushadi
(korxonaning ishchilarga qarzi), КАССА/БАНК'dagi to'lov esa shu kontragent bilan
belgilansa **ДЕБЕТ**ga tushadi. Farqi = qolgan qarz. Kontragentsiz kassa chiqimi
pulni kamaytiradi, lekin «Дт Кт З.п»da ko'rinmaydi — shuning uchun operatsiya
oynasida ogohlantirish va «Подставить» tugmasi qo'shildi.

Excel bilan tasdiqlangan raqamlar:
- Остаток на 01.08.2025 = **68 550 483,11** (bank 11 180 783,11 + kassa 57 369 700)
- Займы Абдулборий на конец = **101 773 000**
- ОФР formulalari: Валовая = Выручка − Себестоимость; Чистая = Валовая − Расходы периода
- Баланс Ф№1: aktiv = passiv (check = 0)

---

## 🔎 Excel'da BO'SH bo'lib chiqqan ustunlar (qasddan qilinmadi)

Auditda ma'lum bo'ldiki, «yetishmayotgan» deb hisoblangan bir necha maydon
kitobning o'zida hech qachon to'ldirilmagan — ularni ko'chirishdan ma'no yo'q:

| Excel maydoni | Holati |
|---|---|
| Зарплата — бух. va фин. ikki blok | varaqda **1 ta ФИО**, ikkala blok ham bo'sh |
| КАССА — «Код Фин оборот» | 845 qatordan **0 tasida** to'ldirilgan |
| Расход сырья — «Участок расхода», «Продукты» | **butunlay bo'sh** |
| БАНК — «Готовая продукция», «Код ГП» | 129 qator, hammasi **probel** |
| Полученные УСЛУГИ — «Скидка Бетон» | jami blok, qiymati **0** (chegirma `94115` kodi orqali yuritiladi) |

Зарплата amalda obyektlar bo'yicha jami summa bilan yuritiladi
(«Зарплата  » varag'i: Махстон 163 000 000 · Турк 155 080 000 · Жби 177 880 000) —
bu bizda **«Свод по объектам»** tabida bor.

## 🔜 Qolgan

**Основные средства moduli.** Balans qatorlari 010–022, 090 va kapital 410–430 hozir
«Настройки»dan qo'lda kiritiladi. Bu kompaniyada ОС = 0, shuning uchun forma to'liq
ishlaydi; amortizatsiya hisobi kerak bo'lsa alohida modul qurish mumkin.

**Excel import** hozir 3 tur uchun (операции / приход / продажа) — услуги va зарплата
qo'shilishi mumkin.

**Налоги varag'ining o'ng yarmi** — soliq organlari bo'yicha ИНН'li Дт-Кт vedomosti.
Kitobda ham deyarli bo'sh.

## Texnik eslatmalar
- Base valyuta: har operatsiya `amount_uzs` va `amount_usd` saqlaydi.
  Inventar/ishlab chiqarish/sotuv — so'mda; hisobotlarda UZS↔USD almashtirgich bor.
- Ruxsatlar: `app/permissions.py` · Modellar: `app/models.py` · Seed: `app/seed.py`
- Excel import/eksport: `app/routers/imports.py`, `app/routers/exports.py` (openpyxl)
- bcrypt `__about__` warning — zararsiz.
