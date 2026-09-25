const crypto = require('crypto');
const { getDb } = require('../lib/db');
const config = require('../config');

function validate(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!hash || !authDate || Date.now() / 1000 - authDate > 86400) return null;
  const check = [...params.entries()].filter(([k]) => k !== 'hash').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN || config.BOT_TOKEN).digest();
  const expected = crypto.createHmac('sha256', secret).update(check).digest('hex');
  if (hash.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected))) return null;
  try { const user = JSON.parse(params.get('user') || '{}'); return user.id ? user : null; } catch { return null; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(404).end();
  const user = validate(req.body && req.body.initData);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const count = Number(req.body.rows);
  const values = Array.isArray(req.body.values) ? req.body.values.slice(0, 2).map((v) => String(v || '').slice(0, 10000)) : [];
  if (![1, 2].includes(count) || values.length !== count || values.some((v) => !v.trim())) return res.status(400).json({ error: 'Please fill every row.' });
  try {
    const db = await getDb();
    const key = crypto.randomBytes(8).toString('base64url');
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
    await db.collection('rows').insertOne({ key, userId: user.id, values, createdAt: new Date(), expiresAt });
    const domain = String(config.DOMAIN).replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return res.status(200).json({ url: `https://${domain}/row/${key}`, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    console.error('row save error:', err.message);
    return res.status(500).json({ error: 'Could not save the row.' });
  }
};
