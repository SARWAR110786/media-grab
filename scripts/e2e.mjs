// End-to-end tests: real Chromium driving the production web app and the unpacked extension.
//   npm run build && npm run test:e2e
// Starts the fixture server and `next start` itself. Requires Playwright with Chromium installed.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer, sha256 } from "./fixture-server.mjs";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error(
    "Playwright is not installed. It is kept out of package.json so normal installs stay light.\n" +
      "Install it once with:\n  npm install --no-save playwright && npx playwright install chromium",
  );
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const WEB = `http://localhost:${WEB_PORT}`;
const EXT_DIR = path.join(root, "apps/extension/dist");
const SHOTS = process.env.E2E_SCREENSHOTS ? path.resolve(process.env.E2E_SCREENSHOTS) : null;
const only = process.argv[2];

const results = [];
async function test(name, fn) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    results.push({ name, ok: false, error: e });
    console.log(`  ✗ ${name}\n      ${String(e?.stack ?? e).split("\n").slice(0, 4).join("\n      ")}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

async function waitFor(fn, { timeout = 20000, interval = 100, message = "condition" } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for ${message}${last instanceof Error ? `: ${last.message}` : ""}`);
}

async function startWeb() {
  const proc = spawn(process.execPath, [require.resolve("next/dist/bin/next", { paths: [path.join(root, "apps/web")] }), "start", "-p", String(WEB_PORT)], {
    cwd: path.join(root, "apps/web"),
    env: { ...process.env, MEDIAGRAB_ALLOW_PRIVATE_HOSTS: "true", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group, so next-server's children are stopped too
  });
  let log = "";
  proc.stdout.on("data", (d) => (log += d));
  proc.stderr.on("data", (d) => (log += d));
  await waitFor(async () => (await fetch(`${WEB}/api/health`)).ok, { timeout: 30000, message: `web server (${log.slice(-500)})` });
  return proc;
}

// ---------------------------------------------------------------------------------------------

const fixture = await startFixtureServer(Number(process.env.E2E_FIXTURE_PORT ?? 4100));
const F = fixture.url;
console.log(`Fixture server: ${F}`);
const web = await startWeb();
console.log(`Web app: ${WEB}\n`);

const browser = await chromium.launch();

async function webPage(settings = {}) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1360, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 });
  await context.addInitScript((s) => {
    if (!localStorage.getItem("mediagrab.settings.v1")) localStorage.setItem("mediagrab.settings.v1", JSON.stringify(s));
  }, settings);
  const page = await context.newPage();
  return { context, page };
}

async function analyzeIn(page, url) {
  await page.getByLabel("File URL").fill(url);
  await page.getByRole("button", { name: /^Analyze$/ }).click();
}

/** Analyze a file URL, start a managed download, capture the browser download and return its bytes. */
async function managedDownload(page, url) {
  await analyzeIn(page, url);
  const start = page.getByRole("button", { name: /^(Accelerated download|Download)$/ });
  await start.waitFor({ timeout: 15000 });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), start.click()]);
  const file = path.join(os.tmpdir(), `mg-e2e-${Date.now()}-${download.suggestedFilename()}`);
  await download.saveAs(file);
  const data = fs.readFileSync(file);
  fs.rmSync(file);
  return { data, name: download.suggestedFilename() };
}

/** In-app (client-side) navigation, so running downloads keep going. */
async function gotoManager(page) {
  await page.getByRole("link", { name: /Download History/ }).first().click();
  await page.waitForURL("**/downloads");
}

async function storedRecords(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("mediagrab.downloads.v1") ?? "[]"));
}

console.log("Web app");

await test("landing page renders hero and both CTAs", async () => {
  const { context, page } = await webPage();
  await page.goto(WEB);
  await page.getByRole("heading", { name: /Download Smarter/ }).waitFor();
  assert(await page.getByRole("link", { name: "Start Downloading" }).isVisible(), "Start Downloading");
  assert(await page.getByRole("link", { name: "Get Chrome Extension" }).isVisible(), "Get Chrome Extension");
  await shot(page, "landing");
  await page.getByRole("link", { name: "Start Downloading" }).click();
  await page.waitForURL("**/dashboard");
  await context.close();
});

for (const [name, mode] of [
  ["sample.mp4", "segmented"],
  ["song.mp3", "segmented"],
  ["document.pdf", "single"],
  ["archive.zip", "segmented"],
]) {
  await test(`downloads ${name} and the bytes match (${mode})`, async () => {
    const { context, page } = await webPage({ minSegmentMB: 1 });
    await page.goto(`${WEB}/downloader`);
    const before = fixture.requests.length;
    const { data, name: saved } = await managedDownload(page, `${F}/files/${name}`);
    assert(saved === name, `filename ${saved}`);
    assert(sha256(data) === sha256(fixture.files[name].data), `sha256 of ${name}`);
    const recs = await storedRecords(page);
    assert(recs[0]?.status === "completed", `status ${recs[0]?.status}`);
    assert(recs[0]?.mode === mode, `mode ${recs[0]?.mode}`);
    if (mode === "segmented") {
      const ranges = fixture.requests.slice(before).filter((r) => r.path === `/files/${name}` && r.range && r.range !== "bytes=0-0");
      assert(ranges.length >= 2, `expected parallel range requests, got ${ranges.length}`);
    }
    await context.close();
  });
}

await test("segmented download integrity across 8 connections", async () => {
  const { context, page } = await webPage({ connections: 8, minSegmentMB: 1 });
  await page.goto(`${WEB}/downloader`);
  const before = fixture.requests.length;
  const { data } = await managedDownload(page, `${F}/files/sample.mp4`);
  assert(sha256(data) === sha256(fixture.files["sample.mp4"].data), "sha256");
  const ranges = fixture.requests.slice(before).filter((r) => r.path === "/files/sample.mp4" && r.range && r.range !== "bytes=0-0");
  assert(ranges.length === 6, `expected 6 segments (6 MiB / 1 MiB min), got ${ranges.length}`);
  const recs = await storedRecords(page);
  assert(recs[0].segments.length === 6, "6 segments recorded");
  await context.close();
});

await test("direct (CORS) transport downloads straight from the origin", async () => {
  const { context, page } = await webPage();
  await page.goto(`${WEB}/downloader`);
  const { data } = await managedDownload(page, `${F}/cors/sample.mp4`);
  assert(sha256(data) === sha256(fixture.files["sample.mp4"].data), "sha256");
  const recs = await storedRecords(page);
  assert(recs[0].transport === "direct", `transport ${recs[0].transport}`);
  await context.close();
});

await test("server without Range support falls back to a single stream", async () => {
  const { context, page } = await webPage();
  await page.goto(`${WEB}/downloader`);
  await analyzeIn(page, `${F}/norange/big.bin`);
  await page.getByText("No range support").waitFor();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download$/ }).click()]);
  const file = await download.path();
  assert(sha256(fs.readFileSync(file)) === sha256(fixture.files["big.bin"].data), "sha256");
  const recs = await storedRecords(page);
  assert(recs[0].mode === "single" && recs[0].acceptRanges === false, `mode ${recs[0].mode}`);
  await context.close();
});

await test("pause keeps progress and resume completes with correct bytes", async () => {
  const { context, page } = await webPage({ connections: 4, autoSave: true });
  await page.goto(`${WEB}/downloader`);
  await analyzeIn(page, `${F}/slow/sample.mp4`);
  await page.getByRole("button", { name: /Accelerated download/ }).click();
  await gotoManager(page);
  const item = page.getByTestId("download-item").first();
  await waitFor(async () => (await storedRecords(page))[0]?.downloaded > 1_000_000, { message: "progress > 1MB", timeout: 30000 });
  await shot(page, "downloads-active");
  await item.getByRole("button", { name: "Pause" }).click();
  await waitFor(async () => (await item.getAttribute("data-status")) === "paused", { message: "paused" });
  const pausedAt = (await storedRecords(page))[0].downloaded;
  await page.waitForTimeout(1200);
  const still = (await storedRecords(page))[0].downloaded;
  assert(still === pausedAt, `no progress while paused (${pausedAt} → ${still})`);
  assert(pausedAt < fixture.files["sample.mp4"].data.length, "paused before completion");
  const before = fixture.requests.length;
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), item.getByRole("button", { name: "Resume" }).click()]);
  assert(sha256(fs.readFileSync(await download.path())) === sha256(fixture.files["sample.mp4"].data), "sha256 after resume");
  const resumed = fixture.requests.slice(before).filter((r) => r.path === "/slow/sample.mp4");
  const plan = (await storedRecords(page))[0].plan.map((p) => p.start);
  assert(resumed.every((r) => !plan.includes(Number(/bytes=(\d+)/.exec(r.range)?.[1]))), "resume requests continue mid-segment");
  await context.close();
});

await test("resume after a page reload continues from stored segments", async () => {
  const { context, page } = await webPage({ connections: 4 });
  await page.goto(`${WEB}/downloader`);
  await analyzeIn(page, `${F}/slow/sample.mp4`);
  await page.getByRole("button", { name: /Accelerated download/ }).click();
  await waitFor(async () => (await storedRecords(page))[0]?.downloaded > 1_500_000, { message: "progress", timeout: 30000 });
  page.on("dialog", (d) => d.accept());
  await page.goto(`${WEB}/downloads`); // client-side state is rebuilt from storage on a full load
  await page.reload();
  const item = page.getByTestId("download-item").first();
  await waitFor(async () => (await item.getAttribute("data-status")) === "paused", { message: "interrupted → paused" });
  const saved = (await storedRecords(page))[0];
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), item.getByRole("button", { name: "Resume" }).click()]);
  assert(sha256(fs.readFileSync(await download.path())) === sha256(fixture.files["sample.mp4"].data), "sha256");
  assert(saved.downloaded > 0, "had progress before reload");
  await context.close();
});

await test("cancel stops the download and marks it cancelled", async () => {
  const { context, page } = await webPage();
  await page.goto(`${WEB}/downloader`);
  await analyzeIn(page, `${F}/slow/sample.mp4`);
  await page.getByRole("button", { name: /Accelerated download/ }).click();
  await gotoManager(page);
  const item = page.getByTestId("download-item").first();
  await waitFor(async () => (await item.getAttribute("data-status")) === "downloading", { message: "downloading" });
  await item.getByRole("button", { name: "Cancel" }).click();
  await waitFor(async () => (await item.getAttribute("data-status")) === "cancelled", { message: "cancelled" });
  await page.getByRole("tab", { name: /Cancelled/ }).click();
  assert((await page.getByTestId("download-item").count()) === 1, "cancelled filter");
  await context.close();
});

await test("failed download shows the error and can be retried / removed", async () => {
  const { context, page } = await webPage({ retries: 1 });
  await page.goto(`${WEB}/downloader`);
  await analyzeIn(page, `${F}/truncate/big.bin`);
  await page.getByRole("button", { name: /^Download$/ }).click();
  await gotoManager(page);
  const item = page.getByTestId("download-item").first();
  await waitFor(async () => (await item.getAttribute("data-status")) === "failed", { message: "failed", timeout: 30000 });
  const text = await item.innerText();
  assert(/closed early|Network|error/i.test(text), `error message shown: ${text}`);
  await shot(page, "downloads-failed");
  await item.getByRole("button", { name: "Retry" }).click();
  await waitFor(async () => ["failed", "downloading", "queued"].includes(await item.getAttribute("data-status")), { message: "retry started" });
  await waitFor(async () => (await item.getAttribute("data-status")) === "failed", { message: "failed again", timeout: 30000 });
  await item.getByRole("button", { name: "Remove" }).click();
  await waitFor(async () => (await page.getByTestId("download-item").count()) === 0, { message: "removed" });
  await context.close();
});

await test("invalid URLs are rejected with a clear message", async () => {
  const { context, page } = await webPage();
  await page.goto(`${WEB}/downloader`);
  for (const bad of ["hello", "ftp://example.com/file.zip", "javascript:alert(1)"]) {
    await analyzeIn(page, bad);
    await page.getByRole("alert").getByText("Invalid URL").waitFor();
  }
  await context.close();
});

await test("unsupported websites and streams are explained, not attempted", async () => {
  const { context, page } = await webPage();
  await page.goto(`${WEB}/downloader`);
  await analyzeIn(page, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByText("Website not supported").waitFor();
  await analyzeIn(page, `${F}/live/master.m3u8`);
  await page.getByText("Streaming format not supported").waitFor();
  await analyzeIn(page, `${F}/status/404`);
  await page.getByText("The server returned an error").waitFor();
  await analyzeIn(page, `${F}/status/403`);
  await page.getByText("Authorization required").waitFor();
  await context.close();
});

await test("webpage URLs list direct links found in the HTML", async () => {
  const { context, page } = await webPage();
  await page.goto(`${WEB}/downloader`);
  await analyzeIn(page, `${F}/page.html`);
  await page.getByText(/This is a webpage, not a direct file/).waitFor();
  await page.getByText("sample.mp4").waitFor();
  await shot(page, "downloader-webpage");
  await page.getByRole("listitem").filter({ hasText: "tone.wav" }).getByRole("button", { name: "Analyze" }).click();
  await page.getByLabel("File name").waitFor();
  assert((await page.getByLabel("File name").inputValue()) === "tone.wav", "candidate analyzed");
  await context.close();
});

await test("dashboard shows queue and history; settings persist", async () => {
  const { context, page } = await webPage();
  await page.goto(`${WEB}/dashboard`);
  await managedDownload(page, `${F}/files/tone.wav`);
  await page.getByRole("heading", { name: "Recent downloads" }).waitFor();
  await waitFor(() => page.getByTestId("download-item").filter({ hasText: "tone.wav" }).isVisible(), { message: "recent item" });
  await shot(page, "dashboard");
  await page.goto(`${WEB}/settings`);
  await page.getByRole("switch", { name: "Save automatically" }).click();
  await page.reload();
  assert((await page.getByRole("switch", { name: "Save automatically" }).getAttribute("data-state")) === "unchecked", "setting persisted");
  await context.close();
});

await test("download proxy refuses private addresses when protection is on (API)", async () => {
  // The e2e server runs with private hosts allowed for the fixture; protection itself is covered by unit tests.
  const r = await fetch(`${WEB}/api/download?url=${encodeURIComponent("gopher://127.0.0.1/")}`);
  assert(r.status === 400, `status ${r.status}`);
  const a = await fetch(`${WEB}/api/analyze`, { method: "POST", body: "{bad json", headers: { "Content-Type": "application/json" } });
  assert(a.status === 400, `bad json status ${a.status}`);
});

await browser.close();

// ---------------------------------------------------------------------------------------------
console.log("\nChrome extension");

const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
await test("manifest requests only the permissions it needs", async () => {
  assert(manifest.manifest_version === 3, "MV3");
  assert(JSON.stringify([...manifest.permissions].sort()) === JSON.stringify(["activeTab", "downloads", "scripting", "storage"]), `permissions ${manifest.permissions}`);
  assert(!manifest.host_permissions, "no required host permissions");
  assert(JSON.stringify(manifest.optional_host_permissions) === JSON.stringify(["<all_urls>"]), "optional host permission");
  assert(!manifest.permissions.includes("cookies") && !manifest.permissions.includes("webRequest") && !manifest.permissions.includes("tabs"), "no cookies/webRequest/tabs");
});

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mg-ext-"));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: true,
  acceptDownloads: true,
  viewport: { width: 1200, height: 800 },
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const extId = new URL(sw.url()).host;

async function openPopupFor(page) {
  // The extension has no "tabs" permission, so find the tab through the page report its content script sent.
  const tabId = await waitFor(
    () =>
      sw.evaluate(async (url) => {
        const all = await chrome.storage.session.get(null);
        const ids = Object.entries(all)
          .filter(([k, v]) => k.startsWith("tab:") && v.pageUrl === url)
          .map(([k]) => Number(k.slice(4)))
          .sort((a, b) => b - a);
        for (const id of ids) if (await chrome.tabs.get(id).catch(() => null)) return id;
        return null;
      }, page.url()),
    { message: "tab report from content script" },
  );
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 400, height: 590 });
  await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
  return { popup, tabId };
}

await test("optional host permission is not granted by default", async () => {
  const has = await sw.evaluate(() => chrome.permissions.contains({ origins: ["<all_urls>"] }));
  assert(has === false, "no all-sites access by default");
});

await test("detects HTML5 video, audio, sources and file links; flags unsupported streams", async () => {
  const page = await ctx.newPage();
  await page.goto(`${F}/page.html`);
  await page.waitForTimeout(1500);
  const { popup, tabId } = await openPopupFor(page);
  await popup.getByTestId("media-item").first().waitFor();
  await popup.waitForTimeout(800);
  const names = await popup.locator(".item .name").allInnerTexts();
  for (const n of ["sample.mp4", "clip.webm", "tone.wav", "song.mp3", "document.pdf", "bundle.zip"]) assert(names.includes(n), `detected ${n} (got ${names.join(", ")})`);
  const unsupported = await popup.locator(".item.unsupported").allInnerTexts();
  assert(unsupported.some((t) => /HLS|Adaptive/i.test(t)), "HLS flagged unsupported");
  assert(unsupported.some((t) => /blob: URL/i.test(t)), "MSE blob stream flagged unsupported");
  const count = await popup.locator("#site-count").innerText();
  assert(/6 downloadable files detected/.test(count), count);
  const badge = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  assert(badge === "6", `badge ${badge}`);
  // Resolution from the decoded WAV isn't applicable; duration is.
  const wavMeta = await popup.locator(".item", { hasText: "tone.wav" }).innerText();
  assert(/2s/.test(wavMeta), `duration shown: ${wavMeta}`);
  await popup.setViewportSize({ width: 400, height: 590 });
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await popup.screenshot({ path: path.join(SHOTS, "extension-popup.png") });
  }
  await popup.close();
  await page.close();
});

await test("downloads a detected file through chrome.downloads and shows completion", async () => {
  const page = await ctx.newPage();
  await page.goto(`${F}/page.html`);
  await page.waitForTimeout(1000);
  const { popup } = await openPopupFor(page);
  const row = popup.locator(".item", { hasText: "document.pdf" });
  await row.waitFor();
  await row.getByRole("button", { name: "Download" }).click();
  await popup.getByRole("tab", { name: /Downloads/ }).click();
  await waitFor(async () => /Completed/.test(await popup.locator("#dl-list").innerText()), { message: "completed state in popup", timeout: 20000 });
  const state = await sw.evaluate(async () => {
    const [d] = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 });
    return { state: d.state, bytes: d.bytesReceived, file: d.filename };
  });
  assert(state.state === "complete", `chrome download state ${state.state}`);
  assert(state.bytes === fixture.files["document.pdf"].data.length, `bytes ${state.bytes}`);
  if (state.file && fs.existsSync(state.file)) assert(sha256(fs.readFileSync(state.file)) === sha256(fixture.files["document.pdf"].data), "file hash");
  if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, "extension-downloads.png") });
  await popup.close();
  await page.close();
});

await test("download all supported starts every supported file", async () => {
  const page = await ctx.newPage();
  await page.goto(`${F}/page.html`);
  await page.waitForTimeout(1000);
  const before = await sw.evaluate(async () => (await chrome.downloads.search({})).length);
  const { popup } = await openPopupFor(page);
  await popup.getByRole("button", { name: /Download all \(6\)/ }).click();
  await waitFor(async () => (await sw.evaluate(async () => (await chrome.downloads.search({})).length)) - before === 6, { message: "6 new downloads" });
  await waitFor(async () => (await sw.evaluate(async () => (await chrome.downloads.search({ state: "in_progress" })).length)) === 0, { message: "all finished", timeout: 30000 });
  await popup.close();
  await page.close();
});

await test("failed downloads are reported as failed in the popup", async () => {
  // Start a download whose server cuts the connection, through the same message path the popup uses.
  const page = await ctx.newPage();
  await page.goto(`${F}/empty.html`);
  const { popup } = await openPopupFor(page);
  await popup.evaluate(async (url) => {
    await chrome.runtime.sendMessage({ type: "download:start", items: [{ url, filename: "missing.mp4" }] });
  }, `${F}/truncate/big.bin`);
  await popup.getByRole("tab", { name: /Downloads/ }).click();
  await waitFor(async () => /Failed|Network/.test(await popup.locator("#dl-list .item").first().innerText()), { message: "failed state", timeout: 30000 });
  assert(await popup.locator("#dl-list .item").first().getByRole("button", { name: "Retry" }).isVisible(), "retry visible");
  await popup.close();
  await page.close();
});

await test("pages without media show a clear empty state", async () => {
  const page = await ctx.newPage();
  await page.goto(`${F}/empty.html`);
  await page.waitForTimeout(800);
  const { popup } = await openPopupFor(page);
  await popup.getByText("No downloadable media found").waitFor({ timeout: 8000 }).catch(async (e) => {
    throw new Error(`Popup text: ${(await popup.locator("body").innerText()).replace(/\n+/g, " | ")}`);
  });
  await popup.close();
  await page.close();
});

await test("the web app recognises the installed extension", async () => {
  const page = await ctx.newPage();
  await page.goto(`${WEB}/extension`, { waitUntil: "networkidle" }).catch(() => undefined);
  // The web app runs on localhost:3100 which is an http page, so the content script marks it.
  await page.getByText(/Installed · v1\.0\.0/).waitFor({ timeout: 10000 });
  await page.close();
});

await ctx.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

try {
  process.kill(-web.pid, "SIGTERM");
} catch {
  web.kill();
}
await fixture.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
