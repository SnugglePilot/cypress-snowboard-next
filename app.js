async function main(){
  const els = {
    nextDay: document.getElementById('nextDay'),
    confidence: document.getElementById('confidence'),
    updated: document.getElementById('updated'),
    editorial: document.getElementById('editorial'),
    reasons: document.getElementById('reasons'),
    stokeMeter: document.getElementById('stokeMeter'),
    lifts: document.getElementById('lifts'),
    snow7: document.getElementById('snow7'),
    base: document.getElementById('base'),
    bcUpdated: document.getElementById('bcUpdated'),
    bcProv: document.getElementById('bcProv'),
    bcVI: document.getElementById('bcVI'),
    bcBlurb: document.getElementById('bcBlurb'),
    sources: document.getElementById('sources'),
  };

  let data;
  try {
    const r = await fetch('data.json', { cache: 'no-store' });
    data = await r.json();
  } catch (e) {
    els.nextDay.textContent = 'Could not load data.json';
    els.confidence.textContent = 'error';
    els.confidence.className = 'pill bad';
    return;
  }

  els.nextDay.textContent = data.next?.label ?? 'Unknown';
  const conf = (data.next?.confidence ?? 'unknown').toLowerCase();
  els.confidence.textContent = conf;
  els.confidence.className = 'pill ' + (conf === 'good' ? 'good' : conf === 'meh' ? 'meh' : 'bad');

  els.updated.textContent = `Last updated: ${data.generatedAtLocal ?? data.generatedAt ?? 'unknown'}`;

  if (data.editorial?.blurbHtml) {
    els.editorial.innerHTML = data.editorial.blurbHtml;
    els.editorial.style.display = 'block';
  } else if (data.editorial?.blurb) {
    els.editorial.textContent = data.editorial.blurb;
    els.editorial.style.display = 'block';
  } else {
    els.editorial.style.display = 'none';
  }

  els.reasons.innerHTML = '';
  (data.next?.reasons ?? []).forEach(r => {
    const li = document.createElement('li');
    li.textContent = r;
    els.reasons.appendChild(li);
  });

  // Stoke-o-meter: one card per day (up to 14)
  els.stokeMeter.innerHTML = '';
  const days = data.forecast?.days ?? [];
  days.forEach((d) => {
    const stoke = d.stoke ?? (d.rainBefore3pm ? 'bad' : (d.snowfallCm > 0 && (d.rainMm ?? 0) < 5) || (d.rainMm ?? 0) < 2 ? 'good' : 'meh');
    const card = document.createElement('div');
    card.className = 'stoke-day';
    card.setAttribute('role', 'listitem');
    const label = document.createElement('span');
    label.className = 'stoke-day-label';
    label.textContent = d.label ?? d.date;
    const pill = document.createElement('span');
    pill.className = 'pill stoke-pill ' + stoke;
    pill.textContent = stoke;
    card.appendChild(label);
    card.appendChild(pill);
    const detail = document.createElement('span');
    detail.className = 'stoke-day-detail';
    const parts = [];
    if (d.rainBefore3pm) parts.push('rain AM');
    if (d.snowfallCm != null && d.snowfallCm > 0) parts.push(d.snowfallCm + ' cm snow');
    if (d.rainMm != null && d.rainMm > 0 && !d.rainBefore3pm) parts.push(d.rainMm + ' mm rain');
    detail.textContent = parts.length ? parts.join(' · ') : 'dry';
    card.appendChild(detail);
    els.stokeMeter.appendChild(card);
  });

  if (data.current) {
    const lifts = data.current.lifts;
    if (lifts) {
      els.lifts.textContent = `${lifts.open}/${lifts.total} open (${lifts.closed} closed)`;
    }
    if (data.current.snow) {
      els.snow7.textContent = data.current.snow.snow7DaysCm != null ? `${data.current.snow.snow7DaysCm} cm` : '—';
      els.base.textContent = data.current.snow.baseDepthCm != null ? `${data.current.snow.baseDepthCm} cm` : '—';
    }
  }

  // BC context panel
  const bc = data.bcSnowpack;
  if (!bc) {
    els.bcUpdated.textContent = '—';
    els.bcProv.textContent = '—';
    els.bcVI.textContent = '—';
    els.bcBlurb.textContent = '';
  } else if (bc.error) {
    els.bcUpdated.textContent = `Could not load BC commentary (${bc.error})`;
    els.bcProv.textContent = '—';
    els.bcVI.textContent = '—';
    els.bcBlurb.textContent = '';
  } else {
    els.bcUpdated.textContent = `Last updated: ${bc.updatedOn ?? 'unknown'}`;
    els.bcProv.textContent = bc.provincialPctMedian != null ? `${bc.provincialPctMedian}% of median` : '—';
    els.bcVI.textContent = bc.vancouverIslandPctMedian != null ? `${bc.vancouverIslandPctMedian}% of median` : '—';
    els.bcBlurb.textContent = bc.blurb ?? '';
  }

  els.sources.innerHTML = '';
  (data.sources ?? []).forEach(s => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = s.url;
    a.textContent = s.label;
    a.target = '_blank';
    a.rel = 'noopener';
    li.appendChild(a);
    els.sources.appendChild(li);
  });
}

main();
