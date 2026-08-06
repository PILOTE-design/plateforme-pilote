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

        /* ── L'ENCRE — LA PALETTE DE GRIS, REDÉFINIE ────────────────────
         *
         * Le tableau de bord affichait 444 fois `text-gray-400` et 96 fois
         * `text-gray-300`. Sur blanc, ce sont 2,54:1 et 1,47:1 — le seuil
         * lisible est 4,5:1. Cinq cent quarante endroits où un boucher fatigué,
         * devant un écran de laboratoire couvert de buée, ne lisait pas ce qui
         * était écrit. Un chiffre juste qu'on ne peut pas lire est un chiffre
         * faux.
         *
         * On ne corrige pas ça en réécrivant 540 lignes : on corrige la
         * PALETTE. Le gris de Tailwind n'est pas une loi de la nature, c'est un
         * réglage par défaut — et celui-ci ne convient pas à un outil de
         * travail. Décalé d'un cran vers le sombre :
         *
         *   gray-300  #d1d5db → #9ca3af   1,47:1 → 2,54:1   séparateurs, points,
         *                                                    bordures, tirets
         *   gray-400  #9ca3af → #6b7280   2,54:1 → 4,83:1   LISIBLE
         *
         * `gray-400` et `gray-500` pointent désormais sur le même ton : il n'y
         * a qu'UN gris lisible, et écrire l'un ou l'autre donne le bon. C'est
         * volontaire — un développeur pressé ne peut plus se tromper.
         *
         * `gray-300` reste sous le seuil : il ne porte donc JAMAIS un mot. Il
         * dessine — un trait, une pastille, le rail d'un interrupteur.
         */
        gray: {
          300: "#9ca3af",
          400: "#6b7280",
        },

        /* Les mêmes tons, nommés par leur RÔLE. Le nom porte la règle : à
         * utiliser dans tout code neuf, où « faible » se lit comme une limite
         * et non comme une invitation à descendre plus bas. */
        encre: {
          DEFAULT: "#374151", // texte courant            10,3:1
          fort: "#111827",    // chiffres, titres         16,1:1
          doux: "#4b5563",    // secondaire, aides         7,6:1
          faible: "#6b7280",  // labels, mentions          4,83:1  ← plancher
        },
        /* Ce qui n'est PAS un mot. 2,54:1 — inutilisable pour du texte, et
         * c'est exactement pour ça qu'il porte un autre nom. */
        trait: "#9ca3af",
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
