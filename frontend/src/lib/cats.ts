// Типы контрагентов (как отдельные Дт-Кт ведомости в Excel)
export const ORG_CATS: { v: string; l: string; tone: string }[] = [
  { v: "supplier", l: "Поставщики/подрядчики", tone: "amber" },
  { v: "customer", l: "Покупатели/заказчики", tone: "emerald" },
  { v: "services", l: "Услуги", tone: "violet" },
  { v: "seif", l: "СЕЙФ", tone: "accent" },
  { v: "salary", l: "Зарплата (З.п)", tone: "rose" },
  { v: "holding", l: "Дочерние/холдинг", tone: "violet" },
  { v: "rbp", l: "РБП (будущие периоды)", tone: "slate" },
  { v: "office", l: "Офис", tone: "slate" },
  { v: "other", l: "Прочие", tone: "slate" },
];

export const catLabel = (v: string) => ORG_CATS.find((c) => c.v === v)?.l || "Прочие";
export const catTone = (v: string) => (ORG_CATS.find((c) => c.v === v)?.tone || "slate") as any;
