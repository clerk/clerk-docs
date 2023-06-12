/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./src/components/**/*.tsx",
    "./src/pages/**/*.{md,mdx}",
    "./theme.config.tsx",
  ],
  theme: {
    extend: {
      fontFamily: {
        inter: ["var(--font-inter)"],
        figtree: ["var(--font-figtree)"],
      },
      colors: {
        "clerk-purple": "#6C47FF",
      },
    },
  },
};
