export default {
    async fetch(request, env) {
      const url = new URL(request.url);
      const { pathname } = url;
  
      // CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
            "Access-Control-Allow-Headers": "Authorization,Content-Type",
          },
        });
      }
  
      // Helper: check API key
      function requireAuth() {
        const auth = request.headers.get("Authorization") || "";
        if (!auth.startsWith("Bearer ") || auth.split(" ")[1] !== env.API_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }
        return null;
      }
  
      // POST /api/create
      if (pathname === "/api/create" && request.method === "POST") {
        const badAuth = requireAuth();
        if (badAuth) return badAuth;
        const body = await request.json();
        const slug = body.slug?.trim() || crypto.randomUUID().slice(0,8);
        const text = body.text || "";
        const expirationSeconds = body.expiration
          ? Math.max(0, (new Date(body.expiration) - Date.now())/1000)
          : 0;
        const record = {
          text,
          password: body.password || null,
          createdAt: new Date().toISOString(),
        };
        await env.PASTES.put(slug,
          JSON.stringify(record),
          expirationSeconds>0 ? { expirationTtl: Math.floor(expirationSeconds) } : {}
        );
        return new Response(JSON.stringify({
          success: true,
          slug,
          expirationInSeconds: expirationSeconds||null,
          formattedExpiration: body.expiration||null
        }), {
          headers: { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" }
        });
      }
  
      // GET /api/view or /api/view/:slug
      if (pathname.startsWith("/api/view") && request.method === "GET") {
        const badAuth = requireAuth();
        if (badAuth) return badAuth;
        const parts = pathname.split("/").filter(Boolean);
        // list all
        if (parts.length === 2) {
          const list = await env.PASTES.list();
          const items = await Promise.all(list.keys.map(async k => {
            const rec = JSON.parse(await env.PASTES.get(k.name));
            return { slug: k.name, metadata: {
              password: rec.password,
              createdAt: rec.createdAt,
              expirationInSeconds: null
            }};
          }));
          return new Response(JSON.stringify(items), {
            headers: { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" }
          });
        }
        // fetch single
        const slug = parts[2];
        const recText = await env.PASTES.get(slug);
        if (!recText) return new Response("Not found", { status: 404 });
        const rec = JSON.parse(recText);
        if (rec.password) {
          const pw = request.headers.get("Authorization")?.split(" ")[1];
          if (pw !== rec.password) return new Response("Unauthorized", { status: 401 });
        }
        return new Response(JSON.stringify({
          text: rec.text,
          metadata: { password: rec.password, createdAt: rec.createdAt }
        }), {
          headers: { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" }
        });
      }
  
      // DELETE /api/delete
      if (pathname === "/api/delete" && request.method === "DELETE") {
        const badAuth = requireAuth();
        if (badAuth) return badAuth;
        const { slug } = await request.json();
        await env.PASTES.delete(slug);
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" }
        });
      }
  
      // GET /:slug → public HTML view
      if (request.method === "GET" && pathname.length>1 && !pathname.includes(".")) {
        const slug = pathname.slice(1);
        // fetch the raw paste
        const recText = await env.PASTES.get(slug);
        if (!recText) return new Response("Gone", { status: 410 });
        const rec = JSON.parse(recText);
        // render simple HTML or redirect to index.html?
        const html = `
          <!doctype html><html><head><meta charset="utf-8">
          <title>Paste: ${slug}</title></head>
          <body><pre>${rec.text}</pre></body></html>`;
        return new Response(html, { headers: { "Content-Type":"text/html" } });
      }
  
      // Fallback to static Pages assets
      return fetch(request);
    }
  };
  