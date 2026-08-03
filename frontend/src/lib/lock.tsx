import { createContext, ReactNode, useContext } from "react";
import { useApi } from "./useApi";

/**
 * Граница закрытого периода. Закрытый месяц — это «только чтение»:
 * данные видно полностью, но правка и удаление недоступны.
 *
 * Интерфейс обязан знать границу заранее. Иначе бухгалтер открывает форму,
 * заполняет её и упирается в отказ при сохранении — а понять, что месяц
 * закрыт, было неоткуда.
 */
interface LockState {
  lastClosed: string | null;      // «2026-06» — последний закрытый месяц
  minOpenDate: string | null;     // «2026-07-01» — раньше документ не датируешь
}

const Ctx = createContext<LockState>({ lastClosed: null, minOpenDate: null });

export function LockProvider({ children }: { children: ReactNode }) {
  const { data } = useApi<{ last_closed: string | null; min_open_date: string | null }>(
    "/periods/lock"
  );
  return (
    <Ctx.Provider
      value={{
        lastClosed: data?.last_closed ?? null,
        minOpenDate: data?.min_open_date ?? null,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

const monthOf = (d: string) => d.slice(0, 7);

export function useLock() {
  const { lastClosed, minOpenDate } = useContext(Ctx);

  /** Дата документа попадает в закрытый период? */
  const isLocked = (docDate?: string | null) =>
    !!lastClosed && !!docDate && monthOf(docDate) <= lastClosed;

  /** То же, но период задан как «ГГГГ-ММ» (так ведётся зарплата). */
  const isPeriodLocked = (period?: string | null) =>
    !!lastClosed && !!period && period <= lastClosed;

  return {
    lastClosed,
    minOpenDate,
    isLocked,
    isPeriodLocked,
    /** Есть ли вообще закрытые месяцы — для правок без даты (входящие остатки) */
    anyClosed: !!lastClosed,
    hint: lastClosed
      ? `Месяц закрыт (по ${lastClosed} включительно) — только просмотр`
      : "",
  };
}

/** Замок вместо кнопок правки и удаления. */
export function LockedMark({ title }: { title?: string }) {
  return (
    <span
      title={title || "Месяц закрыт — только просмотр"}
      className="inline-flex text-slate-600 cursor-help align-middle"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    </span>
  );
}

/** Полоска-предупреждение над формой, если выбранная дата в закрытом месяце. */
export function LockedNotice({ date, period }: { date?: string | null; period?: string | null }) {
  const { isLocked, isPeriodLocked, lastClosed } = useLock();
  if (!(isLocked(date) || isPeriodLocked(period))) return null;
  return (
    <div className="mb-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm px-3.5 py-2.5">
      Месяц закрыт (по {lastClosed} включительно). Сохранить документ этой датой
      нельзя — выберите дату в открытом периоде или откройте месяц в разделе
      «Закрытие месяца».
    </div>
  );
}
