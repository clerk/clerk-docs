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
      keyframes: {
        slide: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(4px)" },
        },
      },
      animation: {
        "move-arrow": "slide 0.2s ease-out 0s 1 normal forwards",
      },
      colors: {
        "clerk-purple": "#6C47FF",
      },
    },
  },
};
