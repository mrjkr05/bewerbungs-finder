// Vercel serverless function: searches several job sources at once and returns one normalized list.
// Sources: Bundesagentur für Arbeit (may be blocked on Vercel), Adzuna (needs free keys),
// Arbeitnow (open), Remotive (open, remote jobs).
const BA_BASE = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4';
const BA_HEADERS = {
  'User-Agent': 'Jobsuche/2.9.2 (de.arbeitsagentur.jobboerse; build:1077; iOS 15.1.0) Alamofire/5.4.4',
  'X-API-Key': 'jobboerse-jobsuche',
  'Accept': 'application/json'
};

const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function getJson(url, opts = {}, ms = 9000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: c.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function bundesagentur(queries, p) {
  const lists = await Promise.all(queries.map(async w => {
    const qs = new URLSearchParams({
      was: w, wo: p.wo || '', umkreis: p.umkreis || '25', angebotsart: p.angebotsart || '1',
      veroeffentlichtseit: p.tage || '7', size: '50', page: '1'
    });
    const d = await getJson(BA_BASE + '/jobs?' + qs, { headers: BA_HEADERS });
    return d.stellenangebote || [];
  }));
  return lists.flat().map(j => ({ ...j, _src: 'Bundesagentur' }));
}

async function adzuna(queries, p) {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) throw new Error('no keys set (optional)');
  const lists = await Promise.all(queries.map(async w => {
    const qs = new URLSearchParams({
      app_id: id, app_key: key,
      what: p.angebotsart === '4' ? w + ' Ausbildung' : w,
      where: p.wo || '', distance: p.umkreis || '25',
      max_days_old: p.tage || '7', results_per_page: '50'
    });
    const d = await getJson('https://api.adzuna.com/v1/api/jobs/de/search/1?' + qs);
    return d.results || [];
  }));
  return lists.flat().map(j => ({
    refnr: 'az:' + j.id,
    titel: strip(j.title),
    beruf: (j.category && j.category.label) || '',
    arbeitgeber: (j.company && j.company.display_name) || '',
    arbeitsort: { ort: (j.location && j.location.display_name) || '' },
    aktuelleVeroeffentlichungsdatum: String(j.created || '').slice(0, 10),
    _url: j.redirect_url,
    _desc: strip(j.description),
    _src: 'Adzuna'
  }));
}

async function arbeitnow(queries, skills, p) {
  const pages = await Promise.all([1, 2, 3, 4, 5].map(n =>
    getJson('https://www.arbeitnow.com/api/job-board-api?page=' + n).then(d => d.data || []).catch(() => [])));
  const terms = [...queries, ...skills].map(t => t.toLowerCase()).filter(t => t.length > 2);
  const city = String(p.wo || '').toLowerCase();
  const days = Number(p.tage) || 7;
  return pages.flat().filter(j => {
    const hay = (j.title + ' ' + (j.tags || []).join(' ') + ' ' + strip(j.description)).toLowerCase();
    const place = String(j.location || '').toLowerCase();
    const okPlace = !city || place.includes(city) || j.remote;
    const okTerm = terms.some(t => hay.includes(t));
    const okAge = (Date.now() / 1000 - j.created_at) < days * 86400 * 4;
    // For apprenticeship searches only keep ads that actually mention an apprenticeship
    const okType = p.angebotsart !== '4' || /ausbildung|azubi|duales studium|trainee|werkstudent/i.test(hay);
    return okPlace && okTerm && okAge && okType;
  }).map(j => ({
    refnr: 'an:' + j.slug,
    titel: j.title,
    beruf: (j.tags || []).join(', '),
    arbeitgeber: j.company_name,
    arbeitsort: { ort: j.location || (j.remote ? 'Remote' : '') },
    aktuelleVeroeffentlichungsdatum: new Date(j.created_at * 1000).toISOString().slice(0, 10),
    _url: j.url,
    _desc: strip(j.description),
    _src: 'Arbeitnow'
  }));
}

async function remotive(queries, p) {
  if (p.angebotsart === '4') return [];
  const lists = await Promise.all(queries.map(w =>
    getJson('https://remotive.com/api/remote-jobs?limit=25&search=' + encodeURIComponent(w)).then(d => d.jobs || [])));
  return lists.flat()
    .filter(j => /germany|deutschland|europe|eu\b|emea|worldwide|anywhere/i.test(j.candidate_required_location || ''))
    .map(j => ({
      refnr: 'rm:' + j.id,
      titel: j.title,
      beruf: j.category || '',
      arbeitgeber: j.company_name,
      arbeitsort: { ort: 'Remote (' + (j.candidate_required_location || 'worldwide') + ')' },
      aktuelleVeroeffentlichungsdatum: String(j.publication_date || '').slice(0, 10),
      _url: j.url,
      _desc: strip(j.description).slice(0, 6000),
      _src: 'Remotive'
    }));
}

module.exports = async (req, res) => {
  const p = req.query || {};
  const queries = String(p.was || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
  const skills = String(p.skills || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
  if (!queries.length) return res.status(400).json({ error: 'was fehlt' });

  const tasks = {
    'Bundesagentur': bundesagentur(queries, p),
    'Adzuna': adzuna(queries, p),
    'Arbeitnow': arbeitnow(queries, skills, p),
    'Remotive': remotive(queries, p)
  };
  const names = Object.keys(tasks);
  const settled = await Promise.allSettled(names.map(n => tasks[n]));
  const sources = [], jobs = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') { sources.push({ name: names[i], count: s.value.length }); jobs.push(...s.value); }
    else sources.push({ name: names[i], count: 0, error: String(s.reason && s.reason.message || s.reason) });
  });
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  res.status(200).json({ jobs, sources });
};
