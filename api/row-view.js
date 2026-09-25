const { getDb } = require('../lib/db');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = async (req, res) => {
  const key = String(req.query.key || '');
  if (!/^[A-Za-z0-9_-]{8,24}$/.test(key)) return res.status(404).end();
  try {
    const db = await getDb();
    const row = await db.collection('rows').findOne({ key });
    if (!row || new Date(row.expiresAt).getTime() <= Date.now()) {
      return res.status(410).send('<!doctype html><title>Row expired</title><h2>This row has expired.</h2><p>Create a new row from the bot.</p>');
    }
    const cards = row.values.map((value, i) => `<section><h3>Row ${i + 1}</h3><pre>${escapeHtml(value)}</pre></section>`).join('');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.status(200).send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved rows</title><style>body{font-family:system-ui;background:#10131a;color:#f5f7fb;padding:24px;max-width:800px;margin:auto}section{background:#181e29;border:1px solid #2a3444;border-radius:14px;padding:16px;margin:14px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;color:#dbe5f5}</style><h1>Saved rows</h1>${cards}<p>This link expires automatically in two minutes.</p>`);
  } catch (err) {
    console.error('row view error:', err.message);
    return res.status(500).send('Unavailable');
  }
};
