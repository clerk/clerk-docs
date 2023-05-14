/** @type {import('next').NextConfig} */
const withNextra = require("nextra")({
  theme: "nextra-theme-docs",
  themeConfig: "./theme.config.tsx",
});

module.exports = withNextra({
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/quickstarts/next/next",
        destination: "/quickstarts/nextjs/stable",
        permanent: true,
      },
      {
        source: "/quickstarts/next/next-beta",
        destination: "/quickstarts/nextjs/app-router",
        permanent: true,
      },
    ];
  },
});
