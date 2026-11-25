import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { writeIcons } from "./scripts/icons.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");
const watch = process.argv.includes("--watch");
const zipTarget = path.resolve(root, "../web/public/mediagrab-extension.zip");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

function copyStatic() {
  for (const f of fs.readdirSync(path.join(root, "static"))) fs.copyFileSync(path.join(root, "static", f), path.join(dist, f));
  writeIcons(path.join(dist, "icons"));
}

function zipDist() {
  const files = {};
  const walk = (dir, prefix = "") => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else files[`mediagrab-extension/${rel}`] = fs.readFileSync(full);
    }
  };
  walk(dist);
  fs.mkdirSync(path.dirname(zipTarget), { recursive: true });
  fs.writeFileSync(zipTarget, zipSync(files, { level: 9 }));
  console.log(`Packaged ${Object.keys(files).length} files → ${path.relative(process.cwd(), zipTarget)}`);
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
  logLevel: "info",
};

copyStatic();
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching for changes… (reload the extension in chrome://extensions after edits)");
} else {
  await esbuild.build(options);
  zipDist();
}
