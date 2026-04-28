/**
 * VRChat Avatar Manager — Cloudflare Worker
 * Proxies VRChat API calls to bypass CORS restrictions.
 */

const VRC_API = "https://api.vrchat.cloud/api/1";
const API_KEY = "JlGlobalv959ay9puS6p99En0asKuAk";
const USER_AGENT = "VRCX/1.6.4 (vrcxml@gmail.com)";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-VRC-Auth, X-S3-Url, X-S3-content-md5, X-S3-content-type",
    "Access-Control-Expose-Headers": "X-VRC-Auth",
};

function jsonResp(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extraHeaders },
    });
}

function safeBtoa(str) {
    // Used only for cookie strings (always ASCII-safe)
    try { return btoa(str); } catch { return btoa(unescape(encodeURIComponent(str))); }
}

async function vrcFetch(path, options = {}, authCookies = "") {
    const url = `${VRC_API}${path}${path.includes("?") ? "&" : "?"}apiKey=${API_KEY}`;
    const headers = {
        "User-Agent": USER_AGENT,
        ...(options.headers || {}),
    };
    if (authCookies) headers["Cookie"] = authCookies;

    if (options.json) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(options.json);
        delete options.json;
    }

    const resp = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body,
        redirect: "manual",
    });

    const setCookies = resp.headers.getAll
        ? resp.headers.getAll("set-cookie")
        : [resp.headers.get("set-cookie")].filter(Boolean);

    return { resp, setCookies };
}

function getAuth(request) {
    const header = request.headers.get("X-VRC-Auth") || "";
    if (!header) return "";
    try { return atob(header); } catch { return header; }
}

function mergeCookies(existing, newCookies) {
    const map = {};
    if (existing) {
        existing.split(";").forEach((c) => {
            const [k, ...v] = c.trim().split("=");
            if (k) map[k.trim()] = v.join("=");
        });
    }
    newCookies.forEach((sc) => {
        const [pair] = sc.split(";");
        const [k, ...v] = pair.split("=");
        if (k) map[k.trim()] = v.join("=");
    });
    return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        if (path === "/" || path === "/index.html") {
            return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not Found", { status: 404 });
        }

        const auth = getAuth(request);

        // 1. API: Login
        if (path === "/api/login" && request.method === "POST") {
            try {
                const body = await request.json();
                // VRChat official spec: base64(encodeURIComponent(username) + ':' + encodeURIComponent(password))
                // This supports any Unicode username (Chinese, Japanese, etc.) and special chars in passwords.
                // For ASCII-only credentials, encodeURIComponent is a no-op, so behavior is unchanged.
                const basicAuth = btoa(`${encodeURIComponent(body.username)}:${encodeURIComponent(body.password)}`);
                const { resp, setCookies } = await vrcFetch("/auth/user", {
                    method: "GET",
                    headers: { Authorization: `Basic ${basicAuth}` },
                });
                const data = await resp.json();
                const cookies = mergeCookies("", setCookies);
                if (resp.status === 200) {
                    const needs2FA = data.requiresTwoFactorAuth && data.requiresTwoFactorAuth.length > 0;
                    return jsonResp({ ok: true, needs2FA, user: data }, 200, { "X-VRC-Auth": safeBtoa(cookies) });
                }
                return jsonResp({ ok: false, message: data.error?.message || "Login failed" }, resp.status);
            } catch (e) {
                return jsonResp({ ok: false, message: e.message }, 500);
            }
        }

        // 2. API: 2FA
        if (path === "/api/2fa" && request.method === "POST") {
            try {
                const body = await request.json();
                const vrcPath = body.type === "emailotp" ? "/auth/twofactorauth/emailotp/verify" : "/auth/twofactorauth/totp/verify";
                const { resp, setCookies } = await vrcFetch(vrcPath, { method: "POST", json: { code: body.code } }, auth);
                const data = await resp.json();
                const cookies = mergeCookies(auth, setCookies);
                if (resp.status === 200 && data.verified) return jsonResp({ ok: true }, 200, { "X-VRC-Auth": safeBtoa(cookies) });
                return jsonResp({ ok: false }, 400);
            } catch (e) { return jsonResp({ ok: false }, 500); }
        }

        // 3. API: Image Proxy (Crucial for bypass Referer/CORS)
        if (path === "/api/image" && request.method === "GET") {
            const targetUrl = url.searchParams.get("url");
            if (!targetUrl) return new Response("Missing url", { status: 400 });

            const cache = caches.default;
            const cacheKey = new Request(request.url, { method: "GET" });
            let cached = await cache.match(cacheKey);
            if (cached) return cached;

            try {
                const imgResp = await fetch(targetUrl, {
                    method: "GET",
                    headers: { "User-Agent": USER_AGENT, "Referer": "https://vrchat.com/", "Cookie": auth },
                    redirect: "follow"
                });
                if (!imgResp.ok) return new Response("Fail", { status: imgResp.status, headers: CORS_HEADERS });

                const resp = new Response(imgResp.body, {
                    status: 200,
                    headers: {
                        "Content-Type": imgResp.headers.get("content-type") || "image/jpeg",
                        "Cache-Control": "public, max-age=604800, immutable",
                        ...CORS_HEADERS
                    }
                });
                ctx.waitUntil(cache.put(cacheKey, resp.clone()));
                return resp;
            } catch (e) { return new Response(e.message, { status: 500, headers: CORS_HEADERS }); }
        }

        // 4. API: Proxy any /api/vrc/*
        if (path.startsWith("/api/vrc/")) {
            const vrcPath = path.replace("/api/vrc", "") + url.search;
            const method = request.method;
            let body = null;
            if (["POST", "PUT", "PATCH"].includes(method)) {
                const ct = request.headers.get("content-type") || "";
                body = ct.includes("application/json") ? await request.text() : await request.arrayBuffer();
            }
            const { resp, setCookies } = await vrcFetch(vrcPath, { method, body, headers: { "Content-Type": request.headers.get("content-type") } }, auth);
            const respBody = await resp.arrayBuffer();
            const cookies = mergeCookies(auth, setCookies);
            return new Response(respBody, {
                status: resp.status,
                headers: { "Content-Type": resp.headers.get("content-type") || "application/json", ...CORS_HEADERS, "X-VRC-Auth": safeBtoa(cookies) },
            });
        }

        // 5. API: Prefetch
        if (path === "/api/images/prefetch" && request.method === "POST") {
            const { urls = [] } = await request.json();
            const cache = caches.default;
            const promises = urls.slice(0, 50).map(async (u) => {
                const ck = new Request(new URL(`/api/image?url=${encodeURIComponent(u)}`, request.url), { method: "GET" });
                if (await cache.match(ck)) return;
                try {
                    const r = await fetch(u, { headers: { "User-Agent": USER_AGENT, "Referer": "https://vrchat.com/", "Cookie": auth } });
                    if (r.ok) await cache.put(ck, new Response(r.body, { headers: { "Content-Type": r.headers.get("content-type"), "Cache-Control": "public, max-age=86400", ...CORS_HEADERS } }));
                } catch { }
            });
            ctx.waitUntil(Promise.all(promises));
            return jsonResp({ ok: true });
        }

        return jsonResp({ error: "Not found" }, 404);
    },
};
