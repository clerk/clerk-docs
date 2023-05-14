/** @type {import("next-sitemap").IConfig} */
module.exports = {
  siteUrl: process.env.SITE_URL || "https://beta-docs.clerk.dev/",
  generateRobotsTxt: true,
  // TODO: REMOVE THIS BEFORE DEPLOYMENT
  robotsTxtOptions: {
    policies: [{ userAgent: "*", disallow: "/" }],
  },
};
