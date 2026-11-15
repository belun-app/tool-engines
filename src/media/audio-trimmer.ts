/**
 * Audio trimmer / MP3 cutter.
 *
 * Two independent cut paths, because they have different strengths:
 *
 *  1. `sliceMp3` copies whole MPEG audio frames out of the original byte stream.
 *     Nothing is decoded and nothing is re-encoded, so the cut keeps the exact
 *     bits of the source — but it can only land on frame boundaries (26 ms at
 *     44.1 kHz) and it cannot apply fades.
 *  2. `cutPcm` + `encodeWav` work on samples decoded by the host (Web Audio in
 *     the browser). Sample-accurate, fades allowed, any input format the host
 *     can decode — at the cost of an uncompressed output file.
 *
 * Both are pure functions over byte arrays and sample arrays; no DOM, no deps.
 */

import { computeWaveformPeaks, encodeWav, formatBytes, formatDuration } from "./voice-recorder.js";

export { computeWaveformPeaks, encodeWav, formatBytes, formatDuration };

/* ------------------------------------------------------------------ */
/* Timecodes                                                           */
/* ------------------------------------------------------------------ */

/** Format seconds as `m:ss.mmm`, or `h:mm:ss.mmm` past the hour mark. */
export function formatTimecode(seconds: number, withMillis = true): string {
  const positive = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  // Round once, in whole milliseconds, so 1.9996 s carries into 0:02.000 instead of
  // printing a four-digit "0:01.1000". Without milliseconds the seconds are floored.
  const totalMs = withMillis ? Math.round(positive * 1000) : Math.floor(positive) * 1000;
  const total = Math.floor(totalMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const millis = totalMs % 1000;
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const head = hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
  return withMillis ? `${head}.${pad(millis, 3)}` : head;
}

/**
 * Read a typed timecode back into seconds. Accepts `12`, `12.5`, `1:23`,
 * `1:23.250` and `0:01:23.25`; returns null for anything else so the caller can
 * leave the previous value alone instead of jumping to zero on every keystroke.
 */
export function parseTimecode(text: string): number | null {
  const raw = (text ?? "").trim().replace(",", ".");
  if (!raw) return null;
  if (!/^\d{1,2}(:\d{1,2}){0,2}(\.\d{1,3})?$/.test(raw)) return null;

  const parts = raw.split(":");
  let seconds = 0;
  for (const part of parts) {
    const value = Number.parseFloat(part);
    if (!Number.isFinite(value)) return null;
    seconds = seconds * 60 + value;
  }
  return seconds;
}

/* ------------------------------------------------------------------ */
/* Selection range                                                     */
/* ------------------------------------------------------------------ */

export interface TrimRange {
  startSec: number;
  endSec: number;
  /** Length of the kept part. */
  durationSec: number;
}

/** Clamp a selection into the file and keep at least 10 ms between the handles. */
export function normalizeRange(startSec: number, endSec: number, totalSec: number): TrimRange {
  const total = Number.isFinite(totalSec) && totalSec > 0 ? totalSec : 0;
  if (total === 0) return { startSec: 0, endSec: 0, durationSec: 0 };

  let start = Number.isFinite(startSec) ? Math.min(Math.max(startSec, 0), total) : 0;
  let end = Number.isFinite(endSec) ? Math.min(Math.max(endSec, 0), total) : total;
  if (end < start) {
    const swap = start;
    start = end;
    end = swap;
  }

  const minimum = Math.min(0.01, total);
  if (end - start < minimum) {
    if (start + minimum <= total) end = start + minimum;
    else start = Math.max(0, total - minimum);
  }

  return { startSec: start, endSec: end, durationSec: end - start };
}

/* ------------------------------------------------------------------ */
/* PCM path — sample-accurate cut with fades                           */
/* ------------------------------------------------------------------ */

export interface PcmCut {
  channels: Float32Array[];
  sampleRate: number;
  durationSec: number;
  frameCount: number;
}

const EMPTY_PCM: PcmCut = { channels: [], sampleRate: 44100, durationSec: 0, frameCount: 0 };

/** A fade can never be longer than half the cut, or the two ramps would overlap. */
function clampFade(seconds: number, frameCount: number, sampleRate: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(Math.floor(seconds * sampleRate), Math.floor(frameCount / 2));
}

/**
 * Copy the selected window out of decoded channels and fade the ends.
 *
 * The fade curve is a quarter sine, not a straight line: a linear ramp on
 * amplitude is heard as a sudden rush at the end, because loudness tracks
 * roughly the square of amplitude. The sine curve holds the perceived level
 * steady across the ramp.
 */
export function cutPcm(
  channels: Float32Array[],
  sampleRate: number,
  startSec: number,
  endSec: number,
  fadeInSec = 0,
  fadeOutSec = 0,
): PcmCut {
  const valid = (channels ?? []).filter((c) => c && c.length > 0);
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : 44100;
  if (valid.length === 0) return { ...EMPTY_PCM, sampleRate: rate };

  const sourceFrames = Math.min(...valid.map((c) => c.length));
  const totalSec = sourceFrames / rate;
  const { startSec: start, endSec: end } = normalizeRange(startSec, endSec, totalSec);

  const firstFrame = Math.min(sourceFrames, Math.max(0, Math.round(start * rate)));
  const lastFrame = Math.min(sourceFrames, Math.max(firstFrame + 1, Math.round(end * rate)));
  const frameCount = lastFrame - firstFrame;

  const out = valid.map((channel) => channel.slice(firstFrame, lastFrame));

  const fadeIn = clampFade(fadeInSec, frameCount, rate);
  const fadeOut = clampFade(fadeOutSec, frameCount, rate);

  for (const channel of out) {
    for (let i = 0; i < fadeIn; i++) {
      channel[i] *= Math.sin((i / fadeIn) * (Math.PI / 2));
    }
    for (let i = 0; i < fadeOut; i++) {
      const index = frameCount - 1 - i;
      if (index < 0) break;
      channel[index] *= Math.sin((i / fadeOut) * (Math.PI / 2));
    }
  }

  return { channels: out, sampleRate: rate, durationSec: frameCount / rate, frameCount };
}

/** Mix channels down to one array so a stereo file can be drawn as one waveform. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  const valid = (channels ?? []).filter((c) => c && c.length > 0);
  if (valid.length === 0) return new Float32Array(0);
  if (valid.length === 1) return valid[0];

  const frames = Math.min(...valid.map((c) => c.length));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (const channel of valid) sum += channel[i];
    mono[i] = sum / valid.length;
  }
  return mono;
}

/** Per-bucket peaks for the whole file, ready to paint as a fixed-width waveform. */
export function waveformFromChannels(channels: Float32Array[], buckets: number): number[] {
  return computeWaveformPeaks(mixToMono(channels), buckets);
}

/* ------------------------------------------------------------------ */
/* MP3 path — frame-aligned lossless cut                               */
/* ------------------------------------------------------------------ */

export interface Mp3Frame {
  /** Byte offset of the frame header inside the original file. */
  offset: number;
  /** Total frame length in bytes, header included. */
  size: number;
  durationSec: number;
}

export interface Mp3Info {
  frames: Mp3Frame[];
  /** Summed frame durations — more reliable than any header field. */
  durationSec: number;
  sampleRate: number;
  channels: number;
  /** MPEG version as written in the header: "1", "2" or "2.5". */
  version: string;
  /** 1, 2 or 3 — practically always 3 for a file called ".mp3". */
  layer: number;
  averageBitrateKbps: number;
  /** True when frames disagree about bitrate, i.e. the file is VBR. */
  variableBitrate: boolean;
  /** Bytes of ID3v2 tag skipped before the first frame. */
  tagBytes: number;
}

const SAMPLE_RATES: Record<string, number[]> = {
  "1": [44100, 48000, 32000],
  "2": [22050, 24000, 16000],
  "2.5": [11025, 12000, 8000],
};

// Bitrate tables, indexed [layer][bitrate index]. Index 0 is "free format" and
// index 15 is invalid; both are treated as "this is not a frame header".
const BITRATES_V1: Record<number, number[]> = {
  1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
};
const BITRATES_V2: Record<number, number[]> = {
  1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

interface FrameHeader {
  size: number;
  durationSec: number;
  sampleRate: number;
  channels: number;
  bitrateKbps: number;
  version: string;
  layer: number;
  /** Bytes between the frame start and the main data, used for Xing detection. */
  sideInfoOffset: number;
}

/** Decode a 4-byte MPEG audio frame header, or return null if it is not one. */
function readFrameHeader(bytes: Uint8Array, at: number): FrameHeader | null {
  if (at + 4 > bytes.length) return null;
  const b0 = bytes[at];
  const b1 = bytes[at + 1];
  const b2 = bytes[at + 2];
  const b3 = bytes[at + 3];

  // 11 sync bits.
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const versionBits = (b1 >> 3) & 0x03;
  if (versionBits === 1) return null; // reserved
  const version = versionBits === 0 ? "2.5" : versionBits === 2 ? "2" : "1";

  const layerBits = (b1 >> 1) & 0x03;
  if (layerBits === 0) return null; // reserved
  const layer = 4 - layerBits;

  const bitrateIndex = (b2 >> 4) & 0x0f;
  if (bitrateIndex === 0 || bitrateIndex === 0x0f) return null;
  const table = version === "1" ? BITRATES_V1 : BITRATES_V2;
  const bitrateKbps = table[layer]?.[bitrateIndex] ?? 0;
  if (!bitrateKbps) return null;

  const rateIndex = (b2 >> 2) & 0x03;
  if (rateIndex === 3) return null;
  const sampleRate = SAMPLE_RATES[version]?.[rateIndex] ?? 0;
  if (!sampleRate) return null;

  const padding = (b2 >> 1) & 0x01;
  const channelMode = (b3 >> 6) & 0x03;
  const channels = channelMode === 3 ? 1 : 2;

  const samplesPerFrame = layer === 1 ? 384 : layer === 2 ? 1152 : version === "1" ? 1152 : 576;
  const size =
    layer === 1
      ? (Math.floor((12 * bitrateKbps * 1000) / sampleRate) + padding) * 4
      : Math.floor(((samplesPerFrame / 8) * bitrateKbps * 1000) / sampleRate) + padding;
  if (size < 24) return null;

  // Layer III side info: 17 bytes mono / 32 stereo on MPEG-1, half that on MPEG-2.
  const monoSide = version === "1" ? 17 : 9;
  const stereoSide = version === "1" ? 32 : 17;
  const sideInfo = layer === 3 ? (channels === 1 ? monoSide : stereoSide) : 0;
  const crc = (b1 & 0x01) === 0 ? 2 : 0; // a cleared protection bit means a CRC follows

  return {
    size,
    durationSec: samplesPerFrame / sampleRate,
    sampleRate,
    channels,
    bitrateKbps,
    version,
    layer,
    sideInfoOffset: 4 + crc + sideInfo,
  };
}

/** Length of a leading ID3v2 tag, including the optional footer. 0 when absent. */
export function id3v2Length(bytes: Uint8Array): number {
  if (!bytes || bytes.length < 10) return 0;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0; // "ID3"
  const flags = bytes[5];
  const size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  return 10 + size + ((flags & 0x10) !== 0 ? 10 : 0);
}

/** True when a frame carries a Xing/Info/VBRI table instead of audible audio. */
function isMetadataFrame(bytes: Uint8Array, frameStart: number, header: FrameHeader): boolean {
  const probe = (at: number, tag: string) => {
    if (at + tag.length > bytes.length) return false;
    for (let i = 0; i < tag.length; i++) {
      if (bytes[at + i] !== tag.charCodeAt(i)) return false;
    }
    return true;
  };
  const xingAt = frameStart + header.sideInfoOffset;
  return probe(xingAt, "Xing") || probe(xingAt, "Info") || probe(frameStart + 36, "VBRI");
}

/**
 * Walk the MPEG frame table of an MP3 file.
 *
 * Returns null when the bytes are not a frame-parseable MPEG stream (an M4A, a
 * WAV, a truncated download), which is the caller's signal that only the decoded
 * WAV path is available. At least two frames are required: a stray 0xFF 0xFB
 * pair inside an embedded album cover is not an audio stream.
 */
export function parseMp3(bytes: Uint8Array): Mp3Info | null {
  if (!bytes || bytes.length < 128) return null;

  const tagBytes = id3v2Length(bytes);
  const frames: Mp3Frame[] = [];
  let sampleRate = 0;
  let channels = 0;
  let version = "";
  let layer = 0;
  let totalBits = 0;
  let firstBitrate = 0;
  let variableBitrate = false;

  let at = Math.min(tagBytes, bytes.length);
  let seenFirst = false;
  // A broken byte in the middle must not cost us the rest of the file, but an
  // unbounded resync over a large non-audio blob must not hang the tab either.
  let resyncBudget = 512 * 1024;

  while (at + 4 <= bytes.length) {
    const header = readFrameHeader(bytes, at);
    if (!header) {
      if (resyncBudget-- <= 0) break;
      at++;
      continue;
    }

    if (!seenFirst) {
      sampleRate = header.sampleRate;
      channels = header.channels;
      version = header.version;
      layer = header.layer;
      firstBitrate = header.bitrateKbps;
    } else if (header.sampleRate !== sampleRate || header.version !== version) {
      // The stream has to stay internally consistent; a sample rate that
      // changes mid-file means we resynced onto noise rather than onto a frame.
      if (resyncBudget-- <= 0) break;
      at++;
      continue;
    }

    if (at + header.size > bytes.length) break;

    if (!seenFirst && isMetadataFrame(bytes, at, header)) {
      // Xing/Info/VBRI frame: a real frame that decodes to silence and
      // describes the original file. Dropping it keeps the cut from opening
      // with a gap and from advertising a length it no longer has.
      seenFirst = true;
      at += header.size;
      continue;
    }

    seenFirst = true;
    if (header.bitrateKbps !== firstBitrate) variableBitrate = true;
    totalBits += header.size * 8;
    frames.push({ offset: at, size: header.size, durationSec: header.durationSec });
    at += header.size;
  }

  if (frames.length < 2) return null;

  const durationSec = frames.reduce((sum, f) => sum + f.durationSec, 0);

  return {
    frames,
    durationSec,
    sampleRate,
    channels,
    version,
    layer,
    averageBitrateKbps: durationSec > 0 ? Math.round(totalBits / durationSec / 1000) : 0,
    variableBitrate,
    tagBytes,
  };
}

export interface Mp3Slice {
  bytes: Uint8Array;
  /** Where the cut actually begins after snapping to a frame boundary. */
  startSec: number;
  endSec: number;
  durationSec: number;
  frameCount: number;
  /** How far the two handles moved to reach a frame boundary, in seconds. */
  snapSec: number;
}

const EMPTY_SLICE: Mp3Slice = {
  bytes: new Uint8Array(0),
  startSec: 0,
  endSec: 0,
  durationSec: 0,
  frameCount: 0,
  snapSec: 0,
};

/**
 * Copy the frames covering [startSec, endSec) into a new MP3.
 *
 * Boundaries snap to the nearest frame edge, with half a frame of tolerance so
 * a handle parked exactly on a boundary does not pull in its neighbour.
 */
export function sliceMp3(
  bytes: Uint8Array,
  info: Mp3Info,
  startSec: number,
  endSec: number,
): Mp3Slice {
  if (!bytes || !info || info.frames.length === 0) return { ...EMPTY_SLICE };

  const { startSec: start, endSec: end } = normalizeRange(startSec, endSec, info.durationSec);

  let elapsed = 0;
  let firstIndex = -1;
  let lastIndex = -1;
  let firstStart = 0;
  let lastEnd = 0;

  for (let i = 0; i < info.frames.length; i++) {
    const frame = info.frames[i];
    const frameEnd = elapsed + frame.durationSec;
    if (firstIndex === -1 && frameEnd > start + frame.durationSec / 2) {
      firstIndex = i;
      firstStart = elapsed;
    }
    if (firstIndex !== -1 && elapsed < end - frame.durationSec / 2) {
      lastIndex = i;
      lastEnd = frameEnd;
    }
    elapsed = frameEnd;
  }

  if (firstIndex === -1) return { ...EMPTY_SLICE };
  if (lastIndex < firstIndex) {
    lastIndex = firstIndex;
    lastEnd = firstStart + info.frames[firstIndex].durationSec;
  }

  const from = info.frames[firstIndex].offset;
  const to = info.frames[lastIndex].offset + info.frames[lastIndex].size;

  return {
    bytes: bytes.slice(from, Math.min(to, bytes.length)),
    startSec: firstStart,
    endSec: lastEnd,
    durationSec: lastEnd - firstStart,
    frameCount: lastIndex - firstIndex + 1,
    snapSec: Math.abs(firstStart - start) + Math.abs(lastEnd - end),
  };
}

/* ------------------------------------------------------------------ */
/* Summaries and file names                                            */
/* ------------------------------------------------------------------ */

export interface SourceSummary {
  name: string;
  sizeLabel: string;
  durationLabel: string;
  /** Short format label, e.g. "MP3 (MPEG-1 Layer III)" or "WAV". */
  format: string;
  sampleRateLabel: string;
  channelLabel: string;
  /** English label, e.g. "128 kbps CBR"; pages build their own from the fields below. */
  bitrateLabel: string;
  /** Average bitrate in kbit/s, 0 when unknown */
  bitrateKbps: number;
  /** "VBR" / "CBR" for MP3 (codes, not words), "" for other formats */
  bitrateMode: "" | "VBR" | "CBR";
  /** True when the frame table parsed, i.e. a lossless cut is possible. */
  losslessAvailable: boolean;
}

export interface SourceInput {
  name: string;
  sizeBytes: number;
  durationSec: number;
  sampleRate: number;
  channels: number;
  mp3: Mp3Info | null;
}

/** One-line description of the loaded file, shown above the waveform. */
export function summarizeSource(input: SourceInput): SourceSummary {
  const name = input?.name ?? "";
  const mp3 = input?.mp3 ?? null;
  const sizeBytes = Math.max(0, input?.sizeBytes ?? 0);
  const durationSec = Math.max(0, input?.durationSec ?? 0);
  const sampleRate = Math.max(0, Math.round(input?.sampleRate ?? 0));
  const channels = Math.max(0, Math.round(input?.channels ?? 0));

  const extension = name.includes(".") ? (name.split(".").pop() ?? "").toUpperCase() : "";
  const format = mp3
    ? `MP3 (MPEG-${mp3.version} Layer ${"I".repeat(mp3.layer)})`
    : extension || "Audio";

  const bitrateKbps = mp3
    ? mp3.averageBitrateKbps
    : durationSec > 0
      ? Math.round((sizeBytes * 8) / durationSec / 1000)
      : 0;
  const bitrateMode: SourceSummary["bitrateMode"] = mp3
    ? mp3.variableBitrate
      ? "VBR"
      : "CBR"
    : "";
  const bitrateLabel = bitrateKbps
    ? `${bitrateKbps} kbps${bitrateMode ? ` ${bitrateMode}` : ""}`
    : "—";

  return {
    name,
    sizeLabel: formatBytes(sizeBytes),
    durationLabel: formatTimecode(durationSec, false),
    format,
    sampleRateLabel: sampleRate > 0 ? `${(sampleRate / 1000).toFixed(1)} kHz` : "—",
    channelLabel: channels === 1 ? "Mono" : channels >= 2 ? "Stereo" : "—",
    bitrateLabel,
    bitrateKbps,
    bitrateMode,
    losslessAvailable: mp3 !== null,
  };
}

/** Byte size of the WAV that a given selection will produce. */
export function estimateWavBytes(
  durationSec: number,
  sampleRate: number,
  channels: number,
): number {
  const seconds = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  const count = Number.isFinite(channels) && channels > 0 ? Math.round(channels) : 1;
  return 44 + Math.round(seconds * rate) * count * 2;
}

/** Turn `interview.mp3` into `interview-cut.mp3`, keeping the name recognisable. */
export function cutFileName(originalName: string, extension: string): string {
  const base = (originalName ?? "").replace(/\.[^.]+$/, "").trim() || "audio";
  const safe = base.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  const ext = (extension || "wav").replace(/^\./, "");
  return `${safe}-cut.${ext}`;
}
