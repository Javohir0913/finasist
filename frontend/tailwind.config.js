/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          950: "#070a12",
          900: "#0b0f1a",
          850: "#0f1523",
          800: "#141b2d",
          700: "#1c2740",
        },
        line: "rgba(255,255,255,0.07)",
        accent: {
          DEFAULT: "#5b8cff",
          soft: "#7aa2ff",
        },
        emerald2: "#2dd4a7",
        violet2: "#a78bfa",
        amber2: "#fbbf24",
        rose2: "#fb7185",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 60px -30px rgba(0,0,0,0.9)",
        glow: "0 0 40px -12px rgba(91,140,255,0.55)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
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
