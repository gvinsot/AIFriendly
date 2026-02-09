import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      colors: {
        luxe: {
          bg: "var(--luxe-bg)",
          "bg-elevated": "var(--luxe-bg-elevated)",
          "bg-muted": "var(--luxe-bg-muted)",
          fg: "var(--luxe-fg)",
          "fg-muted": "var(--luxe-fg-muted)",
          gold: "var(--luxe-gold)",
          "gold-muted": "var(--luxe-gold-muted)",
          border: "var(--luxe-border)",
          "border-focus": "var(--luxe-border-focus)",
        },
      },
      boxShadow: {
        luxe: "0 4px 24px -4px rgba(0,0,0,0.2), 0 0 0 1px rgba(34,211,238,0.08)",
        "luxe-lg": "0 24px 48px -12px rgba(0,0,0,0.25), 0 0 0 1px rgba(34,211,238,0.1)",
        "luxe-glow": "0 0 40px -8px rgba(34,211,238,0.15)",
      },
      animation: {
        "shimmer": "shimmer 1.5s ease-in-out infinite",
      },
      keyframes: {
        shimmer: {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "0.8" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
