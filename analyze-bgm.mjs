import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sampleRate = 22050;
const frameSize = 220;
const frameSeconds = frameSize / sampleRate;
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";

function decodeAudio(inputPath, outputPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpegPath, [
      "-hide_banner",
      "-loglevel", "error",
      "-i", inputPath,
      "-vn",
      "-ac", "1",
      "-ar", String(sampleRate),
      "-f", "f32le",
      "-y", outputPath
    ], { stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`FFmpeg audio decode exited with code ${code}.`));
    });
  });
}

function analyzeEnvelope(samples) {
  const frameCount = Math.floor(samples.length / frameSize);
  const rms = new Float32Array(frameCount);
  const highFrequency = new Float32Array(frameCount);
  let previous = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * frameSize;
    let energy = 0;
    let highEnergy = 0;
    for (let index = start; index < start + frameSize; index += 1) {
      const sample = samples[index];
      const delta = sample - previous;
      energy += sample * sample;
      highEnergy += delta * delta;
      previous = sample;
    }
    rms[frame] = Math.sqrt(energy / frameSize);
    highFrequency[frame] = Math.sqrt(highEnergy / frameSize);
  }

  const onset = new Float64Array(frameCount);
  for (let frame = 3; frame < frameCount; frame += 1) {
    const recent = (rms[frame - 1] + rms[frame - 2] + rms[frame - 3]) / 3;
    const highRecent = (highFrequency[frame - 1] + highFrequency[frame - 2] + highFrequency[frame - 3]) / 3;
    onset[frame] = Math.max(0, rms[frame] - recent) + 0.65 * Math.max(0, highFrequency[frame] - highRecent);
  }

  for (let frame = 2; frame < frameCount - 2; frame += 1) {
    onset[frame] = (
      onset[frame - 2] +
      2 * onset[frame - 1] +
      3 * onset[frame] +
      2 * onset[frame + 1] +
      onset[frame + 2]
    ) / 9;
  }
  return onset;
}

function findTempoCandidates(onset) {
  const candidates = [];
  const minimumLag = Math.round(60 / 200 / frameSeconds);
  const maximumLag = Math.round(60 / 60 / frameSeconds);
  let mean = 0;
  for (const value of onset) mean += value;
  mean /= onset.length;
  const centered = Float64Array.from(onset, (value) => value - mean);

  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    let correlation = 0;
    let energy = 0;
    for (let index = lag; index < centered.length; index += 1) {
      correlation += centered[index] * centered[index - lag];
      energy += centered[index] * centered[index];
    }
    candidates.push({
      bpm: 60 / (lag * frameSeconds),
      period: lag * frameSeconds,
      lag,
      score: energy > 0 ? correlation / energy : 0
    });
  }

  return candidates
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map(({ bpm, period, score }) => ({
      bpm: Math.round(bpm * 10) / 10,
      beatSeconds: Number(period.toFixed(4)),
      periodicity: Number(score.toFixed(4))
    }));
}

function findBeatGrid(onset, beatSeconds) {
  const beatFrames = beatSeconds / frameSeconds;
  const frameCount = onset.length;
  let bestPhase = 0;
  let bestScore = -Infinity;

  for (let phase = 0; phase < beatFrames; phase += 1) {
    let score = 0;
    let count = 0;
    for (let frame = Math.round(phase); frame < frameCount; frame += Math.round(beatFrames)) {
      score += onset[frame] + onset[Math.max(0, frame - 1)] * 0.5;
      count += 1;
    }
    if (count && score / count > bestScore) {
      bestScore = score / count;
      bestPhase = phase * frameSeconds;
    }
  }

  const beats = [];
  for (let beat = 0; ; beat += 1) {
    const time = bestPhase + beat * beatSeconds;
    if (time >= frameCount * frameSeconds) break;
    beats.push(Number(time.toFixed(3)));
  }
  return beats;
}

const inputPath = resolve(process.argv[2] || "运气的形状_BGM.mp3");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "vibe-bgm-"));
const pcmPath = join(temporaryDirectory, "analysis.f32");

try {
  await decodeAudio(inputPath, pcmPath);
  const pcm = await readFile(pcmPath);
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
  const envelope = analyzeEnvelope(samples);
  const candidates = findTempoCandidates(envelope);
  const selectedTempo = candidates[0];
  const beats = findBeatGrid(envelope, selectedTempo.beatSeconds);
  const bars = beats.filter((_, index) => index % 4 === 0);
  console.log(JSON.stringify({
    input: inputPath,
    durationSeconds: Number((samples.length / sampleRate).toFixed(3)),
    sampleRate,
    method: "10 ms RMS rise and high-frequency transient envelope autocorrelation",
    tempoCandidates: candidates,
    selectedBpm: selectedTempo.bpm,
    beatSeconds: selectedTempo.beatSeconds,
    beatPhaseSeconds: beats[0] ?? 0,
    beatCount: beats.length,
    barGridSeconds: bars
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
