import { cleanSubfolder, getSettings, saveSettings, type ExtensionSettings } from "./lib/settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const BOOL_KEYS = ["autoDetect", "includeFiles", "showUnsupported", "saveAs"] as const;

let statusTimer: ReturnType<typeof setTimeout> | null = null;
function status(msg: string) {
  $("status").textContent = msg;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => ($("status").textContent = ""), 2500);
}

async function init() {
  const s = await getSettings();
  const hasAccess = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  for (const k of BOOL_KEYS) {
    const input = $<HTMLInputElement>(k);
    input.checked = s[k];
    input.addEventListener("change", async () => {
      await saveSettings({ [k]: input.checked } as Partial<ExtensionSettings>);
      status("Saved");
    });
  }

  const sizes = $<HTMLInputElement>("lookUpSizes");
  sizes.checked = s.lookUpSizes && hasAccess;
  sizes.addEventListener("change", async () => {
    if (sizes.checked) {
      // Must run inside the user gesture.
      const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
      sizes.checked = granted;
      await saveSettings({ lookUpSizes: granted });
      status(granted ? "Saved — file sizes will be looked up" : "Permission not granted");
    } else {
      await chrome.permissions.remove({ origins: ["<all_urls>"] }).catch(() => false);
      await saveSettings({ lookUpSizes: false });
      status("Saved — site access removed");
    }
  });

  const folder = $<HTMLInputElement>("subfolder");
  folder.value = s.subfolder;
  folder.addEventListener("change", async () => {
    folder.value = cleanSubfolder(folder.value);
    await saveSettings({ subfolder: folder.value });
    status("Saved");
  });

  const web = $<HTMLInputElement>("webAppUrl");
  web.value = s.webAppUrl;
  web.addEventListener("change", async () => {
    try {
      const u = new URL(web.value.trim());
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      await saveSettings({ webAppUrl: u.origin });
      web.value = u.origin;
      status("Saved");
    } catch {
      status("Enter a valid http(s) URL");
    }
  });

  const isFirefox = chrome.runtime.getURL("").startsWith("moz-extension:");
  const openBtn = $("openChromeDownloads") as HTMLButtonElement;
  if (isFirefox) {
    // Firefox doesn't let extensions open about:preferences; explain where the setting is instead.
    openBtn.hidden = true;
    $("downloadLocationHint").textContent = "Firefox decides the base folder. Change it in Settings → General → Files and Applications.";
  } else {
    openBtn.addEventListener("click", () => void chrome.tabs.create({ url: "chrome://settings/downloads" }));
  }
}

void init();
