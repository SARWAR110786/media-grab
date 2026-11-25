# MediaGrab — Smart Media Downloader

Detect, download and organize **publicly accessible** media files. MediaGrab has three parts:

| Part | Where | What it does |
| --- | --- | --- |
| **Web app** | `apps/web` (Next.js 15, TypeScript, Tailwind v4, shadcn/ui-style components, Lucide) | Landing page, dashboard, URL analyzer, download manager with pause/resume/retry, history, settings |
| **Backend** | `apps/web/app/api/*` (Next.js route handlers, Node runtime) | URL validation, SSRF-safe metadata lookup, streaming download proxy with Range support |
| **Chrome extension** | `apps/extension` (Manifest V3, TypeScript, esbuild) | Detects HTML5 video/audio, `<source>` tags, file links and loaded media on the current page; downloads via `chrome.downloads` |
| **Shared library** | `packages/shared` | Media classification, filename sanitizing, URL/IP validation, and the segmented download engine |

## What it does — and doesn't

**Does**
- Validates a pasted URL, checks it's reachable, and reads filename, type, size and whether the server supports byte ranges.
- Downloads direct files (MP4, WebM, MP3, WAV, OGG, FLAC, PDF, ZIP, RAR, 7Z, ISO… any direct http(s) file).
- **Acceleration:** when the server supports HTTP `Range`, the file is split into up to 16 segments downloaded in parallel, each retried from its last byte, then reassembled and size-verified. Without range support (or when a server claims support but ignores it) it falls back to one stream automatically. Speed gains depend on the server and network and are never guaranteed.
- **Pause/resume:** keeps progress when the server supports ranges — even across page reloads (segments are stored in the browser's Origin Private File System). Without range support, resuming restarts, and the UI says so.
- When you paste a **webpage** URL, it says so, and lists any direct media links found in the page's HTML.
- The extension shows unsupported media (MSE `blob:` streams, HLS/DASH manifests, DRM players) with an explanation instead of hiding it.

**Doesn't** — by design
- No DRM/encryption circumvention, no paywall/login bypass, no HLS/DASH stream ripping. Major streaming sites (YouTube, Netflix, Spotify, …) are reported as unsupported.
- Never collects or forwards cookies, session tokens or credentials.

## Quick start

Requirements: Node.js ≥ 20, npm ≥ 10, Chrome/Chromium ≥ 116.

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:3000. For development with hot reload use `npm run dev` (run `npm run build:extension` once first so the extension package exists for download).

## Loading the Chrome extension

1. Build it: `npm run build:extension` → output in `apps/extension/dist` (also zipped to `apps/web/public/mediagrab-extension.zip`, downloadable from the app's **Browser Extension** page).
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select `apps/extension/dist` (or the unzipped `mediagrab-extension` folder).
4. Pin MediaGrab, open a page with media, click the icon.

In the popup: **Download** (Chrome's download manager), **⚡** (open in the web app for multi-connection download), **Copy link**, **Download all**, **Refresh**, and **Settings**. The **Downloads** tab shows live progress with pause/resume/cancel/retry. In settings, set the web app URL if it isn't `http://localhost:3000`.

During development: `npm run watch -w @mediagrab/extension`, then click reload on the extension card.

### Extension permissions

| Permission | Why |
| --- | --- |
| `downloads` | Start downloads and show progress/pause/resume/cancel |
| `storage` | Settings and the list of downloads started from the extension |
| `activeTab`, `scripting` | Re-scan the current tab on **Refresh** (e.g. tabs opened before install) |
| content script on `http(s)://*/*` | Read `<video>`, `<audio>`, `<source>` and links to detect media automatically. Nothing leaves the page except to the extension itself |
| optional `<all_urls>` | Only requested if you enable **Look up file sizes**; used for `HEAD` requests with `credentials: "omit"` |

No `tabs`, `cookies` or `webRequest` permissions are requested.

## Configuration

See [`.env.example`](.env.example). Defaults are safe; you normally don't need to set anything.

## Security

- **URL validation:** http/https only, no embedded credentials, length limits (`packages/shared/src/url.ts`).
- **SSRF protection** (`apps/web/lib/server/safe-fetch.ts`): blocks localhost/internal hostnames, private, loopback, link-local (cloud metadata), CGNAT, multicast and reserved IPv4/IPv6 ranges including IPv4-mapped/NAT64/6to4 forms; only ports 80/443. The DNS check runs **inside the connection's lookup**, so the validated address is the one connected to (no DNS-rebinding window). Redirects are followed manually and every hop is re-validated (max 5).
- **Proxy hardening:** single-range only, size limit enforced from headers *and* while streaming, timeouts, per-IP concurrency and analyze rate limits, `Content-Disposition: attachment` with a sanitized name, upstream HTML/XML/text served as `application/octet-stream` with `nosniff` and a sandbox CSP, no cookies or `Authorization` ever sent upstream.
- **Filenames:** path components, traversal, control/bidi/reserved characters and Windows device names are removed; length is capped (`packages/shared/src/filename.ts`).
- No user accounts, no database: history and settings stay in the user's browser.

The in-memory rate limiters are per process; behind multiple instances, add a shared limiter at your proxy/CDN.

## Testing

```bash
npm test
```

Unit + integration tests (Vitest, 96 tests): segment planning, parallel download reassembly (SHA-256 verified), servers without Range, servers that lie about Range, mid-stream failures with resume-from-offset retries, truncation detection, pause/resume, persisted-plan resume, transport fallback, size limits; SSRF guard (25 blocked URL forms, DNS-rebinding, multi-record DNS, redirect validation), analyzer for MP4/MP3/PDF/ZIP/WebM, webpages, errors and protected sites; download proxy Range passthrough and header safety.

```bash
npm run build && npm run test:e2e
```

End-to-end tests (Playwright + Chromium, 25 tests) start a local fixture server and the production app, then drive the real UI and the unpacked extension: MP4/MP3/PDF/ZIP downloads with byte-exact verification, 6-segment integrity, direct CORS transport, no-Range fallback, pause/resume, resume after page reload, cancel, failed download + retry/remove, invalid URLs, unsupported sites/streams, webpage link discovery; extension HTML5 video/audio detection, unsupported stream flagging, `chrome.downloads` completion, download-all, failure reporting, empty state, and permission checks. Pass `E2E_SCREENSHOTS=dir` to save screenshots, or a name filter (`node scripts/e2e.mjs pause`).

For manual testing, `npm run fixtures` serves sample files and an HTML5 media page at http://127.0.0.1:4100. To analyze those loopback URLs in the app you must start it with `MEDIAGRAB_ALLOW_PRIVATE_HOSTS=true` (local testing only).

## Deployment

**Node host / VM:** `npm ci && npm run build && npm start` (set `PORT` as needed). Put it behind HTTPS.

**Docker:**

```bash
docker build -t mediagrab .
```

```bash
docker run -p 3000:3000 mediagrab
```

**Vercel and other serverless hosts** work for the UI and `/api/analyze`, but note that `/api/download` streams files through the function, so platform response-size/duration limits apply; large files should use the direct (CORS) path or a long-running Node host.

After deploying, set the extension's **web app URL** in its settings to your domain.

## Project structure

```
media-grab/
├── apps/
│   ├── web/                 Next.js app
│   │   ├── app/             pages: / (landing), (app)/dashboard, downloader, downloads, extension, settings
│   │   │   └── api/         analyze, download (proxy), health
│   │   ├── components/      UI (components/ui = shadcn-style primitives)
│   │   ├── lib/server/      safe-fetch (SSRF), analyze, html-scan, rate-limit, config
│   │   ├── lib/client/      download manager, OPFS segment store, settings
│   │   └── test/            server-side tests
│   └── extension/
│       ├── static/          manifest.json, popup/options HTML+CSS
│       ├── src/             background, content, popup, options, lib/detect
│       └── build.mjs        esbuild bundle + icons + zip
├── packages/shared/         engine, media, filename, url, ip, format (+ tests)
├── scripts/                 fixture-server.mjs, e2e.mjs
├── Dockerfile, .env.example, vitest.config.ts
```

## Browser notes

- Resumable storage uses the Origin Private File System with `createWritable` (Chrome/Edge 86+, Firefox 111+). Elsewhere downloads are held in memory and can't resume after a reload.
- Finished files are handed to the browser via a Blob URL; they remain in browser storage for **Save again** until removed from history or cleared in Settings.
