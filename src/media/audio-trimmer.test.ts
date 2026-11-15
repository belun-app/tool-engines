import { describe, expect, it } from "vitest";
import {
  cutFileName,
  cutPcm,
  estimateWavBytes,
  formatTimecode,
  id3v2Length,
  mixToMono,
  normalizeRange,
  parseMp3,
  parseTimecode,
  sliceMp3,
  summarizeSource,
  waveformFromChannels,
} from "./audio-trimmer.js";

// decodeAudioData and playback are in the mount. The MP3 frame walker is tested on a
// synthetic stream of MPEG-1 Layer III frame headers with zero-filled bodies.

/**
 * One MPEG-1 Layer III frame, 44.1 kHz, no CRC.
 * FF FB = sync + MPEG-1 + Layer III + protection bit set (no CRC).
 * Size = floor(144 · bitrate / 44100) + padding: 128 kbps -> 417 bytes, 160 kbps -> 522.
 */
function frame(bitrateIndex = 9, opts: { mono?: boolean; xing?: boolean } = {}): number[] {
  const kbps = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160][bitrateIndex];
  const size = Math.floor((144 * kbps * 1000) / 44100);
  const bytes = new Array(size).fill(0);
  bytes[0] = 0xff;
  bytes[1] = 0xfb;
  bytes[2] = (bitrateIndex << 4) | (0 << 2); // sample-rate index 0 = 44100, no padding
  bytes[3] = opts.mono ? 0xc0 : 0x00;
  if (opts.xing) {
    // side info is 32 bytes for MPEG-1 stereo, so the tag sits at 4 + 32
    "Xing".split("").forEach((c, i) => {
      bytes[36 + i] = c.charCodeAt(0);
    });
  }
  return bytes;
}

const FRAME_SEC = 1152 / 44100; // 0.0261224…

/** ID3v2 header with a syncsafe size of 20 bytes, then the 20 bytes. */
const ID3 = [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20, ...new Array(20).fill(0)];

function mp3(frames: number[][], prefix: number[] = ID3, suffix: number[] = []): Uint8Array {
  return Uint8Array.from([...prefix, ...frames.flat(), ...suffix]);
}

describe("timecodes", () => {
  it("formats m:ss.mmm and h:mm:ss.mmm", () => {
    expect(formatTimecode(0)).toBe("0:00.000");
    expect(formatTimecode(83.25)).toBe("1:23.250");
    expect(formatTimecode(3723.5)).toBe("1:02:03.500");
    expect(formatTimecode(83.25, false)).toBe("1:23");
    expect(formatTimecode(-4)).toBe("0:00.000");
    expect(formatTimecode(Number.NaN)).toBe("0:00.000");
  });

  it("carries rounded milliseconds into the seconds", () => {
    expect(formatTimecode(1.9996)).toBe("0:02.000");
  });

  it.each([
    ["12", 12],
    ["12.5", 12.5],
    ["12,5", 12.5],
    ["1:23", 83],
    ["1:23.250", 83.25],
    ["0:01:23.25", 83.25],
    [" 2:05 ", 125],
  ])("parses %j", (text, seconds) => {
    expect(parseTimecode(text)).toBe(seconds);
  });

  it.each(["", "abc", "-1", "1:2:3:4", "1.2.3", "12.3456"])("rejects %j", (text) => {
    expect(parseTimecode(text)).toBeNull();
  });
});

describe("normalizeRange", () => {
  it("clamps into the file and swaps reversed handles", () => {
    expect(normalizeRange(-5, 20, 10)).toEqual({ startSec: 0, endSec: 10, durationSec: 10 });
    expect(normalizeRange(5, 2, 10)).toEqual({ startSec: 2, endSec: 5, durationSec: 3 });
    expect(normalizeRange(Number.NaN, Number.NaN, 10)).toEqual({
      startSec: 0,
      endSec: 10,
      durationSec: 10,
    });
  });

  it("keeps at least 10 ms between handles, even at the very end", () => {
    const r = normalizeRange(3, 3, 10);
    expect(r.startSec).toBe(3);
    expect(r.durationSec).toBeCloseTo(0.01);
    const end = normalizeRange(10, 10, 10);
    expect(end.startSec).toBeCloseTo(9.99);
    expect(end.endSec).toBe(10);
  });

  it("returns zeros for an empty file", () => {
    expect(normalizeRange(1, 2, 0)).toEqual({ startSec: 0, endSec: 0, durationSec: 0 });
    expect(normalizeRange(1, 2, Number.NaN)).toEqual({ startSec: 0, endSec: 0, durationSec: 0 });
  });
});

describe("cutPcm", () => {
  const ones = () => new Float32Array(10).fill(1);

  it("cuts a sample-accurate window without touching the source", () => {
    const src = ones();
    // 10 Hz "sample rate": 0.2–0.8 s = frames 2..7
    const r = cutPcm([src], 10, 0.2, 0.8);
    expect(r.frameCount).toBe(6);
    expect(r.durationSec).toBeCloseTo(0.6);
    expect(r.sampleRate).toBe(10);
    expect([...r.channels[0]]).toEqual([1, 1, 1, 1, 1, 1]);
    r.channels[0][0] = 5;
    expect(src[2]).toBe(1);
  });

  it("applies quarter-sine fades at both ends", () => {
    // 0.2 s at 10 Hz = 2 frames: gains sin(0)=0, sin(π/4)=0.7071
    const r = cutPcm([ones()], 10, 0.2, 0.8, 0.2, 0.2);
    const out = [...r.channels[0]];
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(out[2]).toBe(1);
    expect(out[4]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(out[5]).toBe(0);
  });

  it("limits each fade to half the cut", () => {
    const r = cutPcm([ones()], 10, 0, 1, 5, 0);
    // 10 frames -> fade of at most 5 frames: frame 5 untouched
    expect(r.channels[0][4]).toBeLessThan(1);
    expect(r.channels[0][5]).toBe(1);
  });

  it("uses the shortest channel and a sane sample rate", () => {
    const r = cutPcm([new Float32Array(8), new Float32Array(4)], Number.NaN, 0, 1);
    expect(r.sampleRate).toBe(44100);
    expect(r.channels.map((c) => c.length)).toEqual([4, 4]);
  });

  it("returns an empty cut for no audio", () => {
    expect(cutPcm([], 48000, 0, 1)).toEqual({
      channels: [],
      sampleRate: 48000,
      durationSec: 0,
      frameCount: 0,
    });
  });
});

describe("mixToMono / waveformFromChannels", () => {
  it("averages channels and returns a single channel as is", () => {
    const l = new Float32Array([1, 0.5, 0]);
    const r = new Float32Array([0, 0.5, 1, 9]);
    expect([...mixToMono([l, r])]).toEqual([0.5, 0.5, 0.5]);
    expect(mixToMono([l])).toBe(l);
    expect(mixToMono([]).length).toBe(0);
  });

  it("draws peaks from the mono mix", () => {
    const l = new Float32Array([1, -1, 0, 0]);
    const r = new Float32Array([1, 1, 0, 0.5]);
    // mix = [1, 0, 0, 0.25] -> two buckets: 1, 0.25
    expect(waveformFromChannels([l, r], 2)).toEqual([1, 0.25]);
  });
});

describe("id3v2Length", () => {
  it("reads the syncsafe size plus header and optional footer", () => {
    expect(id3v2Length(Uint8Array.from(ID3))).toBe(30);
    // syncsafe 0x01 0x7f = 1·128 + 127 = 255, footer flag adds 10
    expect(id3v2Length(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0x10, 0, 0, 1, 0x7f]))).toBe(
      10 + 255 + 10,
    );
    expect(id3v2Length(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBe(0);
    expect(id3v2Length(new Uint8Array(3))).toBe(0);
  });
});

describe("parseMp3", () => {
  it("walks a CBR stream after an ID3 tag, skipping the Xing frame and an ID3v1 tail", () => {
    const bytes = mp3(
      [frame(9, { xing: true }), frame(), frame(), frame(), frame(), frame()],
      ID3,
      [...[0x54, 0x41, 0x47], ...new Array(125).fill(0)], // "TAG" + 125 bytes
    );
    const info = parseMp3(bytes);
    expect(info).not.toBeNull();
    expect(info?.tagBytes).toBe(30);
    expect(info?.frames).toHaveLength(5);
    // first audio frame starts after the tag and the 417-byte Xing frame
    expect(info?.frames[0]).toEqual({ offset: 30 + 417, size: 417, durationSec: FRAME_SEC });
    expect(info?.durationSec).toBeCloseTo(5 * FRAME_SEC, 9);
    expect(info).toMatchObject({
      sampleRate: 44100,
      channels: 2,
      version: "1",
      layer: 3,
      // 5·417·8 bits / 0.13061 s = 127.7 kbps -> 128
      averageBitrateKbps: 128,
      variableBitrate: false,
    });
  });

  it("detects VBR and mono", () => {
    const info = parseMp3(mp3([frame(9, { mono: true }), frame(10, { mono: true }), frame(9)], []));
    expect(info?.variableBitrate).toBe(true);
    expect(info?.channels).toBe(1);
    expect(info?.frames.map((f) => f.size)).toEqual([417, 522, 417]);
  });

  it("resyncs over a stray byte between frames", () => {
    const info = parseMp3(mp3([frame(), [0x00], frame(), frame()], []));
    expect(info?.frames).toHaveLength(3);
    expect(info?.frames[1].offset).toBe(418);
  });

  it("returns null for non-MP3 data, single frames and tiny inputs", () => {
    expect(parseMp3(new Uint8Array(10))).toBeNull();
    expect(parseMp3(new Uint8Array(4096))).toBeNull();
    expect(parseMp3(mp3([frame()], []))).toBeNull();
    const wav = new Uint8Array(1000);
    wav.set([0x52, 0x49, 0x46, 0x46]); // "RIFF"
    expect(parseMp3(wav)).toBeNull();
  });
});

describe("sliceMp3", () => {
  const bytes = mp3([frame(), frame(), frame(), frame(), frame()], []);
  const info = parseMp3(bytes);
  if (!info) throw new Error("fixture did not parse");

  it("snaps to frame boundaries with half-frame tolerance (hand-computed)", () => {
    // frame length d = 0.026122 s; start 0.03 -> frame 1 (ends 0.0522 > 0.03 + d/2)
    // end 0.08 -> frame 2 (starts 0.0522 < 0.08 - d/2 = 0.0669); frame 3 starts 0.0784, too late
    const s = sliceMp3(bytes, info, 0.03, 0.08);
    expect(s.frameCount).toBe(2);
    expect(s.startSec).toBeCloseTo(FRAME_SEC, 9);
    expect(s.endSec).toBeCloseTo(3 * FRAME_SEC, 9);
    expect(s.durationSec).toBeCloseTo(2 * FRAME_SEC, 9);
    expect(s.bytes.length).toBe(2 * 417);
    expect([...s.bytes.subarray(0, 2)]).toEqual([0xff, 0xfb]);
    expect(s.snapSec).toBeCloseTo(0.03 - FRAME_SEC + (0.08 - 3 * FRAME_SEC), 9);
  });

  it("copies the whole stream for a full selection", () => {
    const s = sliceMp3(bytes, info, 0, info.durationSec);
    expect(s.frameCount).toBe(5);
    expect([...s.bytes]).toEqual([...bytes]);
  });

  it("always keeps at least one frame", () => {
    const s = sliceMp3(bytes, info, 0.01, 0.015);
    expect(s.frameCount).toBe(1);
    expect(s.bytes.length).toBe(417);
  });

  it("returns an empty slice without frames", () => {
    expect(sliceMp3(bytes, { ...info, frames: [] }, 0, 1).frameCount).toBe(0);
  });
});

describe("summaries and names", () => {
  it("describes an MP3 source", () => {
    const bytes = mp3([frame(), frame(), frame()], []);
    const info = parseMp3(bytes);
    expect(
      summarizeSource({
        name: "song.mp3",
        sizeBytes: 3 * 1024 * 1024,
        durationSec: 125.4,
        sampleRate: 44100,
        channels: 2,
        mp3: info,
      }),
    ).toEqual({
      name: "song.mp3",
      sizeLabel: "3.0 MB",
      durationLabel: "2:05",
      format: "MP3 (MPEG-1 Layer III)",
      sampleRateLabel: "44.1 kHz",
      channelLabel: "Stereo",
      bitrateLabel: "128 kbps CBR",
      bitrateKbps: 128,
      bitrateMode: "CBR",
      losslessAvailable: true,
    });
  });

  it("describes a non-MP3 source from size and duration", () => {
    // 1 000 000 B · 8 / 10 s / 1000 = 800 kbps
    expect(
      summarizeSource({
        name: "take.flac",
        sizeBytes: 1_000_000,
        durationSec: 10,
        sampleRate: 48000,
        channels: 1,
        mp3: null,
      }),
    ).toMatchObject({
      format: "FLAC",
      bitrateLabel: "800 kbps",
      // the number and the mode separately, so a page can write "800 кбит/с"
      bitrateKbps: 800,
      bitrateMode: "",
      sampleRateLabel: "48.0 kHz",
      channelLabel: "Mono",
      losslessAvailable: false,
    });
    expect(
      summarizeSource({
        name: "noext",
        sizeBytes: 0,
        durationSec: 0,
        sampleRate: 0,
        channels: 0,
        mp3: null,
      }),
    ).toMatchObject({
      format: "Audio",
      bitrateLabel: "—",
      bitrateKbps: 0,
      sampleRateLabel: "—",
      channelLabel: "—",
    });
  });

  it("estimates WAV size", () => {
    // 1 s · 44100 · 2 ch · 2 bytes + 44 header
    expect(estimateWavBytes(1, 44100, 2)).toBe(176444);
    expect(estimateWavBytes(Number.NaN, 0, 0)).toBe(44);
  });

  it("names the cut file safely", () => {
    expect(cutFileName("interview.mp3", "mp3")).toBe("interview-cut.mp3");
    expect(cutFileName("a:b*c?.wav", ".wav")).toBe("a_b_c_-cut.wav");
    expect(cutFileName("", "")).toBe("audio-cut.wav");
    expect(cutFileName("x".repeat(100), "wav")).toBe(`${"x".repeat(80)}-cut.wav`);
  });
});
