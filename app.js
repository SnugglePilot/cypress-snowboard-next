async function main(){
  const els = {
    nextDay: document.getElementById('nextDay'),
    confidence: document.getElementById('confidence'),
    updated: document.getElementById('updated'),
    reasons: document.getElementById('reasons'),
    lifts: document.getElementById('lifts'),
    snow7: document.getElementById('snow7'),
    base: document.getElementById('base'),
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

  els.reasons.innerHTML = '';
  (data.next?.reasons ?? []).forEach(r => {
    const li = document.createElement('li');
    li.textContent = r;
    els.reasons.appendChild(li);
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
