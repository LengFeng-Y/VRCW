# VRCW - VRChat Web Companion

VRCW is a browser-based companion tool for VRChat, deployed as a Cloudflare Worker with static assets. It focuses on day-to-day account management: avatars, favorites, worlds, friends, groups, media assets, public avatar search, and upload workflows.

[Simplified Chinese](README_zh.md)

Live site: [vrcw.yamadaryo.workers.dev](https://vrcw.yamadaryo.workers.dev)

## Features

| Area | What it does |
| --- | --- |
| Avatars | Browse your own avatars, avatar favorite groups, local favorites, filters, downloads, cleanup, edit/delete actions, and IDB-first cache loading. |
| Upload | Upload `.vrca` files, create new avatars, or update existing avatars through the VRChat file/version flow. |
| Public Search | Search public avatars from community sources, inspect details, favorite avatars into selected groups, and open VRCX deep links. |
| Friends | View friends by online/offline/category state, instance grouping, friend profiles, notes, moderation status, invites, boops, and context-menu actions. |
| Worlds | Browse recent/active/owned worlds, standard and VRC+ world favorite groups, world details, instances, cleanup, favorite add/remove, and local IDB caches. |
| Groups | Browse joined groups, group details, current instances when VRChat permits access, members, and join/leave/visibility actions. |
| Assets | Manage VRC+ gallery images, prints, emoji/stickers, inventory/listings, and avatar props where available. |
| Settings | Inspect and refresh persistent IndexedDB caches, image Blob cache, join preferences, and app metadata. |

## Architecture

- Frontend: plain HTML, CSS, and classic JavaScript files under `public/`.
- Backend: `worker.js`, a Cloudflare Worker that proxies VRChat API calls, handles auth cookie forwarding, image/download proxying, S3 upload proxying, and optional login proxy routing.
- Storage: browser IndexedDB for persistent list/detail caches and Blob image cache.
- Deployment: Cloudflare Workers Static Assets via `wrangler`.

The frontend scripts are intentionally classic scripts, not ES modules. They share globals by load order from `public/index.html`.

## Local Development

```bash
npm install
npx wrangler dev --port 8787
```

Then open [http://localhost:8787](http://localhost:8787).

## Deploy

```bash
npx wrangler deploy
```

`wrangler.toml` already points the Worker at `worker.js` and serves `./public` as static assets.

## Optional Login Proxy

VRChat may reject Cloudflare Worker IPs during login with `error code:1003`. VRCW supports an optional external login proxy for `/api/login`.

The Worker reads these environment variables:

| Variable | Value |
| --- | --- |
| `VPS_PROXY_URL` | Your private login proxy base URL, without a trailing slash. |
| `VPS_PROXY_SECRET` | A private shared secret that must match the proxy service configuration. Do not commit it. |

Do not add a trailing slash to `VPS_PROXY_URL`; the Worker appends `/api/1/auth/user`.

### Configure in Cloudflare Dashboard

1. Open Cloudflare Dashboard.
2. Go to Workers & Pages.
3. Select the VRCW Worker.
4. Open Settings -> Variables and Secrets.
5. Add `VPS_PROXY_URL` as a text variable.
6. Add `VPS_PROXY_SECRET` as a secret.
7. Save and redeploy.

### Configure with Wrangler

Add this to `wrangler.toml` if you want the URL stored in config:

```toml
[vars]
VPS_PROXY_URL = "https://your-login-proxy.example.com"
```

Then set the secret and deploy:

```bash
npx wrangler secret put VPS_PROXY_SECRET
npx wrangler deploy
```

## Project Layout

```text
public/                 Frontend HTML, CSS, JS, manifest, service worker
worker.js               Cloudflare Worker API proxy and static asset entry
wrangler.toml           Cloudflare Worker deployment config
vercel_proxy/           Optional Vercel login proxy
vps_proxy/              Optional self-hosted login proxy examples
memory.md               Local project memory for Codex, not meant for release docs
```

## Notes

- Requires a VRChat account and supports VRChat 2FA flows used by the app.
- Some VRC+ features require an active VRC+ subscription.
- VRChat's API is unofficial for this use case and can change or enforce additional permissions at any time.
- Group instance lists, private worlds, friends-only locations, and some media endpoints may return 403 depending on VRChat permissions.
- This is an independent personal tool and is not affiliated with VRChat Inc.

## License

MIT
