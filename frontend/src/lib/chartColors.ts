import { useTheme } from "../store/theme";

// Recharts красит SVG через атрибуты, а там var(--…) не работает —
// поэтому палитра графиков задаётся здесь явно, по текущей теме.
// На светлом фоне неоновые оттенки «выцветают», берём чуть глубже.
const DARK = {
  accent: "#5b8cff",
  income: "#2dd4a7",
  expense: "#fb7185",
  axis: "#64748b",
  pie: ["#5b8cff", "#2dd4a7", "#a78bfa", "#fbbf24", "#fb7185", "#38bdf8"],
};

const LIGHT = {
  accent: "#3b6ee9",
  income: "#0d9488",
  expense: "#e11d48",
  axis: "#8592a6",
  pie: ["#3b6ee9", "#0d9488", "#7c3aed", "#d97706", "#e11d48", "#0284c7"],
};

export function useChartColors() {
  return useTheme().theme === "dark" ? DARK : LIGHT;
}
