import html from "./index.html";
import docsHtml from "./docs.html";
import styleCss from "./style.txt";
import siteWebmanifest from "./site.webmanifest.txt";
import faviconIco from "./favicon.txt";
import favicon16 from "./favicon-16x16.txt";
import favicon32 from "./favicon-32x32.txt";
import appleIcon from "./apple-touch-icon.txt";
import androidChrome192 from "./android-chrome-192x192.txt";
import androidChrome512 from "./android-chrome-512x512.txt";
import { DateTime } from "luxon";

export default {
  async fetch(request, env) {
    const PASTES = env.Pastebin;
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: getCORSHeaders() });
    }

    // Serve static assets
    if (pathname === "/") {
      return new Response(html, {
        headers: { "Content-Type": "text/html", ...getCORSHeaders() },
      });
    }
    if (pathname === "/docs") {
      return new Response(docsHtml, {
        headers: { "Content-Type": "text/html", ...getCORSHeaders() },
      });
    }
    if (pathname === "/style.css") {
      return new Response(styleCss, {
        headers: { "Content-Type": "text/css", ...getCORSHeaders() },
      });
    }
    if (pathname === "/site.webmanifest") {
      return new Response(siteWebmanifest, {
        headers: {
          "Content-Type": "application/manifest+json",
          ...getCORSHeaders(),
        },
      });
    }
    if (pathname === "/favicon.ico") {
      return new Response(faviconIco, {
        headers: { "Content-Type": "image/x-icon", ...getCORSHeaders() },
      });
    }
    if (pathname === "/favicon-16x16.png") {
      return new Response(favicon16, {
        headers: { "Content-Type": "image/png", ...getCORSHeaders() },
      });
    }
    if (pathname === "/favicon-32x32.png") {
      return new Response(favicon32, {
        headers: { "Content-Type": "image/png", ...getCORSHeaders() },
      });
    }
    if (pathname === "/apple-touch-icon.png") {
      return new Response(appleIcon, {
        headers: { "Content-Type": "image/png", ...getCORSHeaders() },
      });
    }
    if (pathname === "/android-chrome-192x192.png") {
      return new Response(androidChrome192, {
        headers: { "Content-Type": "image/png", ...getCORSHeaders() },
      });
    }
    if (pathname === "/android-chrome-512x512.png") {
      return new Response(androidChrome512, {
        headers: { "Content-Type": "image/png", ...getCORSHeaders() },
      });
    }

    // Load keys from KV
    const apiKey = await PASTES.get("api_key");
    const superKey = await PASTES.get("Super_Key");

    // Create paste (super-secret key required)
    if (pathname === "/api/create" && request.method === "POST") {
      if (!isAuth(request, superKey)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...getCORSHeaders() },
        });
      }
      const {
        slug: bodySlug,
        text,
        expiration,
        password,
      } = await request.json();
      const slug = bodySlug || generateSlug();
      const now = DateTime.utc();
      const exp = expiration
        ? DateTime.fromISO(expiration, { zone: "local" }).toUTC()
        : null;
      const metadata = {
        created: now.toISO(),
        expiration: exp ? exp.toISO() : null,
        password: password || null,
      };
      const record = { text, metadata };
      const options = {};
      if (exp)
        options.expirationTtl = Math.floor(exp.toSeconds() - now.toSeconds());
      await PASTES.put(slug, JSON.stringify(record), options);
      return new Response(
        JSON.stringify({
          slug,
          formattedExpiration: metadata.expiration
            ? DateTime.fromISO(metadata.expiration).toLocaleString(
                DateTime.DATETIME_MED,
              )
            : null,
        }),
        {
          headers: { "Content-Type": "application/json", ...getCORSHeaders() },
        },
      );
    }

    // View paste content
    if (pathname.startsWith("/api/view/") && request.method === "GET") {
      const slug = pathname.split("/api/view/")[1];
      const stored = await PASTES.get(slug);
      if (!stored) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...getCORSHeaders() },
        });
      }
      const record = JSON.parse(stored);
      if (record.metadata.password) {
        const pw = request.headers.get("X-Paste-Password");
        if (pw !== record.metadata.password) {
          return new Response(JSON.stringify({ error: "Password required" }), {
            status: 401,
            headers: {
              "Content-Type": "application/json",
              ...getCORSHeaders(),
            },
          });
        }
      }
      return new Response(JSON.stringify(record), {
        headers: { "Content-Type": "application/json", ...getCORSHeaders() },
      });
    }

    // List pastes: API key shows public only; Super key shows all
    if (pathname === "/api/pastes" && request.method === "GET") {
      const hasApi = isAuth(request, apiKey);
      const hasSuper = isAuth(request, superKey);
      if (!hasApi && !hasSuper) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...getCORSHeaders() },
        });
      }
      const list = await PASTES.list();
      const now = DateTime.utc();
      const result = [];
      for (const { name } of list.keys) {
        const stored = await PASTES.get(name);
        if (!stored) continue;
        const record = JSON.parse(stored);
        if (
          record.metadata.expiration &&
          now > DateTime.fromISO(record.metadata.expiration)
        )
          continue;
        if (record.metadata.password && !hasSuper) continue;
        const entry = {
          slug: name,
          created: DateTime.fromISO(record.metadata.created).toLocaleString(
            DateTime.DATETIME_MED,
          ),
          expiration: record.metadata.expiration
            ? DateTime.fromISO(record.metadata.expiration).toLocaleString(
                DateTime.DATETIME_MED,
              )
            : null,
        };
        if (hasSuper) entry.password = record.metadata.password;
        result.push(entry);
      }
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json", ...getCORSHeaders() },
      });
    }

    // Delete paste (super-secret key required)
    if (pathname === "/api/delete" && request.method === "DELETE") {
      if (!isAuth(request, superKey)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...getCORSHeaders() },
        });
      }
      const { slug } = await request.json();
      await PASTES.delete(slug);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json", ...getCORSHeaders() },
      });
    }

    // Fallback
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...getCORSHeaders() },
    });
  },
};

// Helpers
function getCORSHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-Paste-Password",
    "Access-Control-Max-Age": "86400",
  };
}

function isAuth(request, key) {
  if (!key) return false;
  return request.headers.get("Authorization") === `Bearer ${key}`;
}

function generateSlug() {
  return Array.from({ length: 6 }, () => Math.random().toString(36)[2]).join(
    "",
  );
}
