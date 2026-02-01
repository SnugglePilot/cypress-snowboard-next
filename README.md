# Cypress snowboard next

A tiny static website: **“When can I snowboard next?”** for Cypress Mountain.

It is intentionally simple:
- `index.html` renders a single “next good day” recommendation and an editorial blurb.
- `data.json` contains the computed recommendation, raw-ish inputs, and (at build time) the rendered editorial HTML.
- `editorial.md` is the editorial in markdown (stoke level, best day ahead); rendered to HTML when you build.
- `scripts/update.mjs` generates `data.json` using:
  - Cypress Mountain report (lift status + snow totals)
  - Snow-Forecast Cypress page (forecast heuristic)

## Update data and editorial

```bash
cd cypress-snowboard-next
node scripts/update.mjs
# Then write or edit editorial.md (markdown). Commit data.json + editorial.md and push.
```

## Build (local or CI)

Build merges `editorial.md` (markdown to HTML) into `data.json` and outputs the static site to `dist/`:

```bash
npm install
npm run build
```

## Deploy

GitHub Actions builds and deploys to GitHub Pages on push to `main`. In repo settings, set **Pages > Source** to **GitHub Actions**. The workflow runs `npm install`, `npm run build`, and deploys `dist/`.

