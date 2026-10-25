// Vercel serverless proxy for the public job API of the Bundesagentur für Arbeit.
// Needed because the API does not allow direct browser (CORS) requests.
const BASE = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4';
const ALLOWED = ['was', 'wo', 'umkreis', 'angebotsart', 'veroeffentlichtseit', 'size', 'page', 'arbeitszeit', 'befristung'];
const HEADERS = {
  'User-Agent': 'Jobsuche/2.9.2 (de.arbeitsagentur.jobboerse; build:1077; iOS 15.1.0) Alamofire/5.4.4',
  'X-API-Key': 'jobboerse-jobsuche',
  'Accept': 'application/json',
  'Accept-Language': 'de-DE,de;q=0.9',
  'Connection': 'keep-alive'
};

module.exports = async (req, res) => {
  const q = req.query || {};
  try {
    let url;
    if (q.detail) {
      url = BASE + '/jobdetails/' + Buffer.from(String(q.detail)).toString('base64');
    } else {
      const p = new URLSearchParams();
      for (const k of ALLOWED) if (q[k]) p.set(k, String(q[k]));
      url = BASE + '/jobs?' + p.toString();
    }
    const r = await fetch(url, { headers: HEADERS });
    const text = await r.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!r.ok) {
      // Report what the upstream API said, so the page can show the real reason.
      return res.status(r.status).json({ error: 'Bundesagentur-API antwortete mit ' + r.status, detail: text.slice(0, 300) });
    }
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    res.status(200).send(text);
  } catch (e) {
    res.status(500).json({ error: 'Proxy-Fehler', detail: String(e) });
  }
};
