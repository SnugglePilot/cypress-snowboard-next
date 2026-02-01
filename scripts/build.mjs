#!/usr/bin/env node
/**
 * Build static site: merge editorial.md (rendered to HTML) into data.json, output to dist/.
 * Run: npm run build
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");

const STATIC = ["index.html", "app.js", "style.css"];

async function main() {
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

  const dataPath = path.join(root, "data.json");
  const editorialPath = path.join(root, "editorial.md");

  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  } catch (e) {
    console.error("Failed to read data.json:", e.message);
    process.exit(1);
  }

  if (fs.existsSync(editorialPath)) {
    const md = fs.readFileSync(editorialPath, "utf-8").trim();
    const html = await marked.parse(md);
    data.editorial = data.editorial || {};
    data.editorial.blurbHtml = typeof html === "string" ? html : String(html);
  }

  fs.writeFileSync(
    path.join(distDir, "data.json"),
    JSON.stringify(data, null, 2),
    "utf-8"
  );

  for (const name of STATIC) {
    const src = path.join(root, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(distDir, name));
    }
  }

  console.log("Built dist/ with data.json + editorial HTML and static assets.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
