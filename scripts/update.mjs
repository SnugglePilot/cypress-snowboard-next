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
  // No-key forecast API (Open-Meteo). Cypress Mountain weather station coords from their own page.
  openMeteo: 'https://api.open-meteo.com/v1/forecast',
  // BC River Forecast Centre: bi-weekly snow conditions commentary.
  bcSnowCommentary: 'https://www2.gov.bc.ca/gov/content/environment/air-land-water/water/drought-flooding-dikes-dams/river-forecast-centre/snow-survey-water-supply-bulletin/snow-conditions-commentary'
};

const CYPRESS = {
  lat: 49.3889782663548,
  lon: -123.20711795277704,
  tz: 'America/Vancouver',
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

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/') && !ct.includes('html') && !ct.includes('json')) {
    throw new Error(`fetch ${url}: unexpected content-type ${ct}`);
  }
  return await res.text();
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

function seasonalGuess(bcSnowpack) {
  // Ultra-simple climatology for Cypress / Vancouver north shore.
  // (This is a heuristic, not a model.)
  //
  // Biasing (Andy): incorporate BC River Forecast Centre snow context.
  // We treat Vancouver Island + provincial % median as a coarse proxy for coastal snow health.

  const d = new Date();
  const month = d.getMonth(); // 0=Jan

  const prov = bcSnowpack?.provincialPctMedian ?? null;
  const vanIsle = bcSnowpack?.vancouverIslandPctMedian ?? null;

  const biasNotes = [];
  let bias = 0; // -1 = later/weak season, +1 = earlier/strong season

  if (typeof vanIsle === 'number') {
    biasNotes.push(`BC ASWS Vancouver Island avg: ${vanIsle}% of median (${bcSnowpack?.updatedOn ?? 'unknown date'}).`);
    if (vanIsle >= 110) bias += 1;
    if (vanIsle <= 85) bias -= 1;
  }
  if (typeof prov === 'number') {
    biasNotes.push(`BC ASWS provincial avg: ${prov}% of median (${bcSnowpack?.updatedOn ?? 'unknown date'}).`);
    if (prov >= 115) bias += 1;
    if (prov <= 95) bias -= 1;
  }

  // Rough season windows:
  // - Nov/Dec: early season (hit or miss)
  // - Jan/Feb: best
  // - Mar: still good, warmer risk
  // - Apr: spring conditions
  // - May-Oct: assume next season

  if (month >= 4 && month <= 9) {
    const target = bias > 0
      ? 'late Nov (maybe early)'
      : bias < 0
        ? 'mid/late Dec'
        : 'late Nov / Dec';

    return {
      label: `Next season (aim for ${target}) — check again in fall`,
      confidence: 'bad',
      reasons: [
        'Out of typical Cypress snow season (May–Oct).',
        'Historical pattern: first reliably rideable windows tend to show up late Nov–Dec.',
        ...biasNotes,
      ],
    };
  }

  if (month === 10) {
    const target = bias > 0
      ? 'mid/late Nov'
      : bias < 0
        ? 'early/mid Dec'
        : 'late Nov / early Dec';

    return {
      label: `Likely ${target} (watch for first storms)`,
      confidence: 'meh',
      reasons: [
        'Early season: openings depend on first significant snow + sustained cold.',
        ...biasNotes,
      ],
    };
  }

  if (month <= 1) {
    return {
      label: 'This week / next week (prime season) — watch for fresh snow + cold nights',
      confidence: 'meh',
      reasons: [
        'Jan/Feb is historically the most reliable window for Cypress.',
        ...biasNotes,
      ],
    };
  }

  // Mar/Apr
  return {
    label: 'Next 1–2 weeks (spring variable) — prioritize cold nights + fresh snow',
    confidence: 'meh',
    reasons: [
      'Spring conditions are volatile; base can be fine but rain/warmth ruins it fast.',
      ...biasNotes,
    ],
  };
}

function decideNext({ lifts, snow, forecast, bcSnowpack }) {
  // Heuristic rules:
  // - Hard constraint (Andy): if it rains at all before 3pm local time, exclude that day.
  // - If most lifts are open AND 7-day snow is decent, call it "go soon" (but only if today isn't excluded).
  // - Otherwise pick the next non-excluded day from the 7-day forecast window.
  // - If none, fall back to seasonal guess.

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

  // Apply rain exclusion
  const todayKey = forecast?.days?.[0]?.date ?? null;
  const todayExcluded = todayKey ? Boolean(forecast?.excludeBefore3pmRain?.[todayKey]) : false;
  if (todayExcluded) {
    reasons.push('Excluded today: forecast shows rain before 3pm.');
  }

  if (!todayExcluded && liftOk && (snowOk || baseOk)) {
    return {
      label: 'Next good day: Today (no rain before 3pm) — go when you can',
      confidence: 'good',
      reasons,
    };
  }

  // Find next day that is NOT excluded by rain-before-3pm.
  const days = forecast?.days ?? [];
  const excludeMap = forecast?.excludeBefore3pmRain ?? {};
  const nextDay = days.find((d, idx) => idx > 0 && !excludeMap[d.date]);

  if (nextDay) {
    const extra = [];
    if (excludeMap[nextDay.date] === false) {
      extra.push(`No forecast rain before 3pm on ${nextDay.date}.`);
    }
    if (nextDay.snowfallCm != null && nextDay.snowfallCm > 0) {
      extra.push(`Forecast snowfall: ~${nextDay.snowfallCm} cm (low confidence).`);
    }
    if (nextDay.rainMm != null && nextDay.rainMm > 0) {
      extra.push(`Forecast total rain: ~${nextDay.rainMm} mm (but after 3pm, per rule).`);
    }

    return {
      label: `Next good day: ${nextDay.label}`,
      confidence: 'meh',
      reasons: [...reasons, ...extra],
    };
  }

  const seasonal = seasonalGuess(bcSnowpack);
  return {
    ...seasonal,
    reasons: [...reasons, ...seasonal.reasons, 'Also: no acceptable (no-rain-before-3pm) day found in the next 14 days.'],
  };
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchForecast() {
  // Open-Meteo hourly rain/snowfall. We only need the next 7 days.
  const u = new URL(SOURCES.openMeteo);
  u.searchParams.set('latitude', String(CYPRESS.lat));
  u.searchParams.set('longitude', String(CYPRESS.lon));
  u.searchParams.set('timezone', CYPRESS.tz);
  u.searchParams.set('forecast_days', '14');
  u.searchParams.set('hourly', 'rain,snowfall,temperature_2m');

  const res = await fetch(u);
  if (!res.ok) throw new Error(`open-meteo: HTTP ${res.status}`);
  const j = await res.json();

  const time = j?.hourly?.time ?? [];
  const rain = j?.hourly?.rain ?? [];
  const snowfall = j?.hourly?.snowfall ?? [];
  const temp = j?.hourly?.temperature_2m ?? [];

  // Bucket by local-date.
  const byDate = new Map();
  for (let i = 0; i < time.length; i++) {
    // time is already localized in the requested timezone.
    const t = time[i]; // "YYYY-MM-DDTHH:MM"
    const date = t.slice(0, 10);
    const hour = Number(t.slice(11, 13));
    const r = Number(rain[i] ?? 0);
    const s = Number(snowfall[i] ?? 0);
    const te = Number(temp[i] ?? 0);

    if (!byDate.has(date)) byDate.set(date, { date, rainMm: 0, snowfallCm: 0, rainBefore3pm: false, hours: [] });
    const d = byDate.get(date);
    d.rainMm += r;
    d.snowfallCm += s; // Open-Meteo returns snowfall in cm (water equivalent differs, but fine for heuristic).

    // Exclusion rule: any rain (>0) before 15:00 local.
    // Guard: if temp <= 1C and snowfall > 0, treat precipitation as snow, not rain.
    const isRain = r > 0 && !(te <= 1 && s > 0);
    if (hour < 15 && isRain) d.rainBefore3pm = true;

    d.hours.push({ t, hour, rainMm: r, snowfallCm: s, tempC: te });
  }

  const days = Array.from(byDate.values())
    .slice(0, 14)
    .map((d, idx) => {
      const dateObj = new Date(d.date + 'T12:00:00');
      const label = idx === 0
        ? `${d.date} (today)`
        : dateObj.toLocaleDateString('en-CA', { timeZone: CYPRESS.tz, weekday: 'short', month: 'short', day: 'numeric' });
      const rainMm = Math.round(d.rainMm * 10) / 10;
      const snowfallCm = Math.round(d.snowfallCm * 10) / 10;
      const stoke = d.rainBefore3pm
        ? 'bad'
        : snowfallCm > 0 && rainMm < 5
          ? 'good'
          : rainMm < 2
            ? 'good'
            : 'meh';
      return {
        date: d.date,
        label,
        rainMm,
        snowfallCm,
        rainBefore3pm: d.rainBefore3pm,
        stoke,
      };
    });

  const excludeBefore3pmRain = {};
  for (const d of days) excludeBefore3pmRain[d.date] = d.rainBefore3pm;

  return { days, excludeBefore3pmRain, raw: { url: u.toString() } };
}

async function fetchBCSnowpack() {
  // Lightweight parse of the BC River Forecast Centre snow commentary page.
  // We pull two numbers we can reliably extract from the text:
  //  - provincial average % of median
  //  - Vancouver Island basin average % of median (coastal proxy)
  // Plus the page's "Last updated" date.

  const html = await fetchText(SOURCES.bcSnowCommentary);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const updatedOn = (() => {
    const m = text.match(/Last updated on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
    return m ? m[1] : null;
  })();

  const provincialPctMedian = (() => {
    const m = text.match(/provincial average[^%]{0,120}is\s+(\d+)%\s+of\s+the\s+period-of-record\s+median/i);
    return m ? Number(m[1]) : null;
  })();

  const vancouverIslandPctMedian = (() => {
    const m = text.match(/Vancouver Island\s*\((\d+)%\)/i);
    return m ? Number(m[1]) : null;
  })();

  // Short blurb for UI.
  const blurb = (() => {
    // Grab first paragraph after the date header if possible; otherwise fallback.
    const m = text.match(/January\s+\d{1,2},\s+\d{4}\s+(.*?)(?:A complete listing of Automated Snow Weather Stations|The provincial average across all ASWS sites)/i);
    const s = m ? m[1].trim() : null;
    return s ? s.slice(0, 260) + (s.length > 260 ? '…' : '') : null;
  })();

  return {
    sourceUrl: SOURCES.bcSnowCommentary,
    updatedOn,
    provincialPctMedian,
    vancouverIslandPctMedian,
    blurb,
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

  let forecast = null;
  try {
    forecast = await fetchForecast();
  } catch (e) {
    forecast = { error: String(e?.message ?? e) };
  }

  let bcSnowpack = null;
  try {
    bcSnowpack = await fetchBCSnowpack();
  } catch (e) {
    bcSnowpack = { error: String(e?.message ?? e), sourceUrl: SOURCES.bcSnowCommentary };
  }

  const next = decideNext({ lifts, snow, forecast, bcSnowpack });

  const out = {
    generatedAt: new Date().toISOString(),
    generatedAtLocal: nowLocalString(),
    current: {
      lifts,
      snow,
    },
    forecast,
    bcSnowpack,
    next,
    sources: [
      { label: 'Cypress Mountain Report', url: SOURCES.cypressReport },
      { label: 'Snow-Forecast (Cypress mid)', url: SOURCES.snowForecast },
      { label: 'Open-Meteo forecast (no key)', url: 'https://open-meteo.com/' },
      { label: 'BC Snow conditions commentary', url: SOURCES.bcSnowCommentary },
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
