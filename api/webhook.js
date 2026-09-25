// Telegram File Uploader Bot — Vercel (webhook) version
// 5 buttons: 60 min / 6h / 24h / 48h (temporary) + Permanent
// User ko sirf apna link milta hai: https://<app>/file/<randomkey>.<ext>

const { waitUntil } = require('@vercel/functions');
const crypto = require('crypto');
const { getDb } = require('../lib/db');

const config = require('../config');
const EMOJI = require('../emoji');

// <tg-emoji emoji-id="...">🔥</tg-emoji>  (ID na ho to normal emoji)
function E(key) {
  const v = EMOJI[key];
  if (!v) return '';
  const [id, fallback] = v;
  return id ? `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>` : fallback;
}

// HTML mode mein file name / error text safe karne ke liye
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const TOKEN = process.env.BOT_TOKEN || config.BOT_TOKEN;
const WEBHOOK_SECRET = crypto.createHash('sha256').update(`webhook:${TOKEN}`).digest('hex').slice(0, 48); // automatic
const CATBOX_USERHASH = process.env.CATBOX_USERHASH || config.CATBOX_USERHASH || '';
const TIMEZONE = config.TIMEZONE || 'Asia/Kolkata';
const ALLOWED_USERS = (config.ALLOWED_USERS || []).map(String);
const PUBLIC_URL = `https://${String(config.DOMAIN).replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
const MINI_APP_URL = `${PUBLIC_URL}/app`;
const START_VIDEO_URL = `${PUBLIC_URL}/file/F565zkpM.mp4`;

const API = `https://api.telegram.org/bot${TOKEN}`;
const TG_DOWNLOAD_LIMIT = 20 * 1024 * 1024; // Telegram bots max 20 MB download kar sakte hain

const EXPIRE_OPTIONS = [
  ['60 min', 3600],
  ['6 hours', 21600],
  ['24 hours', 86400],
  ['48 hours', 172800],
];

// ---------- Short link: /file/<randomkey>.<ext> ----------
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // confusing chars (0 O 1 l I) hata diye

function randomKey(len = 8) {
  const bytes = crypto.randomBytes(len);
  let key = '';
  for (const b of bytes) key += ALPHABET[b % ALPHABET.length];
  return key;
}

function getExt(name) {
  const m = String(name).match(/\.([A-Za-z0-9]{1,10})$/);
  return m ? m[1].toLowerCase() : '';
}

// Upload ka record save karke short link return karta hai
async function createLink(doc) {
  let db;
  try {
    db = await getDb();
  } catch (err) {
    console.error('MongoDB error:', err.message);
    throw new Error('Could not connect to the database, so the link was not created');
  }
  const ext = getExt(doc.fileName);
  for (let i = 0; i < 5; i++) {
    const key = randomKey();
    const proxyUrl = `${PUBLIC_URL}/file/${key}${ext ? '.' + ext : ''}`;
    try {
      await db.collection('uploads').insertOne({ ...doc, key, ext, proxyUrl, createdAt: new Date() });
      return proxyUrl;
    } catch (err) {
      if (err.code === 11000) continue; // key already hai, nayi banao
      console.error('MongoDB insert error:', err.message);
      throw new Error('Could not save the link. Please try again');
    }
  }
  throw new Error('Could not create the link. Please try again');
}

// DB fail ho to bhi bot na ruke (user save, history)
async function safeDb(fn) {
  try {
    return await fn(await getDb());
  } catch (err) {
    console.error('MongoDB error:', err.message);
  }
  return null;
}

function saveUser(from) {
  return safeDb((db) =>
    db.collection('users').updateOne(
      { _id: from.id },
      {
        $set: { firstName: from.first_name || '', username: from.username || '', lastSeen: new Date() },
        $setOnInsert: { joinedAt: new Date() },
      },
      { upsert: true }
    )
  );
}

async function sendHistory(chatId, userId) {
  const list = await safeDb((db) =>
    db.collection('uploads').find({ userId }).sort({ createdAt: -1 }).limit(10).toArray()
  );
  if (!list) return tg('sendMessage', { chat_id: chatId, text: `${E('warning')} History is temporarily unavailable. Please try again later.` });
  if (list.length === 0) return tg('sendMessage', { chat_id: chatId, text: `${E('empty')} You have no uploads yet.` });

  const now = Date.now();
  const lines = list.map((u, i) => {
    let status;
    if (u.type === 'permanent') status = `${E('permanent')} Permanent • Live`;
    else if (u.expiresAt && new Date(u.expiresAt).getTime() < now) status = `${E('expired')} Temporary • Expired`;
    else status = `${E('calendar')} Temporary • Live until ${formatDate(u.expiresAt)}`;
    return `<b>${i + 1}. ${esc(u.fileName)}</b> (${formatSize(u.fileSize)})\n${status}\n${E('link')} ${esc(u.proxyUrl)}`;
  });

  return tg('sendMessage', {
    chat_id: chatId,
    text: `${E('history')} <b>Your last ${list.length} uploads:</b>\n\n${lines.join('\n\n')}`,
    disable_web_page_preview: true,
  });
}

// ---------- Helpers ----------
async function callTg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

const HTML_METHODS = new Set(['sendMessage', 'editMessageText']);

async function tg(method, body = {}) {
  if (HTML_METHODS.has(method) && !body.parse_mode) body = { ...body, parse_mode: 'HTML' };
  let json = await callTg(method, body);

  // Agar Telegram custom emoji reject kare to normal emoji ke saath dobara bhejo
  if (!json.ok && typeof body.text === 'string' && body.text.includes('<tg-emoji') && /emoji|entit/i.test(json.description || '')) {
    const plain = body.text.replace(/<tg-emoji[^>]*>(.*?)<\/tg-emoji>/g, '$1');
    json = await callTg(method, { ...body, text: plain });
  }
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
  return json.result;
}

function isAllowed(userId) {
  return ALLOWED_USERS.length === 0 || ALLOWED_USERS.includes(String(userId));
}

function formatSize(bytes) {
  if (!bytes) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(date) {
  return new Date(date).toLocaleString('en-IN', { timeZone: TIMEZONE, dateStyle: 'medium', timeStyle: 'short' });
}

function extractFile(msg) {
  if (!msg) return null;
  if (msg.document) {
    const d = msg.document;
    return { fileId: d.file_id, name: d.file_name || `file_${d.file_unique_id}`, size: d.file_size };
  }
  if (msg.photo) {
    const p = msg.photo[msg.photo.length - 1];
    return { fileId: p.file_id, name: `photo_${p.file_unique_id}.jpg`, size: p.file_size };
  }
  if (msg.video) {
    const v = msg.video;
    return { fileId: v.file_id, name: v.file_name || `video_${v.file_unique_id}.mp4`, size: v.file_size };
  }
  if (msg.audio) {
    const a = msg.audio;
    return { fileId: a.file_id, name: a.file_name || `audio_${a.file_unique_id}.mp3`, size: a.file_size };
  }
  if (msg.voice) {
    const v = msg.voice;
    return { fileId: v.file_id, name: `voice_${v.file_unique_id}.ogg`, size: v.file_size };
  }
  if (msg.animation) {
    const a = msg.animation;
    return { fileId: a.file_id, name: a.file_name || `gif_${a.file_unique_id}.mp4`, size: a.file_size };
  }
  if (msg.video_note) {
    const v = msg.video_note;
    return { fileId: v.file_id, name: `videonote_${v.file_unique_id}.mp4`, size: v.file_size };
  }
  return null;
}

function uploaderInfo(from) {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'User';
  return `${E('name')} ${esc(name)}\n${E('uid')} <code>${from.id}</code>`;
}

function fileInfo(item) {
  return `${E('file')} <b>${esc(item.name)}</b>\n${E('size')} ${formatSize(item.size)}`;
}

// 5 buttons: 4 temporary + 1 permanent
const uploadKeyboard = () => ({
  inline_keyboard: [
    [
      { text: `⏳ ${EXPIRE_OPTIONS[0][0]}`, callback_data: `e:${EXPIRE_OPTIONS[0][1]}` },
      { text: `⏳ ${EXPIRE_OPTIONS[1][0]}`, callback_data: `e:${EXPIRE_OPTIONS[1][1]}` },
    ],
    [
      { text: `⏳ ${EXPIRE_OPTIONS[2][0]}`, callback_data: `e:${EXPIRE_OPTIONS[2][1]}` },
      { text: `⏳ ${EXPIRE_OPTIONS[3][0]}`, callback_data: `e:${EXPIRE_OPTIONS[3][1]}` },
    ],
    [{ text: '♾️ Permanent', callback_data: 'p' }],
  ],
});

const startKeyboard = () => ({
  inline_keyboard: [
    [{ text: 'Upload a file', web_app: { url: MINI_APP_URL } }],
    [{ text: 'Open file manager', web_app: { url: MINI_APP_URL } }],
    [{ text: 'Create 1-row paste', web_app: { url: `${MINI_APP_URL}?row=1` } }, { text: 'Create 2-row paste', web_app: { url: `${MINI_APP_URL}?row=2` } }],
    [{ text: 'View history', callback_data: 'history' }],
  ],
});

// ---------- Download / Upload ----------
async function downloadTelegramFile(fileId) {
  const file = await tg('getFile', { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`);
  if (!res.ok) throw new Error(`Telegram download failed (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// Returns "<id>/<name>" (tmpfiles page path)
async function uploadTemp(buffer, name, expire) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), name);
  form.append('expire', String(expire));

  const res = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: form });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The temporary upload service returned an invalid response');
  }
  const m = json && json.data && typeof json.data.url === 'string' && json.data.url.match(/tmpfiles\.org\/(.+)$/);
  if (json.status !== 'success' || !m) throw new Error('Temporary upload failed');
  return m[1].replace(/^dl\//, '');
}

// OnlyFiles supports images, videos, archives and other file types up to
// 100 MB. expire=0 requests provider-side permanent retention.
async function uploadPermanent(buffer, name) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), name || 'file');
  form.append('expire', '0');
  const res = await fetch('https://api.onlyfiles.com/v1/upload', {
    method: 'POST',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FileUploaderBot/1.0)' },
    body: form,
  });
  const text = (await res.text()).trim();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The permanent upload service returned an invalid response');
  }
  const url = json && json.status === true && json.data && json.data.file && json.data.file.url && json.data.file.url.full;
  if (!res.ok || typeof url !== 'string') {
    console.error('onlyfiles response:', text.slice(0, 200));
    throw new Error(`Permanent upload failed: ${(json.error && json.error.message) || 'OnlyFiles rejected the file'}`);
  }
  return url;
}

// ---------- Handlers ----------
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  if (!msg.from || !isAllowed(msg.from.id)) return;

  await saveUser(msg.from);

  if (msg.text && msg.text.startsWith('/history')) return sendHistory(chatId, msg.from.id);

  const rowMatch = msg.text && msg.text.match(/^\/row\s+([12])(?:@\w+)?$/i);
  if (rowMatch) {
    const count = Number(rowMatch[1]);
    return tg('sendMessage', {
      chat_id: chatId,
      text: `<b>Create ${count} row${count > 1 ? 's' : ''}</b>\n\nThe Mini App will expire after 2 minutes.`,
      reply_markup: { inline_keyboard: [[{ text: `Open ${count}-row editor`, web_app: { url: `${MINI_APP_URL}?row=${count}` } }]] },
    });
  }

  if (msg.text && msg.text.startsWith('/start')) {
    try {
      return await tg('sendVideo', {
        chat_id: chatId,
        video: START_VIDEO_URL,
        caption: '<b>Welcome to File Uploader Bot</b>\n\nUpload files, create temporary or permanent links, and manage all your links from the file manager.\n\nMaximum Telegram download size: 20 MB.',
        reply_markup: startKeyboard(),
      });
    } catch (err) {
      console.error('start video error:', err.message);
      return tg('sendMessage', {
        chat_id: chatId,
        text: '<b>Welcome to File Uploader Bot</b>\n\nUse the buttons below to upload files or open your file manager.',
        reply_markup: startKeyboard(),
      });
    }
  }

  const f = extractFile(msg);
  if (!f) return; // Ignore unrelated text and unsupported messages silently.

  if (f.size && f.size > TG_DOWNLOAD_LIMIT) {
    return tg('sendMessage', {
      chat_id: chatId,
      text: `${E('error')} This file is ${formatSize(f.size)}. The Telegram bot can download files up to 20 MB.`,
      reply_to_message_id: msg.message_id,
    });
  }

  await tg('sendMessage', {
    chat_id: chatId,
    text: `${fileInfo(f)}\n\nChoose how long this link should stay available:`,
    reply_to_message_id: msg.message_id,
    reply_markup: uploadKeyboard(),
  });
}

async function handleCallback(q) {
  const [action, extra] = (q.data || '').split(':');
  const msg = q.message;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const orig = msg.reply_to_message;

  const edit = (text, reply_markup) =>
    tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup,
      disable_web_page_preview: true,
    }).catch(() => {});
  const answer = (text, show_alert = false) =>
    tg('answerCallbackQuery', { callback_query_id: q.id, text, show_alert }).catch(() => {});

  if (!isAllowed(q.from.id)) return answer('You are not allowed to use this bot.');
  if (q.data === 'history') {
    await answer();
    return sendHistory(chatId, q.from.id);
  }

  const item = extractFile(orig);
  if (!item) {
    await answer('The original file was not found. Please send it again.', true);
    return edit(`${E('warning')} The original file was not found. Please send it again.`);
  }
  if (orig.from && orig.from.id !== q.from.id) return answer('This button belongs to another user.');

  await answer();
  if (action !== 'e' && action !== 'p') return;

  try {
    await edit(`${fileInfo(item)}\n\n${E('wait')} Downloading the file...`); // buttons hat jaate hain, double upload nahi hoga
    const buffer = await downloadTelegramFile(item.fileId);
    await edit(`${fileInfo(item)}\n\n${E('auto')} Uploading the file...`);

    if (action === 'e') {
      const sec = EXPIRE_OPTIONS.some(([, s]) => s === Number(extra)) ? Number(extra) : 3600;
      const originPath = await uploadTemp(buffer, item.name, sec);
      const expiresAt = new Date(Date.now() + sec * 1000);
      const proxyUrl = await createLink({
        userId: q.from.id,
        type: 'temporary',
        fileName: item.name,
        fileSize: item.size || buffer.length,
        origin: `https://tmpfiles.org/${originPath}`, // sirf DB mein, user ko nahi dikhta
        expireSeconds: sec,
        expiresAt,
      });

      await edit(
        `${E('success')} <b>Upload complete.</b>\n\n${fileInfo(item)}\n${uploaderInfo(q.from)}\n${E('calendar')} Expires: ${formatDate(expiresAt)}\n\n${E('download')} <b>Download link:</b>\n${esc(proxyUrl)}`,
        { inline_keyboard: [[{ text: '⬇️ Download', url: proxyUrl }]] }
      );
    } else {
      const originPath = await uploadPermanent(buffer, item.name);
      const proxyUrl = await createLink({
        userId: q.from.id,
        type: 'permanent',
        fileName: item.name,
        fileSize: item.size || buffer.length,
        origin: originPath,
      });

      await edit(`${E('success')} <b>Permanent upload complete.</b>\n\n${fileInfo(item)}\n${uploaderInfo(q.from)}\n${E('permanent')} Stored permanently by the file host\n\n${E('download')} <b>Download link:</b>\n${esc(proxyUrl)}`, {
        inline_keyboard: [[{ text: '⬇️ Download', url: proxyUrl }]],
      });
    }
  } catch (err) {
    console.error('Upload error:', err);
    await edit(`${E('error')} ${esc(err.message)}\n\nPlease try again:`, uploadKeyboard());
  }
}

async function handleUpdate(update) {
  if (update.message) return handleMessage(update.message);
  if (update.callback_query) return handleCallback(update.callback_query);
}

// ---------- Vercel entry ----------
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(404).end();
  if (!TOKEN) return res.status(500).send('BOT_TOKEN missing');
  if (req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
    return res.status(401).send('unauthorized');
  }
  waitUntil(handleUpdate(req.body || {}).catch((err) => console.error('Update error:', err)));
  res.status(200).send('ok');
};
