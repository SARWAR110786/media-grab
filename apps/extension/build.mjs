import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { writeIcons } from "./scripts/icons.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");
const distFirefox = path.join(root, "dist-firefox");
const watch = process.argv.includes("--watch");
const publicDir = path.resolve(root, "../web/public");

// Default "web app URL" baked into the extension: an explicit setting, else the Vercel production
// domain when building there, else the local dev server.
const webAppUrl =
  process.env.MEDIAGRAB_WEB_APP_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

for (const d of [dist, distFirefox]) {
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
}

function copyStatic() {
  for (const f of fs.readdirSync(path.join(root, "static"))) fs.copyFileSync(path.join(root, "static", f), path.join(dist, f));
  writeIcons(path.join(dist, "icons"));
}

/**
 * Firefox (128+) runs the same code; only the manifest differs: an event-page background script
 * instead of a service worker, and a Gecko add-on ID.
 */
export function firefoxManifest(chromeManifest) {
  const m = structuredClone(chromeManifest);
  delete m.minimum_chrome_version;
  m.description = chromeManifest.description.replace("Chrome's download manager", "Firefox's download manager");
  m.background = { scripts: [chromeManifest.background.service_worker] };
  m.browser_specific_settings = {
    gecko: {
      id: "mediagrab@sarwar110786.github.io",
      strict_min_version: "128.0",
      data_collection_permissions: { required: ["none"] },
    },
  };
  return m;
}

function copyFirefox() {
  fs.cpSync(dist, distFirefox, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.json"), "utf8"));
  fs.writeFileSync(path.join(distFirefox, "manifest.json"), JSON.stringify(firefoxManifest(manifest), null, 2));
}

/** Chrome's zip wraps a folder (unzip, then "Load unpacked"); Firefox's has the manifest at the root (load the .zip directly). */
function zipDir(dir, target, prefix) {
  const files = {};
  const walk = (d, rel0 = "") => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const rel = rel0 ? `${rel0}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else files[prefix ? `${prefix}/${rel}` : rel] = fs.readFileSync(full);
    }
  };
  walk(dir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, zipSync(files, { level: 9 }));
  console.log(`Packaged ${Object.keys(files).length} files → ${path.relative(process.cwd(), target)}`);
}

const options = {
  entryPoints: {
    background: "src/background.ts",
    content: "src/content.ts",
    popup: "src/popup.ts",
    options: "src/options.ts",
  },
  absWorkingDir: root,
  outdir: dist,
  bundle: true,
  format: "iife",
  target: "chrome116",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  define: { __MEDIAGRAB_WEB_APP_URL__: JSON.stringify(webAppUrl) },
  logLevel: "info",
};

copyStatic();
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching for changes… (reload the extension in chrome://extensions after edits)");
} else {
  await esbuild.build(options);
  copyFirefox();
  zipDir(dist, path.join(publicDir, "mediagrab-extension.zip"), "mediagrab-extension");
  zipDir(distFirefox, path.join(publicDir, "mediagrab-extension-firefox.zip"), "");
  console.log(`Default web app URL: ${webAppUrl}`);
}
