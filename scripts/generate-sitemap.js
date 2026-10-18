"use strict";

const fs = require("node:fs");
const path = require("node:path");

const configuredUrl = process.env.SITE_URL || process.env.URL;
if (!configuredUrl) {
  throw new Error("Set SITE_URL or deploy through Netlify, which provides the URL environment variable.");
}

let siteUrl;
try {
  siteUrl = new URL(configuredUrl);
} catch {
  throw new Error("The public site URL must be a valid HTTPS URL.");
}

if (siteUrl.protocol !== "https:" || siteUrl.username || siteUrl.password || siteUrl.search || siteUrl.hash) {
  throw new Error("The public site URL must be an HTTPS origin without credentials, query, or fragment.");
}

const origin = siteUrl.origin;
const root = path.resolve(__dirname, "..");
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  "  <url>",
  "    <loc>" + origin + "/</loc>",
  "  </url>",
  "</urlset>",
  ""
].join("\n");
const robots = [
  "User-agent: *",
  "Allow: /",
  "Sitemap: " + origin + "/sitemap.xml",
  ""
].join("\n");

fs.writeFileSync(path.join(root, "sitemap.xml"), sitemap, "utf8");
fs.writeFileSync(path.join(root, "robots.txt"), robots, "utf8");
console.log("Generated sitemap.xml and robots.txt for " + origin);
