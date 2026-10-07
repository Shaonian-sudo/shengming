import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const root = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const duration = Number(option("--duration", "10"));
const outputPath = resolve(root, option("--output", "sample_10s.mp4"));
const stillsOnly = args.includes("--stills-only");
const musicPath = resolve(root, option("--music", "运气的形状_BGM.mp3"));
const frameRate = 30;
const frameCount = Math.round(duration * frameRate);
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";

if (!Number.isFinite(duration) || duration <= 0 || duration > 120) {
  throw new Error("The renderer accepts durations from 0 to 120 seconds.");
}

async function captureFrame(page, seconds, destination) {
  await page.evaluate((time) => window.renderAt(time), seconds);
  await page.screenshot({ path: destination, type: "png" });
}

async function analyzeMusic(path) {
  const { stdout } = await execFileAsync(process.execPath, [
    join(root, "analyze-bgm.mjs"),
    path
  ], {
    cwd: root,
    env: { ...process.env, FFMPEG_PATH: ffmpegPath },
    maxBuffer: 1024 * 1024
  });
  return JSON.parse(stdout);
}

function chooseSceneCuts(analysis, totalDuration) {
  const cutTimes = [];
  for (let scene = 1; scene <= 11; scene += 1) {
    const target = totalDuration * scene / 12;
    const candidates = analysis.barGridSeconds.filter((time) =>
      time > (cutTimes.at(-1) ?? 0) + 7.5 &&
      time < totalDuration - (12 - scene) * 7.5
    );
    const nearest = candidates.reduce((best, time) =>
      Math.abs(time - target) < Math.abs(best - target) ? time : best
    );
    if (nearest === undefined) {
      throw new Error(`No suitable bar-aligned cut found for scene ${scene + 1}.`);
    }
    cutTimes.push(nearest);
  }
  return cutTimes;
}

function buildStillSchedule(duration, sceneCutTimes) {
  if (duration <= 10) return [2, 3, 4.5, 9].map((time, index) => ({
    time,
    name: `opening_${String(time).replace(".", "_")}s.png`
  }));

  const bounds = [0, ...sceneCutTimes, duration];
  return Array.from({ length: bounds.length - 1 }, (_, index) => {
    const time = (bounds[index] + bounds[index + 1]) / 2;
    return {
      time,
      name: `scene_${String(index + 1).padStart(2, "0")}_${time.toFixed(1).replace(".", "_")}s.png`
    };
  });
}

async function renderStills(page, stillsDirectory, schedule) {
  await mkdir(stillsDirectory, { recursive: true });
  for (const still of schedule) {
    await captureFrame(page, still.time, join(stillsDirectory, still.name));
  }
}

function runFfmpeg(framesDirectory, hasAudio) {
  return new Promise((resolvePromise, rejectPromise) => {
    const input = join(framesDirectory, "frame_%05d.jpg");
    const ffmpegArgs = [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-framerate", String(frameRate),
      "-i", input,
    ];
    if (hasAudio) ffmpegArgs.push("-i", musicPath);
    ffmpegArgs.push(
      "-t", String(duration),
      "-map", "0:v:0",
      "-c:v", "h264_mf",
      "-quality", "90",
      "-b:v", "8M",
      "-pix_fmt", "yuv420p",
    );
    if (hasAudio) {
      ffmpegArgs.push(
        "-map", "1:a:0",
        "-af", `atrim=duration=${duration},afade=t=out:st=${Math.max(0, duration - 2)}:d=2`,
        "-c:a", "aac",
        "-b:a", "192k"
      );
    }
    ffmpegArgs.push("-movflags", "+faststart", outputPath);
    const child = spawn(ffmpegPath, ffmpegArgs, { stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`FFmpeg exited with code ${code}.`));
    });
  });
}

const needsAudio = duration > 10 && !stillsOnly;
let timing = {
  beatSeconds: 0.8,
  beatPhaseSeconds: 0,
  sceneCutTimes: Array.from({ length: 11 }, (_, index) => (index + 1) * 10)
};
if (duration > 10) {
  const analysis = await analyzeMusic(musicPath);
  timing = {
    beatSeconds: analysis.beatSeconds,
    beatPhaseSeconds: analysis.beatPhaseSeconds,
    sceneCutTimes: chooseSceneCuts(analysis, duration)
  };
  console.log(`BGM analysis: ${analysis.selectedBpm} BPM; scene cuts at ${timing.sceneCutTimes.map((time) => time.toFixed(2)).join(", ")} seconds.`);
  console.log(`Source BGM is ${analysis.durationSeconds}s; the film uses the first ${duration}s with a 2s fade-out.`);
}

const stillsDirectory = join(root, duration > 10 ? "stills_full" : "stills");
const stillSchedule = buildStillSchedule(duration, timing.sceneCutTimes);
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1
});
await page.goto(pathToFileURL(join(root, "index.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.evaluate((value) => window.configureTiming(value), timing);
await renderStills(page, stillsDirectory, stillSchedule);

if (!stillsOnly) {
  const framesDirectory = await mkdtemp(join(root, ".frames-"));
  try {
    for (let frame = 0; frame < frameCount; frame += 1) {
      const seconds = frame / frameRate;
      const framePath = join(framesDirectory, `frame_${String(frame + 1).padStart(5, "0")}.jpg`);
      await page.evaluate((time) => window.renderAt(time), seconds);
      await page.screenshot({ path: framePath, type: "jpeg", quality: 94 });
      if (frame > 0 && frame % (frameRate * 10) === 0) {
        console.log(`Rendered ${Math.floor(frame / frameRate)} / ${duration} seconds.`);
      }
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await runFfmpeg(framesDirectory, needsAudio);
  } finally {
    await rm(framesDirectory, { recursive: true, force: true });
  }
}

await browser.close();
console.log(stillsOnly ? `Still frames saved to ${stillsDirectory}` : `Video saved to ${outputPath}`);
