import {
  getAssetFromKV,
  mapRequestToAsset,
} from "@cloudflare/kv-asset-handler";

export async function fetch(request, env, ctx) {
  const url = new URL(request.url);

  // 1) API routes live under /api/*
  if (url.pathname.startsWith("/api/")) {
    return handleApi(request, env);
  }

  // 2) everything else falls back to static assets
  try {
    return await getAssetFromKV({
      request,
      waitUntil: ctx.waitUntil, // so assets can be streamed properly
      mapRequestToAsset,
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

// pull your existing API logic into a separate function:
async function handleApi(request, env) {
  const { pathname } = new URL(request.url);
  const PASTEBIN_KV = env.Pastebin;
  const API_SECRET = env.API_KEY;

  // OPTIONS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCORSHeaders() });
  }

  // auth endpoint
  if (pathname === "/api/auth") {
    const authHeader = request.headers.get("Authorization");
    if (authHeader !== `Bearer ${API_SECRET}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...getCORSHeaders() },
      });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...getCORSHeaders() },
    });
  }

  // CREATE
  if (pathname === "/api/create" && request.method === "POST") {
    const {
      text,
      password = null,
      expiration = null,
      slug = null,
    } = await request.json();
    const generatedSlug = slug || generateRandomSlug();
    const expirationDate = parseHumanReadableDate(expiration);
    if (!expirationDate) {
      return new Response(
        JSON.stringify({
          error: "Invalid expiration format. Use 'YYYY-MM-DD hh:mm AM/PM'.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...getCORSHeaders() },
        },
      );
    }

    const now = Date.now();
    const expirationTimestamp = expirationDate.getTime();
    const expirationInSeconds = Math.floor((expirationTimestamp - now) / 1000);

    const metadata = {
      password,
      expirationTimestamp, // absolute ms since epoch
      createdAt: now,
    };

    await PASTEBIN_KV.put(generatedSlug, JSON.stringify({ text, metadata }));

    return new Response(
      JSON.stringify({
        success: true,
        slug: generatedSlug,
        expirationInSeconds,
        formattedExpiration: formatTimestamp(expirationTimestamp),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...getCORSHeaders() },
      },
    );
  }

  // DELETE
  if (pathname === "/api/delete" && request.method === "DELETE") {
    const { slug } = await request.json();
    if (!slug) {
      return new Response("Missing slug", { status: 400 });
    }
    await PASTEBIN_KV.delete(slug);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...getCORSHeaders() },
    });
  }

  // VIEW ALL
  if (pathname === "/api/view" && request.method === "GET") {
    const list = await PASTEBIN_KV.list();
    const pastes = await Promise.all(
      list.keys.map(async (key) => {
        const data = await PASTEBIN_KV.get(key.name, { type: "json" });
        if (!data) return null;
        if (data.metadata.expirationTimestamp <= Date.now()) {
          await PASTEBIN_KV.delete(key.name);
          return null;
        }
        return { slug: key.name, metadata: data.metadata };
      }),
    );
    return new Response(JSON.stringify(pastes.filter((p) => p)), {
      status: 200,
      headers: { "Content-Type": "application/json", ...getCORSHeaders() },
    });
  }

  // VIEW SINGLE
  if (pathname.startsWith("/api/view/") && request.method === "GET") {
    const slug = pathname.split("/").pop();
    const paste = await PASTEBIN_KV.get(slug, { type: "json" });
    if (!paste) {
      return new Response("Paste not found", { status: 404 });
    }
    if (paste.metadata.expirationTimestamp <= Date.now()) {
      await PASTEBIN_KV.delete(slug);
      return new Response("Paste expired and deleted", {
        status: 410,
        headers: getCORSHeaders(),
      });
    }
    return new Response(JSON.stringify(paste), {
      status: 200,
      headers: { "Content-Type": "application/json", ...getCORSHeaders() },
    });
  }

  return new Response("Not found", { status: 404 });
}

function getCORSHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function parseHumanReadableDate(dateString) {
  if (!dateString) return null;
  // Expect "YYYY-MM-DD hh:mm AM/PM"
  const m = dateString.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/,
  );
  if (!m) return null;
  let [, YY, MM, DD, hh, mm, meridiem] = m;
  hh = (parseInt(hh, 10) % 12) + (meridiem === "PM" ? 12 : 0);
  // Build a Date in CST (UTC−6) and convert to UTC
  const utc = Date.UTC(
    parseInt(YY),
    parseInt(MM) - 1,
    parseInt(DD),
    hh + 6,
    parseInt(mm),
    0,
  );
  return new Date(utc);
}

function formatTimestamp(ts) {
  const d = new Date(ts - 6 * 60 * 60 * 1000); // convert UTC → CST
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, "0");
  const D = String(d.getDate()).padStart(2, "0");
  let h = d.getHours(),
    m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${Y}-${M}-${D} ${h}:${m} ${ampm} CST`;
}

function generateRandomSlug() {
  return [...Array(6)].map(() => Math.random().toString(36)[2]).join("");
}
