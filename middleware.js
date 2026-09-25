// https://<app>/file/<randomkey>.<ext>
// Key se asli file dhoondh ke Vercel peeche se file la ke deta hai (proxy).
// User ke browser mein sirf aapka domain dikhta hai.

export const config = { matcher: '/file/:path*' };

// config.js ke PROXY_SECRET jaisa hi hona chahiye (automatic set hai)
const SECRET = 'r-9RyGZvIHx2bKY3qCUocZFadnzai2gbPXywbaBi6ic';

function page(status, title, msg) {
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;text-align:center;background:#111;color:#eee">` +
      `<div><h2>${title}</h2><p>${msg}</p></div></body>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
  );
}

// Redirect nahi — Vercel is URL se response la ke user ko deta hai
function proxyTo(target) {
  return new Response(null, { headers: { 'x-middleware-rewrite': target } });
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/file\/([A-Za-z0-9]{4,20})(?:\.[A-Za-z0-9]{1,10})?\/?$/);
  if (!m) return page(404, 'File nahi mili', 'Ye link galat hai.');

  let data;
  try {
    const r = await fetch(new URL(`/api/resolve?key=${m[1]}`, url.origin), {
      headers: { 'x-proxy-secret': SECRET },
    });
    data = await r.json();
  } catch (err) {
    console.error('resolve fetch error:', err);
    return page(502, 'Error', 'File abhi load nahi ho payi. Thodi der baad try karo.');
  }

  if (data.status === 200 && data.target) return proxyTo(data.target);
  if (data.status === 410) {
    return page(410, 'File expire ho gayi', 'Is file ka time khatam ho gaya hai aur ise delete kar diya gaya hai.');
  }
  if (data.status === 502) return page(502, 'Error', 'File abhi load nahi ho payi. Thodi der baad try karo.');
  return page(404, 'File nahi mili', 'Ye link galat hai ya file delete ho chuki hai.');
}
