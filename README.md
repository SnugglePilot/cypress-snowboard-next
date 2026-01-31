# Cypress snowboard next

A tiny static website: **“When can I snowboard next?”** for Cypress Mountain.

It is intentionally simple:
- `index.html` renders a single “next good day” recommendation.
- `data.json` contains the computed recommendation and the raw-ish inputs.
- `scripts/update.mjs` generates `data.json` using:
  - Cypress Mountain report (lift status + snow totals)
  - Snow-Forecast Cypress page (forecast heuristic)

## Update

```bash
cd cypress-snowboard-next
node scripts/update.mjs
```

## Deploy

This repo is intended for GitHub Pages (main branch / root).

