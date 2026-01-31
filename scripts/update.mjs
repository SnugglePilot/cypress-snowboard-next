#!/usr/bin/env node
/*
  Update data.json for the Cypress snowboard-next site.

  Design goals:
  - No API keys.
  - Use agent-browser (headless) to read the Cypress Mountain Report sections that are client-rendered.
  - Keep heuristics explicit; this is a "best effort" guess.
*/

import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const SOURCES = {
  cypressReport: 'https://www.cypressmountain.com/mountain-report',
  snowForecast: 'https://www.snow-forecast.com/resorts/Cypress-Mountain/6day/mid',
};

function nowLocalString() {
  try {
    return new Date().toLocaleString('en-CA', { timeZone: 'America/Vancouver', hour12: false });
  } catch {
    return new Date().toISOString();
  }
}

async function ab(...args) {
  const { stdout } = await execFileP('agent-browser', args, { maxBuffer: 1024 * 1024 * 10 });
  return stdout;
}

function parseLiftStatus(snapshotText) {
  // Expect lines like:
  // - heading "Lifts Open" ...
  // - text: "5"
  // - paragraph: of 6
  const open = (() => {
    const m = snapshotText.match(/heading "Lifts Open"[\s\S]*?\n- text: "(\d+)"/);
    return m ? Number(m[1]) : null;
  })();

  const total = (() => {
    const m = snapshotText.match(/heading "Lifts Open"[\s\S]*?\n- paragraph: of (\d+)/);
    return m ? Number(m[1]) : null;
  })();

  const closed = (() => {
    const m = snapshotText.match(/heading "Lifts Closed"[\s\S]*?\n- paragraph: (\d+) of (\d+)/);
    return m ? Number(m[1]) : null;
  })();

  return { open, total, closed };
}

function parseSnow(snapshotText) {
  function grab(label) {
    // label like "Snow 7 Days" then next "text: 11 cm"
    const re = new RegExp(`${label}\\n\\s*- text: (\\d+) cm`);
    const m = snapshotText.match(re);
    return m ? Number(m[1]) : null;
  }

  return {
    snowOvernightCm: grab('Snow Overnight'),
    snow24HoursCm: grab('Snow 24 Hrs\\.'),
    snow48HoursCm: grab('Snow 48 Hrs\\.'),
    snow7DaysCm: grab('Snow 7 Days'),
    seasonTotalCm: (() => {
      const m = snapshotText.match(/Snow Season Total\n\s*- text: (\d+) cm/);
      return m ? Number(m[1]) : null;
    })(),
    baseDepthCm: (() => {
      const m = snapshotText.match(/Base Depth\n\s*- text: (\d+) cm/);
      return m ? Number(m[1]) : null;
    })(),
  };
}

function seasonalGuess() {
  // Ultra-simple climatology for Cypress / Vancouver north shore.
  // (This is a heuristic, not a model.)
  const d = new Date();
  const month = d.getMonth(); // 0=Jan

  // Rough season windows:
  // - Nov/Dec: early season (hit or miss)
  // - Jan/Feb: best
  // - Mar: still good, warmer risk
  // - Apr: spring conditions
  // - May-Oct: assume next season

  if (month >= 4 && month <= 9) {
    return {
      label: 'Next season (aim for late Nov / Dec) — check again in fall',
      confidence: 'bad',
      reasons: [
        'Out of typical Cypress snow season (May–Oct).',
        'Historical pattern: first reliably rideable windows tend to show up late Nov–Dec.',
      ],
    };
  }

  if (month === 10) {
    return {
      label: 'Likely late Nov / early Dec (watch for first storms)',
      confidence: 'meh',
      reasons: [
        'Early season: openings depend on first significant snow + sustained cold.',
      ],
    };
  }

  if (month <= 1) {
    return {
      label: 'This week / next week (prime season) — watch for fresh snow + cold nights',
      confidence: 'meh',
      reasons: [
        'Jan/Feb is historically the most reliable window for Cypress.',
      ],
    };
  }

  // Mar/Apr
  return {
    label: 'Next 1–2 weeks (spring variable) — prioritize cold nights + fresh snow',
    confidence: 'meh',
    reasons: [
      'Spring conditions are volatile; base can be fine but rain/warmth ruins it fast.',
    ],
  };
}

function decideNext({ lifts, snow }) {
  // Heuristic rules:
  // - If most lifts are open AND 7-day snow is decent, call it "go soon".
  // - If lifts are mostly closed or snow is tiny, fall back to seasonal guess.

  const reasons = [];

  if (lifts?.open != null && lifts?.total != null) {
    reasons.push(`Cypress lift status: ${lifts.open}/${lifts.total} open.`);
  }
  if (snow?.snow7DaysCm != null) {
    reasons.push(`Snow (7 days): ${snow.snow7DaysCm} cm.`);
  }
  if (snow?.baseDepthCm != null) {
    reasons.push(`Base depth: ${snow.baseDepthCm} cm.`);
  }

  const liftOk = lifts?.open != null && lifts?.total != null && lifts.open / lifts.total >= 0.67;
  const snowOk = snow?.snow7DaysCm != null && snow.snow7DaysCm >= 10;
  const baseOk = snow?.baseDepthCm != null && snow.baseDepthCm >= 80;

  if (liftOk && (snowOk || baseOk)) {
    return {
      label: 'Next good day: ASAP (pick your next free morning/evening)',
      confidence: 'good',
      reasons,
    };
  }

  // If it looks marginal, say “maybe”
  if (liftOk && (snow?.baseDepthCm ?? 0) >= 40) {
    reasons.push('Conditions look rideable but not obviously great; watch for fresh snow / temps.');
    return {
      label: 'Potentially soon (watch for next fresh snow day)',
      confidence: 'meh',
      reasons,
    };
  }

  const seasonal = seasonalGuess();
  return {
    ...seasonal,
    reasons: [...reasons, ...seasonal.reasons],
  };
}

async function main() {
  // Use a single browser session. agent-browser keeps state between commands.
  await ab('open', SOURCES.cypressReport);
  await ab('wait', '3500');

  const liftSnap = await ab('snapshot', '-s', '#lift-status', '-c');
  const snowSnap = await ab('snapshot', '-s', '#snow', '-c');

  const lifts = parseLiftStatus(liftSnap);
  const snow = parseSnow(snowSnap);

  const next = decideNext({ lifts, snow });

  const out = {
    generatedAt: new Date().toISOString(),
    generatedAtLocal: nowLocalString(),
    current: {
      lifts,
      snow,
    },
    next,
    sources: [
      { label: 'Cypress Mountain Report', url: SOURCES.cypressReport },
      { label: 'Snow-Forecast (Cypress mid)', url: SOURCES.snowForecast },
    ],
  };

  await fs.writeFile(new URL('../data.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');

  // Close session (best effort)
  try { await ab('close'); } catch {}

  process.stdout.write('Wrote data.json\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
