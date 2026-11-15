import { describe, expect, it } from "vitest";
import {
  computeWaveformPeaks,
  describeMimeType,
  encodeWav,
  extensionForMimeType,
  formatBytes,
  formatDuration,
  pickAudioMimeType,
  recordingFileName,
  summarizeRecording,
} from "./voice-recorder.js";

// getUserMedia / MediaRecorder / AudioContext are mount-only; the stats, naming,
// waveform reduction and WAV encoding are pure and tested here.

describe("summarizeRecording", () => {
  it("builds the stats block (hand-computed bitrate)", () => {
    // 1 MiB over 65 s: 1 048 576 · 8 / 65 / 1000 = 129.05 kbit/s
    expect(
      summarizeRecording({
        durationMs: 65000,
        sizeBytes: 1048576,
        mimeType: "audio/webm;codecs=opus",
      }),
    ).toEqual({
      durationMs: 65000,
      durationLabel: "1:05",
      sizeBytes: 1048576,
      sizeLabel: "1.0 MB",
      format: "WebM (Opus)",
      extension: "webm",
      bitrateKbps: 129,
    });
  });

  it("returns the empty summary for zero, negative or NaN input", () => {
    const empty = summarizeRecording({ durationMs: 0, sizeBytes: 0, mimeType: "audio/ogg" });
    expect(empty).toMatchObject({ durationLabel: "0:00", sizeLabel: "0 B", format: "—" });
    expect(
      summarizeRecording({ durationMs: -5, sizeBytes: Number.NaN, mimeType: "" }).bitrateKbps,
    ).toBe(0);
  });

  it("does not divide by zero when only the size is known", () => {
    expect(
      summarizeRecording({ durationMs: 0, sizeBytes: 500, mimeType: "audio/mp4" }),
    ).toMatchObject({ bitrateKbps: 0, extension: "m4a", sizeLabel: "500 B" });
  });
});

describe("pickAudioMimeType", () => {
  it("returns the first supported candidate", () => {
    expect(pickAudioMimeType((t) => t.startsWith("audio/mp4"))).toBe("audio/mp4;codecs=mp4a.40.2");
    expect(pickAudioMimeType(() => true)).toBe("audio/webm;codecs=opus");
  });

  it("skips candidates that throw and returns '' when nothing matches", () => {
    let calls = 0;
    const flaky = (t: string) => {
      calls++;
      if (t === "audio/webm;codecs=opus") throw new Error("odd codec");
      return t === "audio/webm";
    };
    expect(pickAudioMimeType(flaky)).toBe("audio/webm");
    expect(calls).toBe(2);
    expect(pickAudioMimeType(() => false)).toBe("");
    expect(pickAudioMimeType(undefined)).toBe("");
  });
});

describe("formatDuration / formatBytes", () => {
  it("formats m:ss and h:mm:ss, flooring partial seconds", () => {
    expect(formatDuration(999)).toBe("0:00");
    expect(formatDuration(59999)).toBe("0:59");
    expect(formatDuration(600000)).toBe("10:00");
    // 3725 s = 1 h 2 min 5 s
    expect(formatDuration(3725000)).toBe("1:02:05");
    expect(formatDuration(Number.NaN)).toBe("0:00");
    expect(formatDuration(-1)).toBe("0:00");
  });

  it("formats bytes up to GB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
    expect(formatBytes(5 * 1024 ** 4)).toBe("5120.0 GB");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });
});

describe("describeMimeType / extensionForMimeType", () => {
  it.each([
    ["audio/webm;codecs=opus", "WebM (Opus)", "webm"],
    ["audio/ogg;codecs=opus", "Ogg (Opus)", "ogg"],
    ["audio/ogg;codecs=vorbis", "Ogg (Vorbis)", "ogg"],
    ["audio/mp4;codecs=mp4a.40.2", "MP4 (AAC)", "m4a"],
    ["audio/x-m4a", "MP4", "m4a"],
    ["audio/wav", "WAV", "wav"],
    ["AUDIO/WEBM", "WebM", "webm"],
    ["audio/unknown", "Audio", "webm"],
    ["", "—", "webm"],
  ])("%s -> %s / .%s", (mime, label, ext) => {
    expect(describeMimeType(mime)).toBe(label);
    expect(extensionForMimeType(mime)).toBe(ext);
  });
});

describe("recordingFileName", () => {
  it("stamps the local date and time", () => {
    // Constructed in local time, so the stamp is the same in every time zone.
    const d = new Date(2026, 7, 29, 14, 7, 32);
    expect(recordingFileName(d, ".webm")).toBe("recording-2026-08-29-14-07-32.webm");
    expect(recordingFileName(d, "", "voice")).toBe("voice-2026-08-29-14-07-32.webm");
  });

  it("falls back to the epoch for an invalid date", () => {
    expect(recordingFileName(new Date("nope"), "ogg")).toMatch(
      /^recording-19(69|70)-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.ogg$/,
    );
  });
});

describe("computeWaveformPeaks", () => {
  it("takes the absolute peak per bucket, capped at 1, ignoring NaN", () => {
    // buckets of two: |0.1|,|-0.5| -> 0.5; 0.2, 0.9 -> 0.9; |-1.5|, NaN -> 1
    expect(computeWaveformPeaks([0.1, -0.5, 0.2, 0.9, -1.5, Number.NaN], 3)).toEqual([0.5, 0.9, 1]);
  });

  it("returns zeros for no samples and at least one bucket", () => {
    expect(computeWaveformPeaks([], 4)).toEqual([0, 0, 0, 0]);
    expect(computeWaveformPeaks([0.3], 0)).toEqual([0.3]);
  });

  it("works on a Float32Array", () => {
    const samples = new Float32Array([0.25, -0.75, 0.5, 0]);
    expect(computeWaveformPeaks(samples, 2)).toEqual([0.75, 0.5]);
  });
});

describe("encodeWav", () => {
  const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

  it("writes a canonical 16-bit PCM header and samples (mono)", () => {
    const wav = encodeWav([new Float32Array([0, 1, -1, 0.5])], 8000);
    const v = view(wav);
    expect(wav.length).toBe(44 + 8);
    expect(ascii(wav, 0)).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(36 + 8);
    expect(ascii(wav, 8)).toBe("WAVE");
    expect(ascii(wav, 12)).toBe("fmt ");
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // channels
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getUint32(28, true)).toBe(16000); // byte rate = 8000 · 2
    expect(v.getUint16(32, true)).toBe(2); // block align
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(wav, 36)).toBe("data");
    expect(v.getUint32(40, true)).toBe(8);
    // 0, 1·32767, -1·32767, round(0.5·32767 = 16383.5) = 16384
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([
      0, 32767, -32767, 16384,
    ]);
  });

  it("interleaves stereo and truncates to the shorter channel", () => {
    const wav = encodeWav(
      [new Float32Array([0.5, 0.5, 0.5]), new Float32Array([-0.5, -0.5])],
      44100,
    );
    const v = view(wav);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(28, true)).toBe(44100 * 4);
    expect(v.getUint32(40, true)).toBe(2 * 4);
    expect(v.getInt16(44, true)).toBe(16384);
    // Math.round(-16383.5) rounds towards +∞
    expect(v.getInt16(46, true)).toBe(-16383);
  });

  it("clamps out-of-range and NaN samples and defaults a bad sample rate", () => {
    const wav = encodeWav([new Float32Array([2, -3, Number.NaN])], Number.NaN);
    const v = view(wav);
    expect(v.getUint32(24, true)).toBe(44100);
    expect([0, 1, 2].map((i) => v.getInt16(44 + i * 2, true))).toEqual([32767, -32767, 0]);
  });

  it("produces a valid empty file for no channels", () => {
    const wav = encodeWav([], 48000);
    expect(wav.length).toBe(44);
    expect(view(wav).getUint32(40, true)).toBe(0);
    expect(view(wav).getUint16(22, true)).toBe(1);
  });
});
