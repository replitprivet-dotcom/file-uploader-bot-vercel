// Automatic webhook setup.
// - https://cloud.co08.art kholte hi webhook set ho jata hai
// - Vercel cron roz ek baar check karta hai (vercel.json)

const crypto = require('crypto');
const config = require('../config');

const TOKEN = process.env.BOT_TOKEN || config.BOT_TOKEN;
const DOMAIN = String(config.DOMAIN).replace(/^https?:\/\//, '').replace(/\/+$/, '');
const WEBHOOK_URL = `https://${DOMAIN}/api/webhook`;
const WEBHOOK_SECRET = crypto.createHash('sha256').update(`webhook:${TOKEN}`).digest('hex').slice(0, 48);

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

function html(res, status, icon, title, lines) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#111;color:#eee;text-align:center">` +
      `<div style="padding:24px"><div style="font-size:56px">${icon}</div><h2>${title}</h2>` +
      lines.map((l) => `<p style="color:#aaa">${l}</p>`).join('') +
      `</div></body>`
  );
}

module.exports = async (req, res) => {
  // This endpoint is for the scheduled Vercel cron only; do not expose bot
  // status, username, or Telegram configuration to public visitors.
  if (req.headers['x-vercel-cron'] !== '1') return res.status(404).end();
  if (!TOKEN || TOKEN.startsWith('YAHAN_')) {
    return html(res, 500, '⚠️', 'Setup adhoora hai', ['config.js mein BOT_TOKEN daalo aur redeploy karo.']);
  }
  if (!config.MONGODB_URI || config.MONGODB_URI.startsWith('YAHAN_')) {
    return html(res, 500, '⚠️', 'Setup adhoora hai', ['config.js mein MONGODB_URI daalo aur redeploy karo.']);
  }

  try {
    const me = await tg('getMe');
    if (!me.ok) return html(res, 500, '❌', 'Bot token galat hai', [me.description || '']);

    const info = await tg('getWebhookInfo');
    let changed = false;

    // Sirf tab set karo jab URL alag ho (warna har baar reset nahi karna)
    if (!info.ok || info.result.url !== WEBHOOK_URL) {
      const set = await tg('setWebhook', {
        url: WEBHOOK_URL,
        secret_token: WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'],
      });
      if (!set.ok) return html(res, 500, '❌', 'Webhook set nahi hua', [set.description || '']);
      changed = true;
    }

    await tg('setMyCommands', {
      commands: [
        { command: 'start', description: 'Bot shuru karo' },
        { command: 'history', description: 'Aapke last 10 uploads' },
        { command: 'row', description: 'Create a temporary text row' },
      ],
    });

    const lastError = info.ok && info.result.last_error_message && !changed
      ? `Last error: ${info.result.last_error_message}`
      : '';

    return html(res, 200, '✅', `@${me.result.username} chal raha hai`, [
      changed ? 'Webhook abhi set kiya gaya.' : 'Webhook pehle se set hai.',
      `Telegram pe bot ko /start bhejo.`,
      lastError,
    ].filter(Boolean));
  } catch (err) {
    console.error('setup error:', err);
    return html(res, 500, '❌', 'Error', [String(err.message || err)]);
  }
};
