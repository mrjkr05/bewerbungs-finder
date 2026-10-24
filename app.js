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
  const hay = ((job.titel || '') + ' ' + (job.beruf || '')).toLowerCase();
  let pts = 0, hits = [];
  const terms = [...skillList(p), ...(search.was || '').split(/\s+/)].map(s => s.toLowerCase()).filter(s => s.length > 2);
  for (const t of new Set(terms)) if (hay.includes(t)) { pts += 20; hits.push(t); }
  const pub = job.aktuelleVeroeffentlichungsdatum ? new Date(job.aktuelleVeroeffentlichungsdatum) : null;
  if (pub) {
    const days = (Date.now() - pub.getTime()) / 864e5;
    pts += Math.max(0, 20 - days * 3);
  }
  if (job.arbeitsort && job.arbeitsort.entfernung != null) pts += Math.max(0, 15 - Number(job.arbeitsort.entfernung) / 3);
  return { pts: Math.min(100, Math.round(pts)), hits };
}

async function runSearch(auto = false) {
  const s = getSearch();
  LS.set('search', s);
  const status = $('#status');
  status.textContent = 'Suche läuft ...';
  const q = new URLSearchParams({
    was: s.was, wo: s.wo, umkreis: s.umkreis, angebotsart: s.angebotsart,
    veroeffentlichtseit: s.tage, size: '50', page: '1'
  });
  try {
    const r = await fetch('/api/jobs?' + q);
    if (!r.ok) throw new Error('Server antwortete mit ' + r.status);
    const data = await r.json();
    const p = getProfile();
    jobs = (data.stellenangebote || []).map(j => ({ ...j, _s: score(j, p, s) }))
      .sort((a, b) => b._s.pts - a._s.pts);
    LS.set('lastRun', todayISO());
    status.textContent = `${jobs.length} Stellen gefunden (${auto ? 'automatisch heute' : 'jetzt'} aktualisiert).`;
    renderJobs();
  } catch (e) {
    status.textContent = 'Fehler: ' + e.message + ' (läuft die Seite auf Vercel mit dem Ordner /api?)';
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
        <div class="meta">Veröffentlicht: ${esc(j.aktuelleVeroeffentlichungsdatum || '–')}</div>
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
const adUrl = (j, d) => (d && d.externeUrl) || 'https://www.arbeitsagentur.de/jobsuche/jobdetail/' + encodeURIComponent(j.refnr);

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
  try {
    const r = await fetch('/api/jobs?detail=' + encodeURIComponent(job.refnr));
    if (r.ok) current.detail = await r.json();
  } catch {}
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

/* ---------- Start ---------- */
$('#todayLabel').textContent = 'Heute: ' + new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
loadProfile();
loadSearch();
// Jeden Tag beim ersten Öffnen automatisch neu suchen
if (LS.get('lastRun', '') !== todayISO()) runSearch(true);
