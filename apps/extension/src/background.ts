import { sanitizeFilename } from "@mediagrab/shared";
import { cleanSubfolder, DEFAULT_SETTINGS, getSettings } from "./lib/settings";
import type { DetectedMedia, DownloadEntry, FrameReport, Message, ProbeResult, StartResult, TabMedia } from "./lib/types";

const MAX_DOWNLOAD_HISTORY = 200;
const probeCache = new Map<string, ProbeResult>();

// ---------- Per-tab media state (kept in session storage so it survives service worker restarts) ----------

const tabKey = (tabId: number) => `tab:${tabId}`;

async function getTab(tabId: number): Promise<TabMedia | null> {
  const key = tabKey(tabId);
  const data = await chrome.storage.session.get(key);
  return (data[key] as TabMedia | undefined) ?? null;
}

async function setTab(tabId: number, value: TabMedia): Promise<void> {
  await chrome.storage.session.set({ [tabKey(tabId)]: value });
}

export function aggregate(tab: TabMedia | null): { items: DetectedMedia[]; notes: string[] } {
  if (!tab) return { items: [], notes: [] };
  const seen = new Map<string, DetectedMedia>();
  const notes = new Set<string>();
  for (const frame of Object.values(tab.frames)) {
    for (const n of frame.notes) notes.add(n);
    for (const item of frame.items) {
      const prev = seen.get(item.id);
      if (!prev) seen.set(item.id, item);
      else seen.set(item.id, { ...item, ...prev, width: prev.width ?? item.width, height: prev.height ?? item.height, duration: prev.duration ?? item.duration });
    }
  }
  const order = { video: 0, audio: 1, source: 2, meta: 3, embed: 4, network: 5, link: 6 } as const;
  const items = [...seen.values()].sort((a, b) => Number(b.supported) - Number(a.supported) || order[a.source] - order[b.source]);
  return { items, notes: [...notes] };
}

async function updateBadge(tabId: number, tab: TabMedia | null): Promise<void> {
  const count = aggregate(tab).items.filter((i) => i.supported).length;
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#6d4aff" });
    await chrome.action.setBadgeText({ tabId, text: count ? String(count > 99 ? "99+" : count) : "" });
  } catch {
    /* tab closed */
  }
}

// Serialize updates per tab: frames report concurrently and each update is read-modify-write.
const tabLocks = new Map<number, Promise<void>>();
function handleReport(tabId: number, frameId: number, report: FrameReport): Promise<void> {
  const prev = tabLocks.get(tabId) ?? Promise.resolve();
  const next = prev.then(() => applyReport(tabId, frameId, report)).catch(() => undefined);
  tabLocks.set(tabId, next);
  void next.then(() => {
    if (tabLocks.get(tabId) === next) tabLocks.delete(tabId);
  });
  return next;
}

async function applyReport(tabId: number, frameId: number, report: FrameReport): Promise<void> {
  let tab = await getTab(tabId);
  if (frameId === 0 && (!tab || tab.pageId !== report.pageId)) {
    tab = { pageId: report.pageId, pageUrl: report.pageUrl, title: report.title, frames: {} };
  }
  if (!tab) tab = { pageId: "", pageUrl: "", title: "", frames: {} };
  tab.frames[String(frameId)] = report;
  if (frameId === 0) {
    tab.title = report.title;
    tab.pageUrl = report.pageUrl;
  }
  await setTab(tabId, tab);
  await updateBadge(tabId, tab);
}

// ---------- Size lookup (only with the optional host permission) ----------

async function hasHostAccess(): Promise<boolean> {
  return chrome.permissions.contains({ origins: ["<all_urls>"] });
}

async function probe(url: string): Promise<ProbeResult> {
  const cached = probeCache.get(url);
  if (cached) return cached;
  const result: ProbeResult = {};
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    // credentials: "omit" — never send the user's cookies with metadata lookups.
    let res = await fetch(url, { method: "HEAD", credentials: "omit", signal: ctrl.signal, cache: "no-store" });
    if (!res.ok || !res.headers.get("content-length")) {
      res = await fetch(url, { headers: { Range: "bytes=0-0" }, credentials: "omit", signal: ctrl.signal, cache: "no-store" });
      const cr = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
      if (res.status === 206 && cr) {
        result.size = Number(cr[1]);
        result.acceptRanges = true;
      }
      void res.body?.cancel().catch(() => undefined);
    }
    if (result.size == null && res.ok) {
      const len = Number(res.headers.get("content-length"));
      if (Number.isFinite(len) && len > 0 && res.status === 200) result.size = len;
      result.acceptRanges = result.acceptRanges ?? res.headers.get("accept-ranges") === "bytes";
    }
    const mime = res.headers.get("content-type");
    if (mime) result.mime = mime.split(";")[0].trim();
  } catch {
    /* unreachable or blocked: no size */
  } finally {
    clearTimeout(t);
  }
  probeCache.set(url, result);
  if (probeCache.size > 500) probeCache.delete(probeCache.keys().next().value!);
  return result;
}

async function probeMany(urls: string[]): Promise<Record<string, ProbeResult>> {
  const settings = await getSettings();
  if (!settings.lookUpSizes || !(await hasHostAccess())) return {};
  const list = [...new Set(urls)].filter((u) => /^https?:/.test(u)).slice(0, 40);
  const out: Record<string, ProbeResult> = {};
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const u = list[i++];
      out[u] = await probe(u);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

// ---------- Downloads via chrome.downloads ----------

async function getHistory(): Promise<DownloadEntry[]> {
  const { downloads } = await chrome.storage.local.get("downloads");
  return (downloads as DownloadEntry[] | undefined) ?? [];
}

async function addHistory(entry: DownloadEntry): Promise<void> {
  const list = await getHistory();
  list.unshift(entry);
  await chrome.storage.local.set({ downloads: list.slice(0, MAX_DOWNLOAD_HISTORY) });
}

async function startDownloads(items: Array<{ url: string; filename: string }>, pageTitle?: string): Promise<StartResult[]> {
  const settings = await getSettings();
  const folder = cleanSubfolder(settings.subfolder);
  const results: StartResult[] = [];
  for (const item of items) {
    if (!/^https?:\/\//i.test(item.url)) {
      results.push({ url: item.url, ok: false, error: "Only http(s) files can be downloaded." });
      continue;
    }
    const name = sanitizeFilename(item.filename, "download");
    try {
      const id = await chrome.downloads.download({
        url: item.url,
        filename: folder ? `${folder}/${name}` : name,
        saveAs: settings.saveAs,
        conflictAction: "uniquify",
      });
      if (typeof id !== "number") throw new Error(chrome.runtime.lastError?.message ?? "Chrome refused the download.");
      await addHistory({ id, url: item.url, filename: name, pageTitle, startedAt: Date.now() });
      results.push({ url: item.url, ok: true, downloadId: id });
    } catch (e) {
      results.push({ url: item.url, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

// ---------- Wiring ----------

/** True for the extension's own pages (popup, options). Content scripts run inside web pages and have `sender.tab`. */
function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !sender.tab && typeof sender.url === "string" && sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  if (msg?.type === "media:update") {
    const tabId = sender.tab?.id;
    if (tabId == null || tabId < 0) return false;
    void handleReport(tabId, sender.frameId ?? 0, msg.report);
    return false;
  }
  // Everything else reads other tabs' state or starts downloads: only the popup/options pages may ask.
  if (!fromExtensionPage(sender)) return false;
  switch (msg?.type) {
    case "media:get": {
      void getTab(msg.tabId).then((tab) => sendResponse({ ...aggregate(tab), title: tab?.title ?? "", pageUrl: tab?.pageUrl ?? "" }));
      return true;
    }
    case "media:probe": {
      void probeMany(msg.urls).then(sendResponse);
      return true;
    }
    case "download:start": {
      void startDownloads(msg.items, msg.pageTitle).then(sendResponse);
      return true;
    }
    default:
      return false;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(tabKey(tabId));
});

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.sync.get("settings");
  if (!settings) await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
  // Session storage is readable by content scripts only if we allow it; we don't.
  await chrome.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
});

// When the user removes the optional host permission, turn the feature off.
chrome.permissions.onRemoved.addListener(async (p) => {
  if (p.origins?.includes("<all_urls>")) {
    const s = await getSettings();
    if (s.lookUpSizes) await chrome.storage.sync.set({ settings: { ...s, lookUpSizes: false } });
  }
});
