import { useApi } from "./useApi";

/**
 * Курс на дату начала учёта — по нему пересчитываются ВХОДЯЩИЕ остатки.
 *
 * Берём последний курс не позже «Даты начала учёта»; если таких нет — самый
 * ранний из введённых (иначе автопересчёт молча дал бы ноль).
 */
export function useOpeningRate() {
  const { data: settings } = useApi<{ key: string; value: string }[]>("/settings");
  const { data: rates } = useApi<{ rate_date: string; rate: number }[]>("/exchange");
  const date0 = settings?.find((s) => s.key === "period_start")?.value || "";
  if (!rates?.length) return { rate: 0, date: date0 };
  const earlier = rates.filter((r) => !date0 || r.rate_date <= date0);
  const pick = earlier.length
    ? earlier.reduce((a, b) => (a.rate_date > b.rate_date ? a : b))
    : rates.reduce((a, b) => (a.rate_date < b.rate_date ? a : b));
  return { rate: Number(pick.rate || 0), date: pick.rate_date };
}

export const toUsd = (uzs: any, rate: number) =>
  rate ? Math.round((Number(uzs || 0) / rate) * 100) / 100 : 0;
export const toUzs = (usd: any, rate: number) =>
  rate ? Math.round(Number(usd || 0) * rate * 100) / 100 : 0;
