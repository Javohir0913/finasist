/** @type {import('tailwindcss').Config} */

// Все цвета вынесены в CSS-переменные (index.css): один и тот же класс
// (bg-base-850, text-slate-400, border-line) даёт нужный оттенок и в тёмной,
// и в светлой теме — переключение идёт классом `dark` на <html>.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          950: v("--c-base-950"),
          900: v("--c-base-900"),
          850: v("--c-base-850"),
          800: v("--c-base-800"),
          700: v("--c-base-700"),
        },
        line: v("--c-line"),
        // «Плёнка» поверх фона: в тёмной теме подсветка белым, в светлой —
        // затемнение. Заменяет прежние bg-white/5 и т.п.
        veil: v("--c-veil"),
        // Акцентный текст (был text-white): белый на тёмной, почти чёрный на светлой.
        ink: v("--c-ink"),
        accent: {
          DEFAULT: v("--c-accent"),
          soft: v("--c-accent-soft"),
        },
        // Шкала slate инвертируется: 100 — самый контрастный текст,
        // 600 — самый бледный, независимо от темы.
        slate: {
          100: v("--c-slate-100"),
          200: v("--c-slate-200"),
          300: v("--c-slate-300"),
          400: v("--c-slate-400"),
          500: v("--c-slate-500"),
          600: v("--c-slate-600"),
        },
        // Текстовые оттенки статусов — на светлом фоне нужны насыщеннее.
        emerald: { 200: v("--c-emerald-200"), 300: v("--c-emerald-300") },
        rose: { 300: v("--c-rose-300") },
        amber: { 100: v("--c-amber-100"), 200: v("--c-amber-200"), 300: v("--c-amber-300") },
        violet: { 300: v("--c-violet-300") },
        emerald2: v("--c-emerald2"),
        violet2: v("--c-violet2"),
        amber2: v("--c-amber2"),
        rose2: v("--c-rose2"),
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        card: "var(--shadow-card)",
        glow: "var(--shadow-glow)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)",
      },
      keyframes: {
        "fade-in": { "0%": { opacity: 0, transform: "translateY(6px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
        "pulse-dot": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.35 } },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out both",
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
