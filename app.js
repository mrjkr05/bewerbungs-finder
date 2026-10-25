'use strict';
const $ = (s, r = document) => r.querySelector(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const todayDE = () => new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

let jobs = [];
let current = null; // { job, detail }

/* ---------- Profil ---------- */
const profileForm = $('#profileForm');
function loadProfile() {
  const p = LS.get('profile', {});
  for (const el of profileForm.elements) if (el.name && p[el.name] != null) el.value = p[el.name];
}
function getProfile() {
  const p = {};
  for (const el of profileForm.elements) if (el.name) p[el.name] = el.value.trim();
  return p;
}
profileForm.addEventListener('input', () => LS.set('profile', getProfile()));

const lines = t => (t || '').split('\n').map(s => s.trim()).filter(Boolean);
const skillList = p => (p.skills || '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean);

/* ---------- Suche ---------- */
const searchForm = $('#searchForm');
function loadSearch() {
  const s = LS.get('search', null);
  if (s) for (const el of searchForm.elements) if (el.name && s[el.name] != null) el.value = s[el.name];
}
function getSearch() {
  const s = {};
  for (const el of searchForm.elements) if (el.name) s[el.name] = el.value.trim();
  return s;
}

function score(job, p, search) {
  const hay = ((job.titel || '') + ' ' + (job.beruf || '') + ' ' + (job._desc || '').slice(0, 800)).toLowerCase();
  let pts = 0, hits = [];
  const terms = [...skillList(p), ...LS.get('cvTitles', []), ...(search.was || '').split(/[\s,]+/)].map(s => s.toLowerCase()).filter(s => s.length > 2);
  for (const t of new Set(terms)) if (hay.includes(t)) { pts += 20; hits.push(t); }
  const pub = job.aktuelleVeroeffentlichungsdatum ? new Date(job.aktuelleVeroeffentlichungsdatum) : null;
  if (pub) {
    const days = (Date.now() - pub.getTime()) / 864e5;
    pts += Math.max(0, 20 - days * 3);
  }
  if (job.arbeitsort && job.arbeitsort.entfernung != null) pts += Math.max(0, 15 - Number(job.arbeitsort.entfernung) / 3);
  return { pts: Math.min(100, Math.round(pts)), hits };
}

const BA = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4';

async function runSearch(auto = false) {
  const s = getSearch();
  LS.set('search', s);
  const status = $('#status');
  status.textContent = 'Suche läuft ...';
  const queries = (s.was || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 5);
  try {
    const qs = new URLSearchParams({
      was: queries.join(','), wo: s.wo, umkreis: s.umkreis, angebotsart: s.angebotsart,
      tage: s.tage, skills: skillList(getProfile()).slice(0, 8).join(',')
    });
    const r = await fetch('/api/search?' + qs);
    if (!r.ok) throw new Error('Search server answered with status ' + r.status + '. Is api/search.js uploaded?');
    const data = await r.json();
    const p = getProfile();
    const seen = new Map();
    (data.jobs || []).forEach(j => { if (j.refnr && !seen.has(j.refnr)) seen.set(j.refnr, j); });
    jobs = [...seen.values()].map(j => ({ ...j, _s: score(j, p, s) }))
      .sort((a, b) => b._s.pts - a._s.pts).slice(0, 60);
    LS.set('lastRun', todayISO());
    const report = (data.sources || []).map(x => x.error ? `${x.name}: not available` : `${x.name}: ${x.count}`).join(' | ');
    status.textContent = `${jobs.length} jobs found. Sources: ${report}`;
    renderJobs();
  } catch (e) {
    status.textContent = 'Fehler: ' + e.message;
  }
}

function renderJobs() {
  const applied = LS.get('applied', {});
  const box = $('#jobs');
  if (!jobs.length) { box.innerHTML = '<p class="muted">Keine Stellen gefunden. Ändere Stichwort, Ort oder Umkreis.</p>'; return; }
  box.innerHTML = jobs.map((j, i) => {
    const cls = j._s.pts >= 60 ? '' : j._s.pts >= 35 ? 'mid' : 'low';
    const ort = j.arbeitsort ? [j.arbeitsort.plz, j.arbeitsort.ort].filter(Boolean).join(' ') : '';
    const km = j.arbeitsort && j.arbeitsort.entfernung != null ? ` · ${j.arbeitsort.entfernung} km` : '';
    return `<article class="job">
      <div>
        <h3>${esc(j.titel || j.beruf)}${applied[j.refnr] ? '<span class="badge">beworben</span>' : ''}</h3>
        <div class="meta">${esc(j.arbeitgeber || 'Arbeitgeber nicht genannt')} · ${esc(ort)}${km}</div>
        <div class="meta">Veröffentlicht: ${esc(j.aktuelleVeroeffentlichungsdatum || '–')} · Quelle: ${esc(j._src || 'Bundesagentur')}</div>
        <div>${j._s.hits.map(h => `<span class="tag">${esc(h)}</span>`).join('')}</div>
      </div>
      <span class="score ${cls}">${j._s.pts}% Match</span>
      <div class="actions">
        <button class="primary" data-open="${i}">Bewerbung erstellen</button>
        <a class="btn" target="_blank" rel="noopener" href="${esc(adUrl(j))}">Anzeige öffnen</a>
      </div>
    </article>`;
  }).join('');
}
const adUrl = (j, d) => j._url || (d && d.externeUrl) || 'https://www.arbeitsagentur.de/jobsuche/jobdetail/' + encodeURIComponent(j.refnr);

$('#jobs').addEventListener('click', e => {
  const b = e.target.closest('[data-open]');
  if (b) openJob(jobs[Number(b.dataset.open)]);
});

/* ---------- Detail / Modal ---------- */
async function openJob(job) {
  current = { job, detail: null };
  $('#modal').classList.remove('hidden');
  $('#mTitle').textContent = job.titel || job.beruf;
  $('#mSub').textContent = job.arbeitgeber || '';
  $('#tab-company').innerHTML = '<p class="muted">Lade Details ...</p>';
  showTab('company');
  if (job._desc) {
    current.detail = { stellenangebotsBeschreibung: job._desc, firma: job.arbeitgeber, externeUrl: job._url };
  } else {
    try {
      const r = await fetch('/api/jobs?detail=' + encodeURIComponent(job.refnr));
      if (r.ok) current.detail = await r.json();
    } catch {}
    if (!current.detail) {
      try {
        const r = await fetch(BA + '/jobdetails/' + btoa(job.refnr), { headers: { 'X-API-Key': 'jobboerse-jobsuche' } });
        if (r.ok) current.detail = await r.json();
      } catch {}
    }
  }
  renderCompany();
  $('#letterText').value = buildLetter();
  $('#cvPreview').innerHTML = buildCv();
  $('#applyLink').href = adUrl(job, current.detail);
}

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  ['company', 'letter', 'cv'].forEach(t => $('#tab-' + t).classList.toggle('hidden', t !== name));
}
document.querySelector('.tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (b) showTab(b.dataset.tab);
});
$('#closeModal').addEventListener('click', () => $('#modal').classList.add('hidden'));
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); });

function companyName() {
  const d = current.detail || {};
  return d.firma || d.arbeitgeber || current.job.arbeitgeber || '';
}
function jobPlace() {
  const a = current.job.arbeitsort || {};
  return a.ort || '';
}
function adText() {
  const d = current.detail || {};
  return (d.stellenangebotsBeschreibung || '').toString();
}

function renderCompany() {
  const { job, detail } = current;
  const d = detail || {};
  const name = companyName();
  const place = jobPlace();
  const enc = encodeURIComponent;
  const a = job.arbeitsort || {};
  const address = [a.strasse, [a.plz, a.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const links = [
    ['Website suchen', `https://www.google.com/search?q=${enc(name + ' ' + place + ' Karriere')}`],
    ['Kununu', `https://www.kununu.com/de/search?q=${enc(name)}`],
    ['LinkedIn Firma', `https://www.linkedin.com/search/results/companies/?keywords=${enc(name)}`],
    ['LinkedIn Personal / Recruiter', `https://www.linkedin.com/search/results/people/?keywords=${enc(name + ' Recruiter OR Personal OR HR')}`],
    ['LinkedIn IT-Leitung', `https://www.linkedin.com/search/results/people/?keywords=${enc(name + ' IT Leiter')}`],
    ['Xing Firma', `https://www.xing.com/search/companies?keywords=${enc(name)}`],
    ['Google Maps', `https://www.google.com/maps/search/${enc(name + ' ' + place)}`]
  ];
  const desc = adText().replace(/<[^>]+>/g, ' ');
  $('#tab-company').innerHTML = `
    <h3>${esc(name)}</h3>
    <p><b>Standort:</b> ${esc(address || place || '–')}<br>
       <b>Eintritt:</b> ${esc(job.eintrittsdatum || d.eintrittsdatum || '–')}<br>
       <b>Vergütung:</b> ${esc(d.verguetungsangabe || 'nicht angegeben')}<br>
       <b>Referenznummer:</b> ${esc(job.refnr)}</p>
    <h4>Stellenbeschreibung</h4>
    <div class="desc">${esc(desc.trim() || 'Keine Beschreibung geliefert. Öffne die Original-Anzeige.')}</div>
    <h4>Firma und Ansprechpartner recherchieren</h4>
    <div class="links">${links.map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`).join('')}</div>
    <div class="note">Die Bundesagentur-Daten enthalten keine Mitarbeiterliste. Die Links oben öffnen die Suche bei LinkedIn, Xing und Kununu für genau diese Firma, damit du echte Ansprechpartner findest und im Anschreiben eintragen kannst.</div>`;
}

/* ---------- Anschreiben ---------- */
function matchedSkills() {
  const p = getProfile();
  const text = (adText() + ' ' + (current.job.titel || '') + ' ' + (current.job.beruf || '')).toLowerCase();
  return skillList(p).filter(s => text.includes(s.toLowerCase()));
}

function buildLetter() {
  const p = getProfile();
  const { job } = current;
  const title = job.titel || job.beruf || 'die ausgeschriebene Stelle';
  const company = companyName() || 'Ihr Unternehmen';
  const a = job.arbeitsort || {};
  const ms = matchedSkills();
  const allSkills = skillList(p);
  const exp = lines(p.experience)[0];
  const expPart = exp ? exp.split('|').map(s => s.trim()) : [];
  const sender = [p.name, p.street, p.city, p.phone, p.email].filter(Boolean).join('\n');
  const addr = [company, a.strasse, [a.plz, a.ort].filter(Boolean).join(' ')].filter(Boolean).join('\n');
  const skillSentence = ms.length
    ? `Zu meinen Kenntnissen zählen unter anderem ${ms.join(', ')}. Diese passen direkt zu den Anforderungen Ihrer Anzeige.`
    : allSkills.length ? `Zu meinen Kenntnissen zählen unter anderem ${allSkills.slice(0, 6).join(', ')}.` : '';
  const expSentence = expPart.length >= 2
    ? `Aktuell arbeite ich als ${expPart[1]}${expPart[2] ? ' bei ' + expPart[2] : ''}. Dort habe ich gelernt, zuverlässig, strukturiert und im Team zu arbeiten.`
    : '';
  const motivation = p.motivation || `Die Aufgaben als ${title} sprechen mich fachlich sehr an, und ich möchte mich in Ihrem Unternehmen weiterentwickeln.`;
  return `${sender}

${addr}

${jobPlace() || p.city.replace(/^\d+\s*/, '') || 'Ort'}, ${todayDE()}

Bewerbung als ${title}
Referenznummer: ${job.refnr}

Sehr geehrte Damen und Herren,

mit großem Interesse habe ich Ihre Stellenanzeige als ${title} gelesen und bewerbe mich hiermit bei ${company}.

${motivation}

${expSentence}

${skillSentence}

Ich bin motiviert, schnell Verantwortung zu übernehmen und mich in neue Aufgaben einzuarbeiten. Gern überzeuge ich Sie in einem persönlichen Gespräch von mir. Ich freue mich über Ihre Einladung.

Mit freundlichen Grüßen

${p.name || ''}

Anlagen: Lebenslauf, Zeugnisse`.replace(/\n{3,}/g, '\n\n');
}

/* ---------- Lebenslauf ---------- */
function buildCv() {
  const p = getProfile();
  const rows = txt => lines(txt).map(l => {
    const [when, ...rest] = l.split('|').map(s => s.trim());
    return `<div class="cv-row"><div>${esc(when)}</div><div>${rest.map((r, i) => i === 0 ? `<b>${esc(r)}</b>` : esc(r)).join('<br>')}</div></div>`;
  }).join('') || '<p class="muted">Noch nichts eingetragen.</p>';
  const lang = lines(p.languages).map(l => {
    const [n, lv] = l.split('|').map(s => s.trim());
    return `<div class="cv-row"><div>${esc(n)}</div><div>${esc(lv || '')}</div></div>`;
  }).join('');
  const personal = [p.birth && 'Geburtsdatum: ' + p.birth, p.nationality && 'Nationalität: ' + p.nationality].filter(Boolean).join(' · ');
  return `<h1>${esc(p.name || 'Dein Name')}</h1>
    <div class="cv-contact">${esc([p.street, p.city].filter(Boolean).join(', '))}<br>${esc([p.phone, p.email].filter(Boolean).join(' · '))}${personal ? '<br>' + esc(personal) : ''}</div>
    <h3>Berufserfahrung</h3>${rows(p.experience)}
    <h3>Ausbildung</h3>${rows(p.education)}
    <h3>Kenntnisse</h3><p>${esc(skillList(p).join(' · ') || '–')}</p>
    <h3>Sprachen</h3>${lang || '<p class="muted">Noch nichts eingetragen.</p>'}`;
}

/* ---------- Aktionen ---------- */
function printHtml(title, bodyHtml) {
  const w = window.open('', '_blank');
  if (!w) { alert('Bitte Pop-ups erlauben.'); return; }
  w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>body{font-family:Georgia,serif;margin:2.2cm;line-height:1.5;font-size:11pt}h1{margin:0}h3{border-bottom:1px solid #444;margin:16px 0 6px;font-size:11pt;text-transform:uppercase}
  .cv-row{display:grid;grid-template-columns:140px 1fr;gap:10px;margin:4px 0}pre{white-space:pre-wrap;font-family:inherit}</style></head><body>${bodyHtml}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}
$('#printLetter').addEventListener('click', () => printHtml('Anschreiben', `<pre>${esc($('#letterText').value)}</pre>`));
$('#printCv').addEventListener('click', () => printHtml('Lebenslauf', $('#cvPreview').innerHTML));
$('#copyLetter').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#letterText').value); $('#copyLetter').textContent = 'Kopiert'; setTimeout(() => $('#copyLetter').textContent = 'Kopieren', 1500); } catch {}
});
$('#markApplied').addEventListener('click', () => {
  const ap = LS.get('applied', {});
  ap[current.job.refnr] = todayISO();
  LS.set('applied', ap);
  renderJobs();
  $('#modal').classList.add('hidden');
});
$('#profileForm').addEventListener('input', () => { if (current && !$('#modal').classList.contains('hidden')) $('#cvPreview').innerHTML = buildCv(); });

searchForm.addEventListener('submit', e => { e.preventDefault(); runSearch(false); });

/* ---------- Lebenslauf hochladen und analysieren ---------- */
const SKILL_DICT = ['Windows', 'Windows Server', 'Linux', 'Ubuntu', 'Debian', 'macOS', 'Active Directory', 'Netzwerk', 'Netzwerke','TCP/IP', 'DNS', 'DHCP', 'VPN', 'Firewall', 'Cisco', 'VMware', 'Hyper-V', 'Docker', 'Kubernetes', 'Git', 'GitHub', 'Python', 'JavaScript', 'TypeScript', 'Java', 'C#', 'C++', 'PHP', 'SQL', 'MySQL', 'PostgreSQL', 'HTML', 'CSS', 'React', 'Node.js', 'Bash', 'PowerShell', 'Microsoft 365', 'Office 365', 'Excel', 'Hardware', 'Support', 'Helpdesk', 'Server', 'Cloud', 'AWS', 'Azure', 'IT-Sicherheit', 'Datenbank', 'WordPress', 'Android', 'Scrum', 'Jira', 'ITIL'];
const TITLE_RULES = [
  ['Fachinformatiker', /fachinformatiker/i],
  ['Systemadministrator', /system\s?administrat|sysadmin|active directory|windows server|linux/i],
  ['IT-Support', /support|helpdesk|help desk|hardware|troubleshoot|1st level|2nd level/i],
  ['Netzwerktechniker', /netzwerk|network|cisco|tcp\/ip/i],
  ['Softwareentwickler', /python|\bjava\b|javascript|typescript|c#|c\+\+|\bphp\b|softwareentwickl/i],
  ['Webentwickler', /\bhtml\b|\bcss\b|react|wordpress|frontend|webentwickl/i]
];
const HEADERS = {
  experience: ['Berufserfahrung', 'Berufliche Erfahrung', 'Beruflicher Werdegang', 'Werdegang', 'Work Experience', 'Experience', 'Praktische Erfahrung'],
  education: ['Ausbildung', 'Bildung', 'Schulbildung', 'Bildungsweg', 'Education', 'Qualifikationen'],
  skills: ['Kenntnisse', 'IT-Kenntnisse', 'EDV-Kenntnisse', 'Fähigkeiten', 'Skills', 'Kompetenzen'],
  languages: ['Sprachen', 'Sprachkenntnisse', 'Languages']
};

async function fileToText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md')) return file.text();
  const buf = await file.arrayBuffer();
  if (name.endsWith('.docx')) {
    if (!window.mammoth) throw new Error('Die Word-Bibliothek konnte nicht geladen werden (Internet prüfen).');
    return (await mammoth.extractRawText({ arrayBuffer: buf })).value;
  }
  if (name.endsWith('.pdf')) {
    if (!window.pdfjsLib) throw new Error('Die PDF-Bibliothek konnte nicht geladen werden (Internet prüfen).');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let out = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      let lastY = null;
      for (const it of content.items) {
        const y = it.transform[5];
        if (lastY !== null) out += Math.abs(y - lastY) > 2 ? '\n' : ' ';
        out += it.str; lastY = y;
      }
      out += '\n';
    }
    return out;
  }
  throw new Error('Dateityp nicht unterstützt. Bitte PDF, DOCX oder TXT.');
}

function splitSections(text) {
  const groups = { experience: [], education: [], skills: [], languages: [] };
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    let hit = null;
    if (l.length < 40) for (const [g, names] of Object.entries(HEADERS)) {
      if (names.some(n => new RegExp('^' + n.replace(/[-]/g, '\\-') + '\\s*:?$', 'i').test(l))) hit = g;
    }
    if (hit) { cur = hit; continue; }
    if (/^(Persönliche Daten|Kontakt|Interessen|Hobbys|Referenzen|Weiterbildung)\s*:?$/i.test(l)) { cur = null; continue; }
    if (cur) groups[cur].push(l);
  }
  return groups;
}

const dateRow = l => {
  const m = l.match(/^((?:\d{1,2}[.\/])?\d{4}\s*(?:–|-|—|bis)\s*(?:(?:\d{1,2}[.\/])?\d{4}|heute|aktuell|jetzt|present))\s*[:\-–|]?\s*(.*)$/i);
  return m ? `${m[1]} | ${m[2]}` : l;
};

function analyzeText(text) {
  const out = {};
  out.email = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0];
  const ph = text.match(/(?:tel|telefon|mobil|handy|phone)[^\d+]{0,10}((?:\+|0)[\d\s\/\-()]{7,}\d)/i) || text.match(/(\+\d[\d\s\-()]{8,}\d)/);
  if (ph) out.phone = ph[1].trim();
  const head = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 10);
  out.name = head.find(l => /^[A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß\-]+){1,3}$/.test(l) && !/lebenslauf/i.test(l));
  const st = text.match(/([A-ZÄÖÜ][A-Za-zäöüß.\-]*(?:straße|strasse|str\.|weg|platz|allee|gasse|ring)[ \t]*\d+[ \t]?[a-z]?)/);
  if (st) out.street = st[1];
  const pc = text.match(/\b(\d{5})[ \t]+([A-ZÄÖÜ][A-Za-zäöüß\-]+(?:[ \t][A-Za-zäöüß\-]+)?)/);
  if (pc) { out.city = pc[1] + ' ' + pc[2]; out.cityName = pc[2]; }
  const bd = text.match(/(?:geboren|geburtsdatum|geb\.)[^\d]{0,20}(\d{1,2}\.\d{1,2}\.\d{4})/i);
  if (bd) out.birth = bd[1];
  const g = splitSections(text);
  if (g.experience.length) out.experience = g.experience.map(dateRow).join('\n');
  if (g.education.length) out.education = g.education.map(dateRow).join('\n');
  if (g.languages.length) out.languages = g.languages.map(l => l.replace(/\s*[–\-:,]\s*/, ' | ')).join('\n');
  const low = text.toLowerCase();
  const found = SKILL_DICT.filter(s => new RegExp('(^|[^a-z0-9äöü])' + s.toLowerCase().replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + '($|[^a-z0-9äöü])').test(low));
  out.skills = (found.length ? found : g.skills.join(', ').split(/[,;]/).map(s => s.trim()).filter(Boolean)).join(', ');
  out.titles = TITLE_RULES.filter(([, re]) => re.test(text)).map(([t]) => t).slice(0, 4);
  if (!out.titles.length) out.titles = ['IT Support'];
  return out;
}

async function analyzeCv(text) {
  const status = $('#cvStatus');
  if (!text || text.trim().length < 40) { status.textContent = 'Kein Text erkannt. Bei gescannten PDFs bitte den Text unten einfügen.'; return; }
  const a = analyzeText(text);
  const p = getProfile();
  for (const k of ['name', 'street', 'city', 'phone', 'email', 'birth', 'experience', 'education', 'skills', 'languages']) if (a[k]) p[k] = a[k];
  for (const el of profileForm.elements) if (el.name && p[el.name] != null) el.value = p[el.name];
  LS.set('profile', getProfile());
  LS.set('cvText', text.slice(0, 20000));
  LS.set('cvTitles', a.titles);
  searchForm.elements.was.value = a.titles.join(', ');
  if (!searchForm.elements.wo.value.trim() && a.cityName) searchForm.elements.wo.value = a.cityName;
  const skills = skillList(getProfile());
  $('#cvResult').innerHTML = `<p><b>Erkannt:</b> ${esc(a.name || 'Name nicht erkannt')}${a.email ? ' · ' + esc(a.email) : ''}</p>
    <p>Berufe für die Suche: ${a.titles.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</p>
    <p>Skills: ${skills.map(t => `<span class="tag">${esc(t)}</span>`).join('') || '<span class="muted">keine erkannt</span>'}</p>
    <p class="muted">Prüfe das Profil unter "2. Dein Profil" und korrigiere, was nicht stimmt. Dann suchst du einfach neu.</p>`;
  status.textContent = 'Lebenslauf analysiert. Suche läuft ...';
  await runSearch(false);
  status.textContent = 'Fertig. Die besten Stellen stehen unten.';
  $('#jobs').scrollIntoView({ behavior: 'smooth' });
}

$('#cvFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  $('#cvStatus').textContent = 'Lese Datei ...';
  try {
    const text = await fileToText(f);
    $('#cvInput').value = text;
    await analyzeCv(text);
  } catch (err) { $('#cvStatus').textContent = 'Fehler: ' + err.message; }
});
$('#analyzeBtn').addEventListener('click', () => analyzeCv($('#cvInput').value));

/* ---------- Start ---------- */
$('#todayLabel').textContent = 'Heute: ' + new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
loadProfile();
loadSearch();
// Jeden Tag beim ersten Öffnen automatisch neu suchen
const savedCv = LS.get('cvText', '');
if (savedCv) $('#cvInput').value = savedCv;
if (LS.get('search', null) && LS.get('lastRun', '') !== todayISO()) runSearch(true);
