import { formatBytes, formatDuration, formatSpeed } from "@mediagrab/shared";
import { getSettings, type ExtensionSettings } from "./lib/settings";
import type { DetectedMedia, DownloadEntry, Message, ProbeResult, StartResult } from "./lib/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ICONS: Record<string, string> = {
  video: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  document: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
  archive: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M10 3v2h2v2h-2v2h2v2h-2"/></svg>',
  other: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  blocked: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0-5-5m5 5 5-5M5 21h14"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
};

let tabId: number | null = null;
let tabUrl = "";
let tabTitle = "";
let settings: ExtensionSettings;
let media: DetectedMedia[] = [];
let notes: string[] = [];
const sizes: Record<string, ProbeResult> = {};
const speedSamples = new Map<number, { t: number; bytes: number; speed: number }>();
let dlTimer: ReturnType<typeof setInterval> | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function iconBtn(svg: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", "icon-btn");
  b.title = title;
  b.setAttribute("aria-label", title);
  b.innerHTML = svg; // static, trusted markup only
  b.addEventListener("click", onClick);
  return b;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(msg: string) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// ---------- Detected media ----------

async function loadMedia(rescan = false): Promise<void> {
  if (tabId == null) return;
  const btn = $("refresh");
  btn.classList.add("spin");
  try {
    if (rescan) await rescanTab(tabId);
    const res = (await chrome.runtime.sendMessage({ type: "media:get", tabId } satisfies Message)) as { items: DetectedMedia[]; notes: string[]; title: string; pageUrl: string };
    media = res?.items ?? [];
    notes = res?.notes ?? [];
    if (res?.title) tabTitle = res.title;
    // Without an activeTab grant Chrome hides tab.url; the content script's own report has it.
    if (!tabUrl && res?.pageUrl) {
      tabUrl = res.pageUrl;
      $("site-name").textContent = hostOf(tabUrl) || tabTitle || "This page";
    }
    renderMedia();
    const urls = media.filter((m) => m.supported && m.size == null && !sizes[m.url]).map((m) => m.url);
    if (urls.length && settings.lookUpSizes) {
      const found = (await chrome.runtime.sendMessage({ type: "media:probe", urls } satisfies Message)) as Record<string, ProbeResult>;
      Object.assign(sizes, found ?? {});
      renderMedia();
    }
  } finally {
    btn.classList.remove("spin");
  }
}

async function rescanTab(id: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(id, { type: "mediagrab:rescan" } satisfies Message);
  } catch {
    // No content script yet (page opened before install, or scripts blocked): inject via activeTab.
    try {
      await chrome.scripting.executeScript({ target: { tabId: id, allFrames: true }, files: ["content.js"] });
      await new Promise((r) => setTimeout(r, 400));
    } catch {
      /* restricted page */
    }
  }
  await new Promise((r) => setTimeout(r, 150));
}

function describe(m: DetectedMedia): string[] {
  const parts: string[] = [];
  if (m.width && m.height) parts.push(`${m.width}×${m.height}`);
  if (m.duration) parts.push(formatDuration(m.duration));
  const size = m.size ?? sizes[m.url]?.size;
  if (size != null) parts.push(formatBytes(size));
  parts.push(
    {
      video: "video tag",
      audio: "audio tag",
      source: "source tag",
      link: "link",
      meta: "page metadata",
      network: "loaded by page",
      embed: "embedded",
    }[m.source],
  );
  return parts;
}

function renderMedia(): void {
  const supported = media.filter((m) => m.supported);
  const visible = settings.showUnsupported ? media : supported;
  $("media-badge").textContent = String(supported.length);
  $("site-count").textContent = supported.length
    ? `${supported.length} downloadable file${supported.length === 1 ? "" : "s"} detected`
    : media.length
      ? "Media found, but not downloadable"
      : "No downloadable media detected";
  ($("download-all") as HTMLButtonElement).disabled = supported.length === 0;
  $("download-all").textContent = supported.length > 1 ? `Download all (${supported.length})` : "Download all";
  $("download-all").title = "Download all supported files";

  const notesBox = $("notes");
  notesBox.replaceChildren();
  notesBox.className = notes.length ? "notes" : "";
  for (const n of notes) {
    const d = el("div", "note");
    d.innerHTML = ICONS.info;
    d.append(el("span", "", n));
    notesBox.append(d);
  }

  const list = $("media-list");
  list.replaceChildren();
  for (const m of visible) {
    const li = el("li", `item${m.supported ? "" : " unsupported"}`);
    li.dataset.testid = "media-item";
    const ic = el("div", `ficon ${m.supported ? m.category : "blocked"}`);
    ic.innerHTML = m.supported ? (ICONS[m.category] ?? ICONS.other) : ICONS.blocked;
    const body = el("div", "body");
    const name = el("p", "name", m.filename);
    name.title = m.url;
    const meta = el("div", "meta");
    meta.append(el("span", m.supported ? "tag" : "tag warn", m.supported ? m.label || m.ext.toUpperCase() || "FILE" : "Unsupported"));
    for (const p of describe(m)) meta.append(el("span", "", p));
    body.append(name, meta);
    if (!m.supported && m.reason) body.append(el("p", "reason", m.reason));
    li.append(ic, body);
    if (m.supported) {
      const actions = el("div", "row-actions");
      actions.append(
        iconBtn(ICONS.copy, "Copy link", async () => {
          await navigator.clipboard.writeText(m.url);
          toast("Link copied");
        }),
        iconBtn(ICONS.bolt, "Open in MediaGrab web app (accelerated)", () => openInWebApp(m.url)),
        iconBtn(ICONS.download, "Download", () => void download([m])),
      );
      li.append(actions);
    }
    list.append(li);
  }

  const empty = $("media-empty");
  empty.hidden = visible.length > 0;
  if (!visible.length) {
    empty.replaceChildren();
    const restricted = !/^https?:/.test(tabUrl);
    empty.append(
      el("p", "empty-title", restricted ? "Can't scan this page" : "No downloadable media found"),
      el(
        "p",
        "muted small",
        restricted
          ? "Browsers don't allow extensions to read built-in pages like this one. Open a regular website."
          : "MediaGrab looks for HTML5 video/audio and links to media or files. Start playing the video and press refresh if the player loads it later.",
      ),
    );
  }
}

function openInWebApp(url: string) {
  const base = (settings.webAppUrl || "http://localhost:3000").replace(/\/+$/, "");
  void chrome.tabs.create({ url: `${base}/downloader?url=${encodeURIComponent(url)}` });
}

async function download(items: DetectedMedia[]): Promise<void> {
  const results = (await chrome.runtime.sendMessage({
    type: "download:start",
    items: items.map((m) => ({ url: m.url, filename: m.filename })),
    pageTitle: tabTitle,
  } satisfies Message)) as StartResult[];
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  if (failed.length) toast(`${ok} started, ${failed.length} failed: ${failed[0].error}`);
  else toast(ok === 1 ? "Download started" : `${ok} downloads started`);
  if (ok) {
    await renderDownloads();
    startDownloadPolling();
  }
}

// ---------- Downloads ----------

async function getEntries(): Promise<DownloadEntry[]> {
  const { downloads } = await chrome.storage.local.get("downloads");
  return (downloads as DownloadEntry[] | undefined) ?? [];
}

function errorText(err?: string): string {
  if (!err) return "Failed";
  const map: Record<string, string> = {
    NETWORK_FAILED: "Network error",
    NETWORK_TIMEOUT: "Network timeout",
    NETWORK_DISCONNECTED: "You are offline",
    SERVER_FAILED: "Server error",
    SERVER_BAD_CONTENT: "File not found on server",
    SERVER_UNAUTHORIZED: "Server requires authorization",
    SERVER_FORBIDDEN: "Access forbidden",
    FILE_ACCESS_DENIED: "Can't write to the download folder",
    FILE_NO_SPACE: "Disk is full",
    FILE_TOO_LARGE: "File too large for disk",
    FILE_FAILED: "Couldn't save file",
    FILE_BLOCKED: "Blocked by security policy",
    FILE_VIRUS_INFECTED: "Blocked by virus scanner",
  };
  return map[err] ?? err.replace(/_/g, " ").toLowerCase();
}

async function renderDownloads(): Promise<boolean> {
  const entries = await getEntries();
  const items = await Promise.all(entries.map(async (e) => ({ e, d: (await chrome.downloads.search({ id: e.id }))[0] as chrome.downloads.DownloadItem | undefined })));
  const list = $("dl-list");
  list.replaceChildren();
  let anyActive = false;
  let activeCount = 0;
  let finished = 0;
  const now = Date.now();

  for (const { e, d } of items) {
    const li = el("li", "item");
    li.dataset.testid = "download-item";
    const body = el("div", "body");
    const name = el("p", "name", d?.filename ? d.filename.split(/[\\/]/).pop()! : e.filename);
    name.title = e.url;
    const meta = el("div", "meta");
    const bar = el("div", "bar");
    const fill = el("span");
    bar.append(fill);
    const actions = el("div", "dl-actions");

    let state = "Removed from the browser's download list";
    let stateCls = "state warn";
    const received = d?.bytesReceived ?? 0;
    const total = d?.totalBytes && d.totalBytes > 0 ? d.totalBytes : null;

    if (d?.state === "in_progress") {
      anyActive = true;
      activeCount++;
      const prev = speedSamples.get(e.id);
      let speed = prev?.speed ?? 0;
      if (prev && now - prev.t >= 700) {
        speed = ((received - prev.bytes) / (now - prev.t)) * 1000;
        speedSamples.set(e.id, { t: now, bytes: received, speed });
      } else if (!prev) speedSamples.set(e.id, { t: now, bytes: received, speed: 0 });
      state = d.paused ? "Paused" : "Downloading";
      stateCls = d.paused ? "state warn" : "state";
      if (total) fill.style.width = `${(received / total) * 100}%`;
      else bar.classList.add("indeterminate");
      meta.append(el("span", stateCls, state), el("span", "", `${formatBytes(received)}${total ? ` of ${formatBytes(total)}` : ""}`));
      if (!d.paused) meta.append(el("span", "", formatSpeed(speed)));
      if (d.paused) {
        const resume = el("button", "btn sm primary", "Resume");
        resume.disabled = !d.canResume;
        resume.title = d.canResume ? "Resume" : "The server doesn't support resuming";
        resume.onclick = () => void chrome.downloads.resume(e.id).then(renderDownloads);
        actions.append(resume);
      } else {
        const pause = el("button", "btn sm", "Pause");
        pause.onclick = () => void chrome.downloads.pause(e.id).then(renderDownloads);
        actions.append(pause);
      }
      const cancel = el("button", "btn sm ghost", "Cancel");
      cancel.onclick = () => void chrome.downloads.cancel(e.id).then(renderDownloads);
      actions.append(cancel);
    } else {
      finished++;
      if (d?.state === "complete") {
        state = "Completed";
        stateCls = "state ok";
        bar.classList.add("done");
        fill.style.width = "100%";
        meta.append(el("span", stateCls, state), el("span", "", formatBytes(d.fileSize || received)));
        const show = el("button", "btn sm", "Show in folder");
        show.disabled = !d.exists;
        show.onclick = () => chrome.downloads.show(e.id);
        actions.append(show);
      } else if (d?.state === "interrupted") {
        const cancelled = d.error === "USER_CANCELED";
        state = cancelled ? "Cancelled" : `Failed — ${errorText(d.error)}`;
        stateCls = cancelled ? "state warn" : "state bad";
        bar.classList.add("failed");
        fill.style.width = total ? `${(received / total) * 100}%` : "0%";
        meta.append(el("span", stateCls, state));
        if (!cancelled && d.canResume) {
          const resume = el("button", "btn sm primary", "Resume");
          resume.onclick = () => void chrome.downloads.resume(e.id).then(renderDownloads);
          actions.append(resume);
        }
        const retry = el("button", "btn sm", "Retry");
        retry.onclick = async () => {
          await removeEntry(e.id);
          await download([{ url: e.url, filename: e.filename } as DetectedMedia]);
        };
        actions.append(retry);
      } else {
        meta.append(el("span", stateCls, state));
      }
      const remove = el("button", "btn sm ghost", "Remove");
      remove.title = "Remove from this list (the file is kept)";
      remove.onclick = () => void removeEntry(e.id).then(renderDownloads);
      actions.append(remove);
    }
    meta.append(el("span", "", hostOf(e.url)));
    body.append(name, meta, bar, actions);
    li.append(body);
    list.append(li);
  }
  $("dl-badge").textContent = String(activeCount || items.length);
  $("dl-empty").hidden = items.length > 0;
  $("clear-finished").hidden = !finished || $("panel-downloads").hidden;
  return anyActive;
}

async function removeEntry(id: number): Promise<void> {
  const list = (await getEntries()).filter((e) => e.id !== id);
  await chrome.storage.local.set({ downloads: list });
  speedSamples.delete(id);
}

function startDownloadPolling() {
  if (dlTimer) return;
  dlTimer = setInterval(async () => {
    const active = await renderDownloads();
    if (!active && dlTimer) {
      clearInterval(dlTimer);
      dlTimer = null;
    }
  }, 700);
}

// ---------- Tabs & init ----------

function showPanel(which: "media" | "downloads") {
  const isMedia = which === "media";
  $("panel-media").hidden = !isMedia;
  $("panel-downloads").hidden = isMedia;
  $("tab-media").classList.toggle("active", isMedia);
  $("tab-downloads").classList.toggle("active", !isMedia);
  $("tab-media").setAttribute("aria-selected", String(isMedia));
  $("tab-downloads").setAttribute("aria-selected", String(!isMedia));
  $("download-all").hidden = !isMedia;
  void renderDownloads();
}

async function init() {
  settings = await getSettings();
  // Tests and the options page may pass ?tabId=; normally use the active tab (granted via activeTab).
  const param = new URLSearchParams(location.search).get("tabId");
  const tab = param ? await chrome.tabs.get(Number(param)) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  tabId = tab?.id ?? null;
  tabUrl = tab?.url ?? "";
  tabTitle = tab?.title ?? "";
  $("site-name").textContent = hostOf(tabUrl) || tabTitle || "This page";
  if (tab?.favIconUrl && /^(https?|data):/.test(tab.favIconUrl)) {
    const img = $<HTMLImageElement>("favicon");
    img.src = tab.favIconUrl;
    img.hidden = false;
    img.onerror = () => (img.hidden = true);
  }

  $("refresh").addEventListener("click", () => void loadMedia(true));
  $("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("tab-media").addEventListener("click", () => showPanel("media"));
  $("tab-downloads").addEventListener("click", () => showPanel("downloads"));
  $("download-all").addEventListener("click", () => void download(media.filter((m) => m.supported)));
  $("clear-finished").addEventListener("click", async () => {
    const entries = await getEntries();
    const keep: DownloadEntry[] = [];
    for (const e of entries) {
      const [d] = await chrome.downloads.search({ id: e.id });
      if (d?.state === "in_progress") keep.push(e);
    }
    await chrome.storage.local.set({ downloads: keep });
    void renderDownloads();
  });

  chrome.downloads.onChanged.addListener(() => {
    void renderDownloads();
    startDownloadPolling();
  });

  await loadMedia(settings.autoDetect === false);
  if (await renderDownloads()) startDownloadPolling();
  // If nothing was found yet, the page may still be loading: rescan once.
  if (!media.length && /^https?:/.test(tabUrl)) setTimeout(() => void loadMedia(true), 600);
}

void init();
