import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        /* Marque PILOTE — navy + orange, une seule famille d'accent */
        pilote: {
          DEFAULT: "#1E3A5F",
          hover: "#2a4f7c",
          50: "#f2f5f9",
          100: "#e4eaf1",
          200: "#c5d2e2",
          800: "#162c49",
          orange: "#FF8C00",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        /* Ombres teintées navy — jamais de noir pur */
        card: "0 1px 2px rgba(30, 58, 95, 0.05), 0 4px 16px -8px rgba(30, 58, 95, 0.08)",
        "card-hover": "0 2px 4px rgba(30, 58, 95, 0.06), 0 12px 28px -10px rgba(30, 58, 95, 0.14)",
      },
    },
  },
  plugins: [],
};
export default config;
