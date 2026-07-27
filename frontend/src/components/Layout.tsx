import clsx from "clsx";
import { ReactNode, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { NAV } from "../lib/nav";
import { useAuth } from "../store/auth";
import { useRealtime } from "../store/realtime";

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout, can } = useAuth();
  const { connected } = useRealtime();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    const visible = NAV.filter((n) => can(n.perm));
    const byGroup: Record<string, typeof visible> = {};
    for (const n of visible) (byGroup[n.group] ||= []).push(n);
    return byGroup;
  }, [user]);

  const initials = (user?.full_name || "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr] lg:items-start">
      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 w-[260px] bg-base-900/90 backdrop-blur-xl border-r border-line flex flex-col transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="h-16 flex items-center gap-3 px-5 border-b border-line">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-accent to-violet2 grid place-items-center font-black text-white shadow-glow">
            P
          </div>
          <div className="leading-tight">
            <div className="text-sm font-bold text-white">PROFIT DIVIDER</div>
            <div className="text-[10px] text-slate-500 tracking-wide">FINANCIAL PLATFORM</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <div className="px-3 mb-2 text-[10px] uppercase tracking-wider text-slate-600 font-semibold">
                {group}
              </div>
              <div className="space-y-1">
                {items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.to === "/"}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      clsx(
                        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                        isActive
                          ? "bg-accent/15 text-white border border-accent/25 shadow-glow"
                          : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
                      )
                    }
                  >
                    <span className="opacity-90">{n.icon}</span>
                    {n.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-line">
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-white/5">
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet2 to-accent grid place-items-center text-xs font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white truncate">{user?.full_name}</div>
              <div className="text-[11px] text-slate-500 truncate">
                {user?.is_superadmin ? "Супер-администратор" : user?.role?.name || "Без роли"}
              </div>
            </div>
            <button onClick={logout} title="Выйти" className="text-slate-500 hover:text-rose-300">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex flex-col min-h-screen">
        <header className="sticky top-0 z-20 h-16 flex items-center justify-between gap-4 px-5 lg:px-8 bg-base-950/70 backdrop-blur-xl border-b border-line">
          <button className="lg:hidden text-slate-300" onClick={() => setOpen(true)}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
          <div className="hidden sm:block text-sm text-slate-400">
            ООО <span className="text-slate-200 font-semibold">«PROFIT DIVIDER»</span> · Финансовая система
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <span
              className={clsx(
                "chip",
                connected ? "bg-emerald-500/12 text-emerald-300 border border-emerald-500/20" : "bg-white/5 text-slate-400 border border-line"
              )}
            >
              <span className={clsx("h-2 w-2 rounded-full", connected ? "bg-emerald2 animate-pulse-dot" : "bg-slate-500")} />
              {connected ? "Real-time" : "Оффлайн"}
            </span>
          </div>
        </header>

        <main className="flex-1 p-5 lg:p-8 max-w-[1500px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
