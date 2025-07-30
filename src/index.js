import { getAssetFromKV } from "@cloudflare/kv-asset-handler";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const PASTEBIN_KV = env.Pastebin;
    const API_SECRET = env.API_KEY;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCORSHeaders() });
    }

    // Try to serve static assets first
    try {
      // Check if this is a request for a static asset
      if (
        path === "/" ||
        path === "/index.html" ||
        path === "/docs.html" ||
        path === "/style.css" ||
        path === "/run.js" ||
        path === "/api-docs.md" ||
        path.startsWith("/favicon") ||
        path.endsWith(".png") ||
        path.endsWith(".ico") ||
        path.endsWith(".svg") ||
        path === "/site.webmanifest"
      ) {
        // Serve from KV storage (configured in wrangler.toml)
        return await getAssetFromKV(
          {
            request,
            waitUntil: ctx.waitUntil.bind(ctx),
          },
          {
            ASSET_NAMESPACE: env.__STATIC_CONTENT,
            ASSET_MANIFEST: JSON.parse(env.__STATIC_CONTENT_MANIFEST),
          },
        );
      }
    } catch (e) {
      // If the asset wasn't found, continue to other routes
      if (!(e instanceof Error) || !e.message.includes("not found")) {
        throw e;
      }
    }

    // Parse date helper functions
    const parseHumanReadableDate = (dateString) => {
      try {
        // Parse user input as CST (UTC-6) and convert to UTC
        const cstDate = new Date(dateString); // This assumes local time (CST)
        const utcTimestamp = cstDate.getTime() + 6 * 60 * 60 * 1000; // Convert CST to UTC

        return new Date(utcTimestamp); // Return UTC Date object
      } catch (error) {
        return null;
      }
    };

    const getSecondsRemaining = (expirationTimestamp) => {
      const nowUTC = new Date().getTime(); // Get current UTC time
      console.log("Current UTC Time:", new Date(nowUTC).toISOString());
      console.log(
        "Expiration UTC Time:",
        new Date(expirationTimestamp).toISOString(),
      );

      return Math.floor((expirationTimestamp - nowUTC) / 1000);
    };

    const formatTimestamp = (timestamp) => {
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
    };

    const generateRandomSlug = () => {
      return [...Array(6)].map(() => Math.random().toString(36)[2]).join("");
    };

    // Handle API routes
    if (path.startsWith("/api/")) {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || authHeader !== `Bearer ${API_SECRET}`) {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "Content-Type": "application/json", ...getCORSHeaders() },
        });
      }

      if (url.pathname === "/api/auth") {
        return new Response("Authorized", {
          status: 200,
          headers: { "Content-Type": "application/json", ...getCORSHeaders() },
        });
      }

      if (path.startsWith("/api/create") && method === "POST") {
        const {
          text,
          password = null,
          expiration = null,
          slug = null,
        } = await request.json();

        const generatedSlug = slug || generateRandomSlug();
        const expirationDate = expiration
          ? parseHumanReadableDate(expiration)
          : null;

        if (expiration && !expirationDate) {
          return new Response(
            "Invalid expiration format. Use 'YYYY-MM-DD hh:mm AM/PM'.",
            {
              status: 400,
              headers: getCORSHeaders(),
            },
          );
        }

        const metadata = {
          password,
          expirationInSeconds: expirationDate
            ? getSecondsRemaining(expirationDate.getTime())
            : null,
          formattedExpiration: expirationDate
            ? formatTimestamp(expirationDate.getTime())
            : null,
          createdAt: formatTimestamp(Date.now()),
        };

        await PASTEBIN_KV.put(
          generatedSlug,
          JSON.stringify({ text, metadata }),
        );

        return new Response(
          JSON.stringify({
            success: true,
            slug: generatedSlug,
            expirationInSeconds: metadata.expirationInSeconds,
            formattedExpiration: metadata.formattedExpiration,
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

      if (path.startsWith("/api/delete") && method === "DELETE") {
        const { slug } = await request.json();
        if (!slug)
          return new Response("Missing slug", {
            status: 400,
            headers: getCORSHeaders(),
          });

        await PASTEBIN_KV.delete(slug);
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...getCORSHeaders() },
        });
      }

      if (path.startsWith("/api/view") && method === "GET") {
        const slug = path.split("/").pop();
        if (slug === "view") {
          const keys = await PASTEBIN_KV.list();
          const pastes = await Promise.all(
            keys.keys.map(async (key) => {
              const data = await PASTEBIN_KV.get(key.name, { type: "json" });

              // Get current timestamp and check expiration
              const now = Date.now();
              if (data.metadata.formattedExpiration) {
                const expirationTimestamp = new Date(
                  data.metadata.formattedExpiration,
                ).getTime();

                if (expirationTimestamp <= now) {
                  await PASTEBIN_KV.delete(key.name);
                  return null; // Don't include expired pastes
                }
              }

              return { slug: key.name, metadata: data.metadata };
            }),
          );

          return new Response(
            JSON.stringify(pastes.filter((paste) => paste !== null)),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                ...getCORSHeaders(),
              },
            },
          );
        } else {
          const paste = await PASTEBIN_KV.get(slug, { type: "json" });
          if (!paste)
            return new Response("Paste not found", {
              status: 404,
              headers: {
                "Content-Type": "application/json",
                ...getCORSHeaders(),
              },
            });

          const now = Date.now();
          if (paste.metadata.formattedExpiration) {
            const expirationTimestamp = new Date(
              paste.metadata.formattedExpiration,
            ).getTime();
            if (expirationTimestamp <= now) {
              await PASTEBIN_KV.delete(slug);
              return new Response("Paste expired and deleted", {
                status: 410,
                headers: getCORSHeaders(),
              });
            }
          }

          return new Response(JSON.stringify(paste), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              ...getCORSHeaders(),
            },
          });
        }
      }
    }

    // Viewing a paste
    const slug = path.slice(1);
    if (slug && !slug.includes("/")) {
      // Make sure it's just a slug, not a path
      const paste = await PASTEBIN_KV.get(slug, { type: "json" });

      if (!paste) {
        return new Response("Paste not found", {
          status: 404,
          headers: { "Content-Type": "text/plain", ...getCORSHeaders() },
        });
      }

      const { text, metadata } = paste;

      if (metadata.expirationInSeconds && metadata.expirationInSeconds <= 0) {
        await PASTEBIN_KV.delete(slug);
        return new Response("Paste expired and deleted", {
          status: 410,
          headers: getCORSHeaders(),
        });
      }

      // Password protection
      if (metadata.password) {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || authHeader !== `Bearer ${metadata.password}`) {
          return new Response(
            `<html><body>
                        <script>
                            const password = prompt("Enter password for this paste:");
                            if (password) {
                                fetch("${url}", {
                                    headers: { "Authorization": "Bearer " + password }
                                }).then(res => {
                                    if (res.ok) {
                                        res.text().then(text => document.write(text));
                                    } else {
                                        alert("Incorrect password");
                                    }
                                });
                            }
                        </script>
                        </body></html>`,
            { headers: { "Content-Type": "text/html", ...getCORSHeaders() } },
          );
        }
      }

      return new Response(text, {
        status: 200,
        headers: { "Content-Type": "text/plain", ...getCORSHeaders() },
      });
    }

    // If nothing matches, return 404
    return new Response("Not found", {
      status: 404,
      headers: getCORSHeaders(),
    });
  },
};

function getCORSHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
