import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { connectRealtime, RealtimeEvent } from "../api/ws";

interface Toast {
  id: number;
  title: string;
  body: string;
  tone: string;
}

interface RealtimeCtx {
  connected: boolean;
  version: number; // bumps on every data event -> use as refetch dep
  lastEvent: RealtimeEvent | null;
}

const Ctx = createContext<RealtimeCtx>({ connected: false, version: 0, lastEvent: null });

const ENTITY_LABEL: Record<string, string> = {
  transaction: "Операция",
  organization: "Организация",
  product: "Продукция",
  material: "Материал",
  user: "Пользователь",
  role: "Роль",
  exchange: "Курс",
  tax: "Налог",
  loan: "Займ",
};
const ACTION_LABEL: Record<string, string> = {
  create: "создан(а)",
  edit: "изменён(а)",
  delete: "удалён(а)",
};
const ACTION_TONE: Record<string, string> = {
  create: "emerald",
  edit: "accent",
  delete: "rose",
};

let toastId = 0;

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState(0);
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mounted = useRef(false);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { ...t, id }].slice(-4));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500);
  }, []);

  useEffect(() => {
    // avoid double-connect in StrictMode dev
    if (mounted.current) return;
    mounted.current = true;

    const disconnect = connectRealtime((e) => {
      if (e.event === "connected") {
        setConnected(true);
        return;
      }
      setLastEvent(e);
      setVersion((v) => v + 1);
      const [entity, action] = e.event.split(".");
      if (ENTITY_LABEL[entity]) {
        pushToast({
          title: `${ENTITY_LABEL[entity]} ${ACTION_LABEL[action] || action}`,
          body: `${e.payload?.detail || ""} · ${e.payload?.by || ""}`,
          tone: ACTION_TONE[action] || "accent",
        });
      }
    });
    return () => {
      disconnect();
      setConnected(false);
    };
  }, [pushToast]);

  return (
    <Ctx.Provider value={{ connected, version, lastEvent }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2.5 w-80">
        {toasts.map((t) => (
          <div key={t.id} className="glass p-3.5 animate-fade-in flex gap-3 items-start">
            <span
              className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                t.tone === "emerald" ? "bg-emerald2" : t.tone === "rose" ? "bg-rose2" : "bg-accent"
              }`}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink">{t.title}</div>
              <div className="text-xs text-slate-400 truncate">{t.body}</div>
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useRealtime = () => useContext(Ctx);
