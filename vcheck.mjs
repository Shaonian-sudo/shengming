import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, ".vcheck");
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const sceneCuts = [10.374, 18.354, 26.334, 35.910, 49.476, 57.456, 67.830, 75.810, 84.588, 94.164, 107.730];
const bounds = [0, ...sceneCuts, 120];
const times = bounds.slice(0, -1).map((start, i) => (start + bounds[i + 1]) / 2);

const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(root, "index.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.evaluate((cuts) => window.configureTiming({ beatSeconds: 0.798, beatPhaseSeconds: 0, sceneCutTimes: cuts }), sceneCuts);
await mkdir(outDir, { recursive: true });
for (let i = 0; i < times.length; i += 1) {
  await page.evaluate((t) => window.renderAt(t), times[i]);
  await page.screenshot({ path: join(outDir, `scene_${String(i + 1).padStart(2, "0")}_${times[i].toFixed(1)}.png`), type: "png" });
}
await browser.close();
console.log("stills saved to", outDir);
console.log("scene center times:", times.map((t) => t.toFixed(2)).join(", "));
