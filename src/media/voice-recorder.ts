/**
 * Voice recording helpers: picks a supported MediaRecorder audio type, computes waveform
 * peaks, encodes PCM samples as a WAV file and formats the result.
 */

/** Candidate container/codec strings, best first, for MediaRecorder audio capture. */
export const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
] as const;

export interface RecordingSummary {
  /** Length of the recording in milliseconds */
  durationMs: number;
  /** Human clock label, mm:ss or h:mm:ss */
  durationLabel: string;
  sizeBytes: number;
  /** Human size label, e.g. "1.4 MB" */
  sizeLabel: string;
  /** Short container/codec label, e.g. "WebM (Opus)" */
  format: string;
  /** File extension without the dot, e.g. "webm" */
  extension: string;
  /** Average bitrate over the whole recording, kbit/s */
  bitrateKbps: number;
}

export interface RecordingInput {
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
}

const EMPTY: RecordingSummary = {
  durationMs: 0,
  durationLabel: "0:00",
  sizeBytes: 0,
  sizeLabel: "0 B",
  format: "—",
  extension: "webm",
  bitrateKbps: 0,
};

/** Build the stats block shown under a finished recording. */
export function summarizeRecording(input: RecordingInput): RecordingSummary {
  const durationMs = Number.isFinite(input?.durationMs) ? Math.max(0, input.durationMs) : 0;
  const sizeBytes = Number.isFinite(input?.sizeBytes) ? Math.max(0, input.sizeBytes) : 0;
  if (durationMs === 0 && sizeBytes === 0) return { ...EMPTY };

  const mimeType = input?.mimeType ?? "";
  const seconds = durationMs / 1000;
  const bitrateKbps = seconds > 0 ? Math.round((sizeBytes * 8) / seconds / 1000) : 0;

  return {
    durationMs,
    durationLabel: formatDuration(durationMs),
    sizeBytes,
    sizeLabel: formatBytes(sizeBytes),
    format: describeMimeType(mimeType),
    extension: extensionForMimeType(mimeType),
    bitrateKbps,
  };
}

/**
 * Pick the first container/codec the browser will actually record.
 * Pass MediaRecorder.isTypeSupported; returns "" when nothing matches, which
 * tells MediaRecorder to fall back to its own default.
 */
export function pickAudioMimeType(isSupported?: (type: string) => boolean): string {
  if (typeof isSupported !== "function") return "";
  for (const candidate of AUDIO_MIME_CANDIDATES) {
    try {
      if (isSupported(candidate)) return candidate;
    } catch {
      // A browser that throws on an odd codec string simply loses that candidate.
    }
  }
  return "";
}

/** Format milliseconds as mm:ss, or h:mm:ss once the hour mark is passed. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Format a byte count with one decimal place from KB upwards. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Turn a MediaRecorder mime type into a short human label. */
export function describeMimeType(mimeType: string): string {
  const type = (mimeType || "").toLowerCase();
  if (!type) return "—";
  const codec = type.includes("opus")
    ? "Opus"
    : type.includes("mp4a") || type.includes("aac")
      ? "AAC"
      : type.includes("vorbis")
        ? "Vorbis"
        : "";
  const container = type.includes("webm")
    ? "WebM"
    : type.includes("ogg")
      ? "Ogg"
      : type.includes("mp4") || type.includes("m4a")
        ? "MP4"
        : type.includes("wav")
          ? "WAV"
          : "Audio";
  return codec ? `${container} (${codec})` : container;
}

/** File extension matching a MediaRecorder mime type. */
export function extensionForMimeType(mimeType: string): string {
  const type = (mimeType || "").toLowerCase();
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  if (type.includes("wav")) return "wav";
  return "webm";
}

/** Timestamped download name, e.g. recording-2026-08-29-14-07-32.webm */
export function recordingFileName(date: Date, extension: string, prefix = "recording"): string {
  const valid = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = [
    valid.getFullYear(),
    pad(valid.getMonth() + 1),
    pad(valid.getDate()),
    pad(valid.getHours()),
    pad(valid.getMinutes()),
    pad(valid.getSeconds()),
  ];
  const ext = (extension || "webm").replace(/^\./, "");
  return `${prefix}-${stamp[0]}-${stamp[1]}-${stamp[2]}-${stamp[3]}-${stamp[4]}-${stamp[5]}.${ext}`;
}

/**
 * Reduce a block of samples to per-bucket peak amplitudes (0–1) so a whole
 * recording can be drawn as a fixed-width waveform.
 */
export function computeWaveformPeaks(samples: ArrayLike<number>, buckets: number): number[] {
  const count = Math.max(1, Math.floor(buckets));
  if (!samples || samples.length === 0) return new Array(count).fill(0);

  const peaks = new Array<number>(count).fill(0);
  const perBucket = samples.length / count;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * perBucket);
    const end = Math.min(samples.length, Math.floor((i + 1) * perBucket));
    let peak = 0;
    for (let j = start; j < end; j++) {
      const value = Math.abs(samples[j]);
      if (Number.isFinite(value) && value > peak) peak = value;
    }
    peaks[i] = Math.min(1, peak);
  }
  return peaks;
}

/**
 * Encode raw float PCM channels as a 16-bit little-endian WAV file.
 * Channels must all be the same length; mono and stereo are both handled.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const valid = (channels ?? []).filter((c) => c && c.length > 0);
  const channelCount = Math.max(1, valid.length);
  const frameCount = valid.length > 0 ? Math.min(...valid.map((c) => c.length)) : 0;
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : 44100;

  const blockAlign = channelCount * 2;
  const dataBytes = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM subchunk size
  view.setUint16(20, 1, true); // format 1 = PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const sample = valid[channel]?.[frame] ?? 0;
      const clamped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
      view.setInt16(offset, Math.round(clamped * 32767), true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}
