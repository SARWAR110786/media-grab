import { detectMedia } from "./lib/detect";
import { getSettings, type ExtensionSettings } from "./lib/settings";
import type { FrameReport, Message } from "./lib/types";

declare global {
  interface Window {
    __mediagrabContent?: { rescan: () => FrameReport };
  }
}

(function main() {
  if (window.__mediagrabContent) {
    window.__mediagrabContent.rescan();
    return;
  }
  const isTop = window === window.top;
  const pageId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  let settings: ExtensionSettings | null = null;
  let lastSent = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let observing = false;

  // Lets the MediaGrab web app know the extension is installed (DOM attribute only; no data exchanged).
  if (isTop) {
    try {
      document.documentElement.dataset.mediagrabExtension = chrome.runtime.getManifest().version;
    } catch {
      /* extension reloaded */
    }
  }

  function scan(): FrameReport {
    const s = settings ?? { includeFiles: true, showUnsupported: true };
    const { items, notes } = detectMedia(document, { includeFiles: s.includeFiles, showUnsupported: s.showUnsupported }, performance);
    return { pageId, pageUrl: location.href, title: document.title, items, notes };
  }

  function send(force = false): FrameReport {
    const report = scan();
    const key = JSON.stringify([report.items, report.notes, report.title]);
    if (force || key !== lastSent) {
      lastSent = key;
      // Subframes with nothing to report stay quiet.
      if (isTop || report.items.length || force) {
        chrome.runtime.sendMessage({ type: "media:update", report } satisfies Message).catch(() => undefined);
      }
    }
    return report;
  }

  function schedule(delay = 500) {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      send();
    }, delay);
  }

  function observe() {
    if (observing) return;
    observing = true;
    new MutationObserver(() => schedule()).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "href", "data", "content"],
    });
    for (const ev of ["loadedmetadata", "durationchange", "play", "emptied", "encrypted"]) {
      document.addEventListener(ev, () => schedule(200), true);
    }
    try {
      new PerformanceObserver(() => schedule(800)).observe({ type: "resource", buffered: false });
    } catch {
      /* unsupported */
    }
    window.addEventListener("pageshow", () => send(true));
  }

  window.__mediagrabContent = { rescan: () => send(true) };

  chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
    if (msg?.type === "mediagrab:rescan") {
      sendResponse(send(true));
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) {
      void getSettings().then((s) => {
        settings = s;
        if (s.autoDetect) observe();
        send(true);
      });
    }
  });

  void getSettings().then((s) => {
    settings = s;
    if (s.autoDetect) {
      observe();
      send(true);
    } else if (isTop) {
      // Still register the page so the popup can show its title.
      chrome.runtime.sendMessage({ type: "media:update", report: { pageId, pageUrl: location.href, title: document.title, items: [], notes: [] } } satisfies Message).catch(() => undefined);
    }
  });
})();
