import html from './index.html';
import docsHtml from './docs.html';
import apiDocs from './api-docs.txt';
import styleCss from './style.txt';
import { DateTime } from 'luxon';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const PASTEBIN_KV = env.Pastebin;
    const API_SECRET = env.API_KEY;
    const corsHeaders = getCORSHeaders();

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Serve static assets
    if (path === '/' || path === '') {
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html', ...corsHeaders } });
    }
    if (path === '/docs' || path === '/docs/') {
      return new Response(docsHtml, { status: 200, headers: { 'Content-Type': 'text/html', ...corsHeaders } });
    }
    if (path === '/style.css') {
      return new Response(styleCss, { status: 200, headers: { 'Content-Type': 'text/css', ...corsHeaders } });
    }

    // API routes
    if (path.startsWith('/api/')) {
      // List all non-expired pastes
      if (path === '/api/pastes' && method === 'GET') {
        const ua = (request.headers.get('User-Agent') || '').toLowerCase();
        const isCli = /curl|wget|httpie|python-requests|node-fetch|go-http-client/.test(ua);

        const listResponse = await PASTEBIN_KV.list();
        const now = Date.now();

        const entries = await Promise.all(
          listResponse.keys.map(async keyInfo => {
            const slug = keyInfo.name;
            const raw = await PASTEBIN_KV.get(slug);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (data.metadata.expiresAtUtc <= now) {
              await PASTEBIN_KV.delete(slug);
              return null;
            }
            return {
              slug,
              text: data.text,
              metadata: {
                ...data.metadata,
                expirationInSeconds: Math.floor((data.metadata.expiresAtUtc - now) / 1000)
              }
            };
          })
        );
        const pastes = entries.filter(e => e);

        if (isCli) {
          return new Response(JSON.stringify(pastes), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        } else {
          const listItems = pastes.map(p =>
            `<li><a href="/api/view/${p.slug}">${p.slug}</a> — expires in ${p.metadata.expirationInSeconds}s</li>`
          ).join('\n');

          const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>All Pastes</title>
</head>
<body>
  <h1>All Non-expired Pastes</h1>
  <ul>
    ${listItems}
  </ul>
</body>
</html>`;

          return new Response(body, {
            status: 200,
            headers: { 'Content-Type': 'text/html', ...corsHeaders }
          });
        }
      }

      // API docs
      if (path === '/api/docs' || path === '/api/docs/') {
        return new Response(apiDocs, { status: 200, headers: { 'Content-Type': 'text/markdown', ...corsHeaders } });
      }

      // Authentication
      if (path === '/api/auth') {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || authHeader !== `Bearer ${API_SECRET}`) {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      // Create paste (with optional password)
      if (path === '/api/create' && method === 'POST') {
        let raw;
        try {
          raw = await request.text();
        } catch {
          return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        let body;
        try {
          const sanitized = raw.replace(/[“”]/g, '"');
          body = JSON.parse(sanitized);
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        const { text, expiration, slug, password } = body;

        const userTZ = (request.cf && request.cf.timezone) || 'America/Chicago';
        const dtExpires = DateTime.fromFormat(expiration, 'yyyy-MM-dd hh:mm a', { zone: userTZ });
        if (!dtExpires.isValid) {
          return new Response(JSON.stringify({ success: false, error: 'Bad expiration format' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        const expiresAtUtc = dtExpires.toUTC().toMillis();
        const nowUtc = Date.now();
        const expirationInSeconds = Math.max(0, Math.floor((expiresAtUtc - nowUtc) / 1000));
        const formattedExpiration = dtExpires.setZone(userTZ).toLocaleString(DateTime.DATETIME_FULL);

        const dtCreated = DateTime.fromMillis(nowUtc).setZone(userTZ);
        const formattedCreated = dtCreated.toLocaleString(DateTime.DATETIME_FULL);
        const tzAbbr = dtCreated.offsetNameShort;
        const isDST = dtCreated.isInDST;
        const generatedSlug = slug || generateRandomSlug();

        await PASTEBIN_KV.put(
          generatedSlug,
          JSON.stringify({
            text,
            metadata: {
              expiresAtUtc,
              formattedExpiration,
              formattedCreated,
              tzAbbr,
              isDST,
              ...(password ? { password } : {})
            }
          })
        );

        return new Response(
          JSON.stringify({ success: true, slug: generatedSlug, expirationInSeconds, formattedExpiration, formattedCreated, timezone: tzAbbr, isDST }),
          { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      // Delete paste
      if (path === '/api/delete' && method === 'DELETE') {
        const { slug } = await request.json();
        if (!slug) {
          return new Response(JSON.stringify({ success: false, error: 'Missing slug' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        await PASTEBIN_KV.delete(slug);
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      // View paste JSON
      if (path === '/api/view' && method === 'GET') {
        const slug = url.searchParams.get('slug');
        if (!slug) {
          return new Response(JSON.stringify({ success: false, error: 'Missing slug' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        const raw = await PASTEBIN_KV.get(slug);
        if (!raw) {
          return new Response(JSON.stringify({ success: false, error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        const data = JSON.parse(raw);
        const nowUtc = Date.now();
        if (nowUtc >= data.metadata.expiresAtUtc) {
          await PASTEBIN_KV.delete(slug);
          return new Response(JSON.stringify({ success: false, error: 'Expired' }), { status: 404,	headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        const expirationInSeconds = Math.floor((data.metadata.expiresAtUtc - nowUtc) / 1000);
        return new Response(JSON.stringify({ success: true, text: data.text, metadata: { ...data.metadata, expirationInSeconds } }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      // View paste HTML with password protection
      if (path.startsWith('/api/view/') && (method === 'GET' || method === 'POST')) {
        const slug = path.replace('/api/view/', '');
        const raw = await PASTEBIN_KV.get(slug);
        if (!raw) return new Response('Not Found', { status: 404, headers: corsHeaders });
        const data = JSON.parse(raw);
        const nowUtc = Date.now();
        if (nowUtc >= data.metadata.expiresAtUtc) {
          await PASTEBIN_KV.delete(slug);
          return new Response('Expired', { status: 404, headers: corsHeaders });
        }
        const pwd = data.metadata.password;
        // No password, render immediately
        if (!pwd) {
          return new Response(renderPastePage(data.text, slug, data.metadata), { status: 200, headers: { 'Content-Type': 'text/html', ...corsHeaders } });
        }
        // GET → show unlock form
        if (method === 'GET') {
          return new Response(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Unlock Paste</title></head>
<body>
  <form method="POST">
    <label>Password: <input name="password" type="password" required autofocus/></label>
    <button type="submit">View Paste</button>
  </form>
</body>
</html>`, { status: 200, headers: { 'Content-Type': 'text/html', ...corsHeaders } });
        }
        // POST → verify
        const formData = await request.formData();
        const attempt = formData.get('password') || '';
        if (attempt !== pwd) {
          return new Response(`<script>alert('Incorrect password');window.close();</script>`, { status: 200, headers: { 'Content-Type': 'text/html', ...corsHeaders } });
        }
        // Correct, render
        return new Response(renderPastePage(data.text, slug, data.metadata), { status: 200, headers: { 'Content-Type': 'text/html', ...corsHeaders } });
      }
    }

    // Default HTML view → redirect to /api/view/:slug
    if (method === 'GET') {
      const slug = path.startsWith('/') ? path.slice(1) : path;
      return Response.redirect(`${url.origin}/api/view/${slug}`, 307);
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};

// Helpers
function getCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function generateRandomSlug() {
  return [...Array(6)].map(() => Math.random().toString(36)[2]).join('');
}

function renderPastePage(text, slug, metadata) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const metaInline = `Created: ${metadata.formattedCreated} | Expires at: ${metadata.formattedExpiration}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Paste: ${slug}</title>
  <link rel="stylesheet" href="/style.css">
  <style>
    pre code {
      background-color: #607D8B;
      padding: 1em;
      display: block;
      margin: 1em auto;
      border-radius: 4px;
      white-space: pre-wrap;
      width: 50%;
      max-height: 70vh; overflow: auto;
    }
    code {
      background-color: #607D8B;
      padding: 0.2em 0.4em;
      border-radius: 3px;
    }
      
  </style>
</head>
<body>
  <article>
    <h1>Paste: ${slug}</h1>
    <p><code>${metaInline}</code></p>
    <pre><code>${escaped}</code></pre>
  </article>
</body>
</html>`;
}
