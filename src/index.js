import html from './index.html';
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;
        const PASTEBIN_KV = env.Pastebin;
        const API_SECRET = env.API_KEY; 

        const generateRandomSlug = () => {
            return [...Array(6)].map(() => Math.random().toString(36)[2]).join('');
        };

        //if (path === "/") {
        //    return new Response("Hello, World! New UI for the home route coming soon :)", { status: 200 });
        //}
        if (url.pathname === "/") {
            return new Response(html, {
                headers: { 'Content-Type': 'text/html' },
              });
          }
          
        if (path.startsWith("/api/")) {
            const authHeader = request.headers.get("Authorization");
            if (!authHeader || authHeader !== `Bearer ${API_SECRET}`) {
                return new Response("Unauthorized", { status: 401 });
            }

            if (path.startsWith("/api/create") && method === "POST") {
                const { text, password = null, expiration = null, slug = null } = await request.json();
                
                const generatedSlug = slug || generateRandomSlug();
                const metadata = {
                    password,
                    expiration: expiration ? Date.now() + expiration * 1000 : null, // Expiration in seconds
                    createdAt: Date.now()
                };

                await PASTEBIN_KV.put(generatedSlug, JSON.stringify({ text, metadata }));

                return new Response(
                    JSON.stringify({ success: true, slug: generatedSlug }),
                    { status: 200, headers: { "Content-Type": "application/json" } }
                );
            }

            if (path.startsWith("/api/delete") && method === "DELETE") {
                const { slug } = await request.json();
                if (!slug) return new Response("Missing slug", { status: 400 });

                await PASTEBIN_KV.delete(slug);
                return new Response(JSON.stringify({ success: true }), { status: 200 });
            }

            if (path.startsWith("/api/view") && method === "GET") {
                const slug = path.split("/").pop();
                if (slug === "view") {
                    const keys = await PASTEBIN_KV.list();
                    const pastes = await Promise.all(
                        keys.keys.map(async (key) => {
                            const data = await PASTEBIN_KV.get(key.name, { type: "json" });

                            // Check if the paste is expired
                            if (data.metadata.expiration && Date.now() > data.metadata.expiration) {
                                await PASTEBIN_KV.delete(key.name);
                                return null;
                            }

                            return { slug: key.name, metadata: data.metadata };
                        })
                    );

                    return new Response(
                        JSON.stringify(pastes.filter((paste) => paste !== null)),
                        { status: 200, headers: { "Content-Type": "application/json" } }
                    );
                } else {
                    const paste = await PASTEBIN_KV.get(slug, { type: "json" });
                    if (!paste) return new Response("Paste not found", { status: 404 });

                    // Check if the paste is expired
                    if (paste.metadata.expiration && Date.now() > paste.metadata.expiration) {
                        await PASTEBIN_KV.delete(slug);
                        return new Response("Paste expired and deleted", { status: 410 });
                    }

                    return new Response(JSON.stringify(paste), { status: 200 });
                }
            }
        }

        // Viewing a paste
        const slug = path.slice(1);
        const paste = await PASTEBIN_KV.get(slug, { type: "json" });

        if (!paste) {
            return new Response("Paste not found", { status: 404 });
        }

        const { text, metadata } = paste;

        // Check if the paste is expired
        if (metadata.expiration && Date.now() > metadata.expiration) {
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
                    { headers: { "Content-Type": "text/html" } }
                );
            }
        }

        return new Response(text, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
};
