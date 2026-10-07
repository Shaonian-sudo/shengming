// 生成情绪音效并与 BGM 混音：运气的形状_BGM_withsfx.mp3
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const musicPath = resolve(root, "运气的形状_BGM.mp3");
const outPath = resolve(root, "运气的形状_BGM_withsfx.mp3");

const run = (args) => new Promise((resolveFn, rejectFn) => {
  const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => { err += d.toString(); });
  child.on("close", (code) => {
    if (code === 0) resolveFn();
    else rejectFn(new Error(`ffmpeg exit ${code}: ${err.slice(-600)}`));
  });
});

// 生成单个音效 wav
const sfxDir = await mkdtemp(join(tmpdir(), "lzdsfx-"));
const wav = (name) => join(sfxDir, `${name}.wav`);

// boom：低频冲击（42Hz 基频 + 谐波，快速衰减）
await run(["-y", "-f", "lavfi", "-i",
  "aevalsrc=0.85*sin(2*PI*42*t)*exp(-3.2*t)+0.32*sin(2*PI*84*t)*exp(-4.2*t)+0.16*sin(2*PI*168*t)*exp(-5.5*t):s=48000:d=1.7",
  "-c:a", "pcm_s16le", wav("boom")]);

// boom2：稍轻的冲击（金句）
await run(["-y", "-f", "lavfi", "-i",
  "aevalsrc=0.62*sin(2*PI*46*t)*exp(-3.4*t)+0.22*sin(2*PI*92*t)*exp(-4.4*t):s=48000:d=1.4",
  "-c:a", "pcm_s16le", wav("boom2")]);

// rising：反转渐强（220→900Hz 扫频，5s 铺垫，音量 0→0.3）
await run(["-y", "-f", "lavfi", "-i",
  "aevalsrc=0.3*sin(2*PI*(220*t+68*t*t))*(t/5)*(t/5):s=48000:d=5.0",
  "-c:a", "pcm_s16le", wav("rising")]);

// whoosh：曲线展开（粉噪带通）
await run(["-y", "-f", "lavfi", "-i",
  "anoisesrc=colour=pink:s=48000:d=1.9:a=0.5",
  "-af", "bandpass=f=700:width_type=h:width=900,afade=t=in:d=0.15,afade=t=out:st=1.4:d=0.5",
  "-c:a", "pcm_s16le", wav("whoosh")]);

// tickseq：钟表滴答（单声 0.07s → 补齐 0.798s 拍长单元 → 循环 9 次）
await run(["-y", "-f", "lavfi", "-i",
  "aevalsrc=0.4*sin(2*PI*1900*t)*exp(-55*t):s=48000:d=0.07",
  "-c:a", "pcm_s16le", wav("tick")]);
await run(["-y", "-i", wav("tick"),
  "-af", "apad=whole_dur=0.798",
  "-t", "0.798", "-c:a", "pcm_s16le", wav("tickunit")]);
await run(["-y", "-i", wav("tickunit"),
  "-filter_complex", "aloop=loop=8:size=38304,atrim=duration=7.0",
  "-c:a", "pcm_s16le", wav("tickseq")]);

// wind：环境风声（棕色噪声低通）
await run(["-y", "-f", "lavfi", "-i",
  "anoisesrc=colour=brown:s=48000:d=9.5:a=0.5",
  "-af", "lowpass=f=380,afade=t=in:d=2.0,afade=t=out:st=7.2:d=2.3",
  "-c:a", "pcm_s16le", wav("wind")]);

// bell：结尾钟响（660Hz + 八度谐波长余音）
await run(["-y", "-f", "lavfi", "-i",
  "aevalsrc=0.5*sin(2*PI*660*t)*exp(-1.05*t)+0.18*sin(2*PI*1320*t)*exp(-1.4*t):s=48000:d=2.4",
  "-af", "afade=t=in:d=0.05",
  "-c:a", "pcm_s16le", wav("bell")]);

// 混音：BGM + 各音效（adelay 对齐时间点）
const delay = (ms) => `adelay=${ms}|${ms}`;
const filter = [
  "[1:a]" + delay(43590) + "[b1]",   // S5 定格冲击 43.59s
  "[2:a]" + delay(38600) + "[b2]",   // S5 反转渐强 38.6s
  "[3:a]" + delay(60350) + "[b3]",   // S7 曲线展开 60.35s
  "[4:a]" + delay(89580) + "[b4]",   // S10 金句冲击 89.58s
  "[5:a]" + delay(104260) + "[b5]",  // S11 中点落定 104.26s
  "[6:a]" + delay(19400) + "[b6]",   // S3 钟表滴答 19.4s
  "[7:a]" + delay(110930) + "[b7]",  // S12 环境风 110.93s
  "[8:a]" + delay(118500) + "[b8]",  // S12 结尾钟响 118.5s
  "[0:a][b1][b2][b3][b4][b5][b6][b7][b8]amix=inputs=9:normalize=0:dropout_transition=0,alimiter=limit=0.95[aout]"
].join(";");

await run([
  "-y",
  "-i", musicPath,
  "-i", wav("boom"),
  "-i", wav("rising"),
  "-i", wav("whoosh"),
  "-i", wav("boom2"),
  "-i", wav("boom2"),
  "-i", wav("tickseq"),
  "-i", wav("wind"),
  "-i", wav("bell"),
  "-filter_complex", filter,
  "-map", "[aout]",
  "-c:a", "libmp3lame", "-q:a", "2",
  outPath
]);

await rm(sfxDir, { recursive: true, force: true });
console.log("SFX mixed into", outPath);
