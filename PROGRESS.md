# PROFIT DIVIDER — Qurilish holati (checkpoint)

> Manba (asosiy, source of truth): **`Баланс Август отчёт 2025-PROFIT DIVIDER.xlsx`** (48 varaq).
> HTML namuna (`PROFIT_DIVIDER_Web korgazma.html`) — yordamchi, unda xato bo'lishi mumkin.
> Dizayn: **dark premium** (tasdiqlangan). Ma'lumot: **barcha kataloglar 0 balans bilan yuklangan**.

## Ishga tushirish
```bash
docker compose up -d          # yoki --build
docker compose down -v        # toza qayta yaratish (0-holat)
```
- Frontend: http://localhost:3000  · LAN: http://192.168.68.200:3000 (firewall 3000 port)
- API/Swagger: http://localhost:8000/docs
- PostgreSQL: localhost:**5434** (finasist/finasist)
- Super-admin: **admin@profitdivider.uz** / **Admin12345!**
- Excel struktura dumpi: `scratchpad/struct.txt` · Kataloglar JSON: `backend/app/seed_data.json`

---

## ✅ TAYYOR va TESTLANGAN

### Poydevor
- Auth (JWT) · RBAC (granular ruxsatlar, super-admin, default ruxsatsiz) · WebSocket real-time · Docker (db+backend+frontend) · PostgreSQL
- Bug tuzatildi: tashkilot/foydalanuvchi o'chirishda FK himoyasi
- Qoida: so'mли operatsiya sanasiga **kurs kiritilmagan bo'lsa bloklaydi**

### ЭТАП 1 — Ma'lumotnomalar + Bank/Kassa + Cash Flow
- Kataloglar yuklandi: **88 tashkilot, 95 xarajat kodi, 121 CF kodi, 7 bo'linma, 3 mahsulot, 3 xomashyo, 4 soliq turi**
- Bank/Kassa registri: xarajat kodi / CF kodi / bo'linma **tanlash** bilan
- Operatsiya → kontragent balansiga posting (USD + UZS)
- Cash Flow (ДДС) hisoboti + xarajatlar kodlar bo'yicha
- Sahifalar: `Transactions`, `Directories` (Справочники)

### ЭТАП 3-4-5 — Ishlab chiqarish zanjiri (18/18 test o'tgan)
- Xomashyo **Приход** (moving-average o'rtacha tannarx) / **Расход** (o'rtacha bo'yicha)
- **Производство ГП** (себестоимость bilan) / **Продажа ГП** (НДС 12% + COGS + foyda)
- Har o'zgarishda ombor+tannarx **to'liq qayta hisoblanadi** (buglarsiz)
- Hisobotlar: **ОФР (Форма №2)**, **Баланс (Форма №1)**, **Дт-Кт vedomost**, Cash Flow, Расходы, Склад сырья, Склад ГП
- Sahifalar: `Inventory` (4 tab), `Reports` (7 tab)
- Backend: `routers/inventory.py`, `routers/reports.py`; frontend `pages/Inventory.tsx`, `pages/Reports.tsx`

---

## ✅ ЭТАП 6 — Зарплата (TAYYOR, 10/10 test)
- Backend `routers/payroll.py` + models `Employee`/`PayrollEntry`; hisob: gross (proporsional) → **НДФЛ 12%**, ИНПС 0%, **ЕСП 12%**, net, qarz
- Frontend `pages/Payroll.tsx` (2 tab: Расчёт зарплаты + Сотрудники), nav "Персонал" guruhi, route qo'shildi
- Ruxsat: `payroll` moduli (Бухгалтер roliga qo'shilgan)

## ✅ ЭТАП 2 qoldig'i — Soliqlar + Zayom (TAYYOR)
- **Налоги**: create/edit/delete, `debt_end = debt_start + accrued − paid` avto (`Taxes.tsx`, misc.py)
- **Займы**: create/edit/delete (`Loans.tsx`, misc.py)

---

## ✅ ЭТАП 7 — Услуги + Kunlik qoldiqlar (TAYYOR)
- **Услуги** (Полученные/Оказанные): `routers/services.py`, `pages/Services.tsx`, nav "Услуги" — НДС ajratish bilan
- **Kunlik qoldiqlar**: `/reports/daily-balance` + Reports'da "Остатки по дням" tab
- Ruxsat: `services` moduli

## 🔎 EXCEL BILAN VALIDATSIYA (1:1)
Excel'ning haqiqiy avgust raqamlari bilan tekshirildi:
- **ОФР formulasi 1:1 to'g'ri**: Валовая = Выручка − Себестоимость (Excel 2,502,535,956.11), Чистая = Валовая − Расходы периода (Excel 2,261,539,096.11), Расходы периода = 941+942+943 (Excel стр.040 = 240,996,860)
- **BUG TUZATILDI**: `_period` filtri `Transaction.doc_date`ga bog'langani uchun Sale so'rovida dekарт ko'paytma berib, выручкани ×N qilardi → endi `Sale.doc_date` bilan (reports.py `_period(..., col)`)
- **Налог на прибыль = 0** qilindi (Excel'da 0, auto-15% olib tashlandi; endi «Налоги» modulidan «прибыль» olinadi)
- Moving-avg tannarx, COGS, НДС — Excel metodikasiga mos

**Hali 1:1 EMAS (format/detal):** Баланс — to'liq Форма №1 (≈40 qator kodi, СЕЙФ/холдинг/авансы alohida Дт-Кт'dan) o'rniga soddalashtirilgan; ОФР bo'linmalar kesimida emas (umumiy). Bular «ledger type» + per-division talab qiladi.

## 🔜 QOLGAN (ixtiyoriy / kichik)
- **Курсовая разница** (valyuta qayta baholash) — kurs o'zgarganda Дт-Кт/pul/zayom bo'yicha farq. Murakkab; bu Excel'da ko'pincha 0 (kurs=1). Keyinroq.
- ОФР **bo'linmalar bo'yicha** (Махстон/Турк/Жби filtri)
- Дт-Кт alohida turlari (СЕЙФ/услуги/З.п/РБП) — hozir bitta umumiy vedomost
- Bank hisoblari (счета) bo'yicha ajratish, ochilish qoldiqlari

### Eski eslatma (bajarilgan)
- **ОСТАТОК UZS/USD**: har kunlik pul qoldig'i (bank hisoblari + kassa) — БАНК/КАССА registridan hisoblab kunlik jadval.
- **Курсовая разница**: valyuta qayta baholash (Дт-Кт, pul, zayomlar bo'yicha) — kurs o'zgarganda.
- **Полученные/Оказанные УСЛУГИ**: xizmatlar registri (ИНН, xizmat turi, НДС, bo'linma, summa).

### Qo'shimcha (Excel'da bor, ixtiyoriy)
- ОФР **bo'linmalar bo'yicha** (Махстон/Турк/Жби alohida) — reports/pnl'ga `division` filtri
- Bank hisoblari (счета) bo'yicha ajratish; ochilish qoldiqlari (opening balances)
- Дт-Кт alohida turlari: СЕЙФ, прочие, услуги, З.п, РБП, Офис (hozir hammasi bitta counterparties hisobotida)

---

## Texnik eslatmalar
- Base valyuta: har operatsiya `amount_uzs` (so'm) va `amount_usd` saqlaydi. Inventar/ишлаб chiqarish/sotuv — **so'mда** (avg_cost UZS). Hisobotlar: ОФР/Баланс so'mда, Cash Flow/Дт-Кт USD.
- Ombor/tannarx: to'liq replay (recompute_material/recompute_product) — har create/delete'da qayta hisob.
- bcrypt `__about__` warning — zararsiz (trapped).
- Modellar: `backend/app/models.py` · Ruxsatlar: `backend/app/permissions.py` · Seed: `backend/app/seed.py`

## Keyingi qadam (davom etilganда)
1. Payroll testini tasdiqlash → `pages/Payroll.tsx` + nav + route → rebuild frontend → test
2. ЭТАП 2 qoldig'i (Налоги/Займы batafsil)
3. ЭТАП 7 (kunlik qoldiqlar / курсовая / услуги)
4. Hammasi tugagach — foydalanuvchi to'liq test qiladi
