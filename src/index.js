import { getAssetFromKV } from "@cloudflare/kv-asset-handler";

export default {
  // fetch() now has three args: request, env, and ctx
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1) API routes live under /api/*
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }

    // 2) everything else falls back to static assets in ./public
    try {
      return await getAssetFromKV({
        request,
        env,
        waitUntil: ctx.waitUntil, // so assets can be streamed properly
      });
    } catch (err) {
      // e.g. asset not found
      return new Response("Not found", { status: 404 });
    }
  },
};

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
    if (!authHeader || authHeader !== `Bearer ${API_SECRET}`) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "Content-Type": "application/json", ...getCORSHeaders() },
      });
    }
    return new Response("Authorized", {
      status: 200,
      headers: { "Content-Type": "application/json", ...getCORSHeaders() },
    });
  }

  // create, delete, view, etc… (your existing code goes here, unchanged)

  if (pathname.startsWith("/api/create") && request.method === "POST") {
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
        "Invalid expiration format. Use 'YYYY-MM-DD hh:mm AM/PM'.",
        { status: 400 },
      );
    }
    const expirationInSeconds = getSecondsRemaining(expirationDate.getTime());
    const metadata = {
      password,
      expirationInSeconds, // Store seconds until expiration
      formattedExpiration: formatTimestamp(expirationDate.getTime()), // Store CST formatted expiration
      createdAt: formatTimestamp(Date.now()),
    };

    await PASTEBIN_KV.put(generatedSlug, JSON.stringify({ text, metadata }));

    return new Response(
      JSON.stringify({
        success: true,
        slug: generatedSlug,
        expirationInSeconds,
        formattedExpiration: expirationDate,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...getCORSHeaders(),
        },
      },
    );
  }

  if (pathname.startsWith("/api/delete") && request.method === "DELETE") {
    const { slug } = await request.json();
    if (!slug) return new Response("Missing slug", { status: 400 });

    await PASTEBIN_KV.delete(slug);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...getCORSHeaders() },
    });
  }

  if (pathname.startsWith("/api/view") && request.method === "GET") {
    // List all pastes
    if (pathname === "/api/view") {
      const keys = await PASTEBIN_KV.list();
      const pastes = await Promise.all(
        keys.keys.map(async (key) => {
          const data = await PASTEBIN_KV.get(key.name, { type: "json" });
          const now = Date.now();
          const expirationTimestamp = new Date(
            data.metadata.formattedExpiration,
          ).getTime();
          if (expirationTimestamp <= now) {
            await PASTEBIN_KV.delete(key.name);
            return null;
          }
          return { slug: key.name, metadata: data.metadata };
        }),
      );

      return new Response(JSON.stringify(pastes.filter((p) => p !== null)), {
        status: 200,
        headers: { "Content-Type": "application/json", ...getCORSHeaders() },
      });
    }

    // View single paste
    const slug = pathname.split("/").pop();
    const paste = await PASTEBIN_KV.get(slug, { type: "json" });
    if (!paste) {
      return new Response("Paste not found", {
        status: 404,
        headers: { "Content-Type": "application/json", ...getCORSHeaders() },
      });
    }
    const now = Date.now();
    const expirationTimestamp = new Date(
      paste.metadata.formattedExpiration,
    ).getTime();
    if (expirationTimestamp <= now) {
      await PASTEBIN_KV.delete(slug);
      return new Response("Paste expired and deleted", { status: 410 });
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
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function parseHumanReadableDate(dateString) {
  try {
    // Parse user input as CST (UTC-6) and convert to UTC
    const cstDate = new Date(dateString); // This assumes local time (CST)
    const utcTimestamp = cstDate.getTime() + 6 * 60 * 60 * 1000; // Convert CST to UTC

    return new Date(utcTimestamp); // Return UTC Date object
  } catch (error) {
    return null;
  }
}

function getSecondsRemaining(expirationTimestamp) {
  const nowUTC = new Date().getTime();
  return Math.floor((expirationTimestamp - nowUTC) / 1000);
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);

  // Convert UTC to CST manually
  const cstOffset = -6 * 60; // CST offset in minutes
  const cstDate = new Date(date.getTime() + cstOffset * 60 * 1000);

  const year = cstDate.getFullYear();
  const month = String(cstDate.getMonth() + 1).padStart(2, "0");
  const day = String(cstDate.getDate()).padStart(2, "0");

  let hours = cstDate.getHours();
  const minutes = String(cstDate.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  return `${year}-${month}-${day} ${hours}:${minutes} ${ampm} CST`;
}

function generateRandomSlug() {
  return [...Array(6)].map(() => Math.random().toString(36)[2]).join("");
}
