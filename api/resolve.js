// Middleware isse poochta hai: key "aB3xK9pQ" ki asli file kahan hai?
// Sirf middleware call kar sakta hai (secret header ke saath).

const { getDb } = require('../lib/db');

const config = require('../config');

const SECRET = config.PROXY_SECRET;
const UA = 'Mozilla/5.0 (compatible; FileProxy/1.0)';
const PUBLIC_URL = `https://${String(config.DOMAIN).replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;

// tmpfiles ka download token kuch minute mein expire hota hai, isliye har baar naya nikalte hain
async function freshTempLink(pageUrl) {
  const res = await fetch(pageUrl, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const html = await res.text();
  const abs = html.match(/https?:\/\/tmpfiles\.org\/dl\/[^"'\s<>]+/i);
  if (abs) return abs[0].replace(/&amp;/g, '&').replace(/^http:/, 'https:');
  const rel = html.match(/["'](\/dl\/[^"'\s<>]+)["']/i);
  if (rel) return 'https://tmpfiles.org' + rel[1].replace(/&amp;/g, '&');
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!SECRET || req.headers['x-proxy-secret'] !== SECRET) {
    return res.status(401).json({ status: 401 });
  }

  const key = String(req.query.key || '');
  if (!/^[A-Za-z0-9]{4,20}$/.test(key)) return res.status(200).json({ status: 404 });

  try {
    const db = await getDb();
    const doc = await db
      .collection('uploads')
      .findOne({ key }, { projection: { type: 1, origin: 1, expiresAt: 1 } });

    if (!doc || !doc.origin) return res.status(200).json({ status: 404 });

    if (doc.type === 'permanent') {
      if (String(doc.origin).startsWith('db:')) {
        return res.status(200).json({
          status: 200,
          target: `${PUBLIC_URL}/api/download?id=${encodeURIComponent(String(doc.origin).slice(3))}`,
        });
      }
      return res.status(200).json({ status: 200, target: doc.origin });
    }

    if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) {
      return res.status(200).json({ status: 410 });
    }
    const link = await freshTempLink(doc.origin);
    if (!link) return res.status(200).json({ status: 410 });
    return res.status(200).json({ status: 200, target: link });
  } catch (err) {
    console.error('resolve error:', err);
    return res.status(200).json({ status: 502 });
  }
};
