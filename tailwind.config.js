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
        satoshi: ["var(--font-satoshi)"],
      },
      colors: {
        "clerk-purple": "#6C47FF",
        "card-dark-grey": "#222225",
        "card-dark-text": "#798191",
        "card-dark-description-text": "#949EB2",
      },
    },
  },
};
