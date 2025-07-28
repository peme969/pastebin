import html from "./index.html";
import docsHtml from "./docs.html";
import styleCss from "./style.css";
import runJs from "./run.js";
import apiDocsMd from "./api-docs.md";
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const { pathname } = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };
    const PASTEBIN_KV = env.Pastebin;
    const API_SECRET = env.API_KEY;
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCORSHeaders() });
    }
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

    //if (path === "/") {
    //    return new Response("Hello, World! New UI for the home route coming soon :)", { status: 200 });
    //}
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(html, {
        headers: { "Content-Type": "text/html", ...corsHeaders },
      });
    }
    if (pathname === "/docs.html") {
      return new Response(docsHtml, {
        headers: { "Content-Type": "text/html", ...corsHeaders },
      });
    }
    if (pathname === "/style.css") {
      return new Response(styleCss, {
        headers: { "Content-Type": "text/css" },
      });
    }
    if (pathname === "/run.js") {
      return new Response(runJs, {
        headers: { "Content-Type": "application/javascript" },
      });
    }
    if (pathname === "/api-docs.md") {
      return new Response(apiDocsMd, {
        headers: { "Content-Type": "text/markdown" },
      });
    }
    if (path.startsWith("/api/")) {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || authHeader !== `Bearer ${API_SECRET}`) {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "Content-Type": "application/json", ...getCORSHeaders() },
        });
      }
      if (url.pathname === "/api/auth") {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || authHeader !== `Bearer ${API_SECRET}`) {
          return new Response("Unauthorized", {
            status: 401,
            headers: {
              "Content-Type": "application/json",
              ...getCORSHeaders(),
            },
          });
        } else {
          return new Response("Authorized", {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              ...getCORSHeaders(),
            },
          });
        }
      }
      if (path.startsWith("/api/create") && method === "POST") {
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
        const expirationInSeconds = getSecondsRemaining(
          expirationDate.getTime(),
        );

        const metadata = {
          password,
          expirationInSeconds, // Store seconds until expiration
          formattedExpiration: formatTimestamp(expirationDate.getTime()), // Store CST formatted expiration
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

      if (path.startsWith("/api/delete") && method === "DELETE") {
        const { slug } = await request.json();
        if (!slug) return new Response("Missing slug", { status: 400 });

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
              const expirationTimestamp = new Date(
                data.metadata.formattedExpiration,
              ).getTime();

              if (expirationTimestamp <= now) {
                await PASTEBIN_KV.delete(key.name);
                return null; // Don't include expired pastes
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
          const expirationTimestamp = new Date(
            paste.metadata.formattedExpiration,
          ).getTime();
          if (expirationTimestamp <= now) {
            await PASTEBIN_KV.delete(slug);
            return new Response("Paste expired and deleted", { status: 410 });
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
    const paste = await PASTEBIN_KV.get(slug, {
      type: "json",
      headers: { "Content-Type": "application/json", ...getCORSHeaders() },
    });

    if (!paste) {
      return new Response("Paste not found", {
        status: 404,
        headers: { "Content-Type": "application/json", ...getCORSHeaders() },
      });
    }

    const { text, metadata } = paste;

    if (metadata.expirationInSeconds && metadata.expirationInSeconds <= 0) {
      await PASTEBIN_KV.delete(slug);
      return new Response("Paste expired and deleted", { status: 410 });
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
          {
            headers: {
              "Content-Type": "text/html",
              headers: {
                "Content-Type": "application/json",
                ...getCORSHeaders(),
              },
            },
          },
        );
      }
    }

    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
        headers: { "Content-Type": "application/json", ...getCORSHeaders() },
      },
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
