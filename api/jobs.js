// Vercel serverless proxy for the public job API of the Bundesagentur für Arbeit.
// Needed because the API does not allow direct browser (CORS) requests.
const BASE = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4';
const ALLOWED = ['was', 'wo', 'umkreis', 'angebotsart', 'veroeffentlichtseit', 'size', 'page', 'arbeitszeit', 'befristung'];

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
    const r = await fetch(url, { headers: { 'X-API-Key': 'jobboerse-jobsuche' } });
    const text = await r.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    res.status(r.status).send(text);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
