export interface ExtensionSettings {
  /** Scan pages automatically as they load. When off, only scans when the popup asks. */
  autoDetect: boolean;
  /** Ask where to save each file (the browser's Save As dialog). */
  saveAs: boolean;
  /** Optional subfolder inside the browser's download folder. */
  subfolder: string;
  /** Detect links to documents, archives and programs, not only audio/video. */
  includeFiles: boolean;
  /** List unsupported items (blob streams, DRM, HLS/DASH) with an explanation. */
  showUnsupported: boolean;
  /** Use the optional host permission to look up file sizes with HEAD requests. */
  lookUpSizes: boolean;
  /** Where the MediaGrab web app runs, for "Open in MediaGrab". */
  webAppUrl: string;
}

/** Set at build time (see build.mjs): the deployed web app, or http://localhost:3000. */
declare const __MEDIAGRAB_WEB_APP_URL__: string;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  autoDetect: true,
  saveAs: false,
  subfolder: "",
  includeFiles: true,
  showUnsupported: true,
  lookUpSizes: false,
  webAppUrl: typeof __MEDIAGRAB_WEB_APP_URL__ === "string" ? __MEDIAGRAB_WEB_APP_URL__ : "http://localhost:3000",
};

export async function getSettings(): Promise<ExtensionSettings> {
  const { settings } = await chrome.storage.sync.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

export async function saveSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ settings: next });
  return next;
}

/** Sanitize a user-provided subfolder into a relative path browsers accept. */
export function cleanSubfolder(input: string): string {
  return input
    .split(/[/\\]+/)
    .map((p) => p.replace(/[<>:"|?*\u0000-\u001f]/g, "").replace(/^\.+/, "").trim())
    .filter((p) => p && p !== "." && p !== "..")
    .join("/")
    .slice(0, 120);
}
