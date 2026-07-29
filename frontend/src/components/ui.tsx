import clsx from "clsx";
import { ReactNode, useEffect, useRef, useState } from "react";

// ---- Searchable select (combobox): filter long option lists by typing ----
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "— выбрать —",
  allowEmpty = true,
  emptyLabel = "— не выбрано —",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; search?: string }[];
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const ql = q.toLowerCase();
  const filtered = q
    ? options.filter((o) => (o.search ?? o.label).toLowerCase().includes(ql))
    : options;

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQ("");
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ("");
  };

  // список раскрывается внутри прокручиваемой модалки и может оказаться
  // за нижним краем — подтягиваем его в видимую часть
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="input text-left flex items-center justify-between gap-2"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={clsx("truncate", !selected && "text-slate-500")}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="text-slate-500 shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute z-[70] mt-1 w-full rounded-xl border border-line bg-base-850 shadow-card p-2 max-h-72 overflow-auto">
          <input
            autoFocus
            className="input mb-2 sticky top-0"
            placeholder="Поиск по коду или названию…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="space-y-0.5">
            {allowEmpty && (
              <button type="button" onClick={() => pick("")} className="block w-full text-left px-2 py-1.5 rounded-lg text-sm text-slate-400 hover:bg-white/10">
                {emptyLabel}
              </button>
            )}
            {filtered.slice(0, 100).map((o) => (
              <button
                type="button"
                key={o.value}
                onClick={() => pick(o.value)}
                className={clsx(
                  "block w-full text-left px-2 py-1.5 rounded-lg text-sm hover:bg-white/10",
                  o.value === value ? "bg-accent/15 text-accent-soft" : "text-slate-300"
                )}
              >
                {o.label}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="text-slate-500 text-sm px-2 py-3 text-center">Ничего не найдено</div>
            )}
            {filtered.length > 100 && (
              <div className="text-slate-600 text-xs px-2 py-1.5">Показаны первые 100 — уточните поиск</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Money / number input: space grouping, dot decimal, blocks - e + ----
function cleanNumeric(s: string): string {
  let x = s;
  // comma is decimal separator -> convert to dot. If a comma exists, treat any dots
  // as thousand separators (from paste) and drop them first.
  if (x.indexOf(",") !== -1) x = x.replace(/\./g, "");
  x = x.replace(/,/g, "."); // comma -> dot
  x = x.replace(/[^\d.]/g, ""); // drop spaces / letters / etc.
  const i = x.indexOf(".");
  if (i !== -1) x = x.slice(0, i + 1) + x.slice(i + 1).replace(/\./g, "").slice(0, 2); // one dot, max 2 dec
  // strip leading zeros in the integer part: "05000" -> "5000", "007" -> "7", keep "0" / "0.5"
  const dot = x.indexOf(".");
  if (dot === -1) x = x.replace(/^0+(?=\d)/, "");
  else x = x.slice(0, dot).replace(/^0+(?=\d)/, "") + x.slice(dot);
  return x;
}
function groupInt(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function displayNumeric(clean: string): string {
  if (clean === "") return "";
  const dot = clean.indexOf(".");
  if (dot === -1) return groupInt(clean);
  return groupInt(clean.slice(0, dot)) + "." + clean.slice(dot + 1);
}

export function MoneyInput({
  value,
  onChange,
  className = "input",
  placeholder,
  disabled,
}: {
  value: number | string | null | undefined;
  onChange: (v: string) => void; // clean numeric string, e.g. "5000000.23"
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [display, setDisplay] = useState(() => displayNumeric(cleanNumeric(String(value ?? ""))));

  // re-sync when the external value differs numerically (e.g. form reset / edit)
  useEffect(() => {
    const cur = display.replace(/\s/g, "");
    if (parseFloat(cur || "0") !== Number(value || 0)) {
      setDisplay(displayNumeric(cleanNumeric(String(value ?? ""))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      value={display}
      onKeyDown={(e) => {
        if (["e", "E", "+", "-"].includes(e.key)) e.preventDefault();
      }}
      onChange={(e) => {
        const clean = cleanNumeric(e.target.value);
        setDisplay(displayNumeric(clean));
        onChange(clean);
      }}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("card animate-fade-in", className)}>{children}</div>;
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-5">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-slate-400 mt-1">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

const toneMap: Record<string, string> = {
  emerald: "bg-emerald-500/12 text-emerald-300 border border-emerald-500/20",
  rose: "bg-rose-500/12 text-rose-300 border border-rose-500/20",
  violet: "bg-violet-500/12 text-violet-300 border border-violet-500/20",
  amber: "bg-amber-500/12 text-amber-300 border border-amber-500/20",
  slate: "bg-white/5 text-slate-300 border border-line",
  accent: "bg-accent/15 text-accent-soft border border-accent/25",
};

export function Badge({ tone = "slate", children }: { tone?: keyof typeof toneMap; children: ReactNode }) {
  return <span className={clsx("chip", toneMap[tone])}>{children}</span>;
}

export function KpiCard({
  label,
  value,
  delta,
  tone = "accent",
  icon,
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: keyof typeof toneMap;
  icon?: ReactNode;
}) {
  const glow: Record<string, string> = {
    emerald: "from-emerald-500/20",
    rose: "from-rose-500/20",
    violet: "from-violet-500/20",
    amber: "from-amber-500/20",
    accent: "from-accent/20",
    slate: "from-white/10",
  };
  return (
    <div className="relative overflow-hidden glass p-5 animate-fade-in">
      <div className={clsx("absolute -top-16 -right-10 h-40 w-40 rounded-full bg-gradient-to-br blur-2xl", glow[tone])} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">{label}</span>
          {icon && <span className={clsx("h-9 w-9 grid place-items-center rounded-xl", toneMap[tone])}>{icon}</span>}
        </div>
        <div className="mt-3 text-2xl font-bold text-white tracking-tight">{value}</div>
        {delta && <div className="mt-1 text-xs text-slate-400">{delta}</div>}
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      {/* Высокая форма не должна вылезать за экран: панель ограничена по высоте,
          шапка закреплена, а содержимое (включая кнопки) прокручивается. */}
      <div className={clsx("relative w-full glass animate-fade-in flex flex-col modal-panel", width)}>
        <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-4 shrink-0">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
          {children}
        </div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-16 text-center text-slate-500 text-sm">
      <div className="text-4xl mb-3 opacity-40">⌗</div>
      {text}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="grid place-items-center py-24">
      <div className="h-8 w-8 rounded-full border-2 border-white/15 border-t-accent animate-spin" />
    </div>
  );
}
