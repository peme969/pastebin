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

      // Create paste
      if (path === '/api/create' && method === 'POST') {
        // Read raw body and sanitize curly quotes
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
        const { text, expiration, slug } = body;

        // Timezone
        const userTZ = (request.cf && request.cf.timezone) || 'America/Chicago';
        // Parse expiration
        const dtExpires = DateTime.fromFormat(expiration, 'yyyy-MM-dd hh:mm a', { zone: userTZ });
        if (!dtExpires.isValid) {
          return new Response(JSON.stringify({ success: false, error: 'Bad expiration format' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        const expiresAtUtc = dtExpires.toUTC().toMillis();
        const nowUtc = Date.now();
        const expirationInSeconds = Math.max(0, Math.floor((expiresAtUtc - nowUtc) / 1000));
        const formattedExpiration = dtExpires.setZone(userTZ).toLocaleString(DateTime.DATETIME_FULL);

        // Capture creation in user TZ correctly
        const dtCreated = DateTime.fromMillis(nowUtc).setZone(userTZ);
        const formattedCreated = dtCreated.toLocaleString(DateTime.DATETIME_FULL);

        const tzAbbr = dtCreated.offsetNameShort;
        const isDST = dtCreated.isInDST;
        const generatedSlug = slug || generateRandomSlug();

        // Store KV: include expiresAtUtc and formatted strings
        await PASTEBIN_KV.put(
          generatedSlug,
          JSON.stringify({ text, metadata: { expiresAtUtc, formattedExpiration, formattedCreated, tzAbbr, isDST } })
        );

        return new Response(JSON.stringify({ success: true, slug: generatedSlug, expirationInSeconds, formattedExpiration, formattedCreated, timezone: tzAbbr, isDST }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
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
          return new Response(JSON.stringify({ success: false, error: 'Expired' }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        const expirationInSeconds = Math.floor((data.metadata.expiresAtUtc - nowUtc) / 1000);
        return new Response(JSON.stringify({ success: true, text: data.text, metadata: { ...data.metadata, expirationInSeconds } }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      // View paste HTML
      if (path.startsWith('/api/view/') && method === 'GET') {
        const slug = path.replace('/api/view/', '');
        const raw = await PASTEBIN_KV.get(slug);
        if (!raw) return new Response('Not Found', { status: 404, headers: corsHeaders });
        const data = JSON.parse(raw);
        const nowUtc = Date.now();
        if (nowUtc >= data.metadata.expiresAtUtc) {
          await PASTEBIN_KV.delete(slug);
          return new Response('Expired', { status: 404, headers: corsHeaders });
        }
        return new Response(renderPastePage(data.text, slug, data.metadata), { status: 200, headers: { 'Content-Type': 'text/html', ...corsHeaders } });
      }
    }

    // Default HTML view
    if (method === 'GET') {
      const slug = path.startsWith('/') ? path.slice(1) : path;
      const raw = await PASTEBIN_KV.get(slug);
      if (!raw) return new Response('Not Found', { status: 404, headers: corsHeaders });
      const data = JSON.parse(raw);
      const nowUtc = Date.now();
      if (nowUtc >= data.metadata.expiresAtUtc) {
        await PASTEBIN_KV.delete(slug);
        return new Response('Expired', { status: 404, headers: corsHeaders });
      }
      return new Response(renderPastePage(data.text, slug, data.metadata), { status: 200, headers: { 'Content-Type': 'text/html', ...corsHeaders } });
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
