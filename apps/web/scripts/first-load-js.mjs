// Compute route-by-route First Load JS from a Turbopack production build.
// Next 16's Turbopack build summary omits the size column, so we derive it from
// .next/app-build-manifest.json (route -> client chunk list) + gzipped chunk bytes.
// First Load JS = gzipped size of the deduped union of a route's chunks.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const next = path.join(root, ".next");
const manifestPath = path.join(next, "app-build-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error("no app-build-manifest.json; run `pnpm build` first");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const pages = manifest.pages ?? {};

const sizeCache = new Map();
function gzBytes(file) {
  if (sizeCache.has(file)) return sizeCache.get(file);
  const abs = path.join(next, file);
  let n = 0;
  try {
    n = zlib.gzipSync(fs.readFileSync(abs)).length;
  } catch {
    n = 0;
  }
  sizeCache.set(file, n);
  return n;
}

const kb = (n) => (n / 1024).toFixed(1) + " kB";
const rows = [];
for (const [route, files] of Object.entries(pages)) {
  const js = [...new Set(files)].filter((f) => f.endsWith(".js"));
  const total = js.reduce((sum, f) => sum + gzBytes(f), 0);
  rows.push({ route, firstLoad: total, chunks: js.length });
}
rows.sort((a, b) => b.firstLoad - a.firstLoad);

const pad = (s, n) => s.padEnd(n);
console.log(pad("Route", 26) + pad("First Load JS (gzip)", 22) + "chunks");
console.log("-".repeat(56));
for (const r of rows) {
  console.log(pad(r.route, 26) + pad(kb(r.firstLoad), 22) + r.chunks);
}
