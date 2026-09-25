const crypto = require('crypto');
const { getDb } = require('../lib/db');
const config = require('../config');

function validInitData(initData) {
  if (!initData || typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!receivedHash || !authDate || Date.now() / 1000 - authDate > 86400) return null;
  const dataCheck = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN || config.BOT_TOKEN).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  if (expected.length !== receivedHash.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedHash))) return null;
  let user;
  try { user = JSON.parse(params.get('user') || '{}'); } catch { return null; }
  return user && user.id ? user : null;
}

function formatDate(date) {
  return new Date(date).toLocaleString('en-IN', { timeZone: config.TIMEZONE || 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(404).end();
  const user = validInitData(req.body && req.body.initData);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const db = await getDb();
    const uploads = await db.collection('uploads').find({ userId: user.id }).sort({ createdAt: -1 }).limit(100).toArray();
    const now = Date.now();
    const files = uploads.map((item) => ({
      name: item.fileName,
      size: item.fileSize || 0,
      type: item.type === 'permanent' ? 'Permanent' : 'Temporary',
      live: item.type === 'permanent' || !item.expiresAt || new Date(item.expiresAt).getTime() > now,
      expiresAt: item.expiresAt ? formatDate(item.expiresAt) : null,
      url: item.proxyUrl,
      createdAt: formatDate(item.createdAt),
    }));
    return res.status(200).json({ user: { firstName: user.first_name || '', username: user.username || '' }, files });
  } catch (err) {
    console.error('Mini App error:', err.message);
    return res.status(500).json({ error: 'File manager unavailable' });
  }
};
