import { describe, expect, it, vi } from "vite-plus/test";

import {
  encodeAudioBufferAsMonoWav,
  MAX_TRANSCRIPTION_WAV_BYTES,
  transcribeWavWithGemini,
} from "./geminiTranscription";

function wavBlob(bytes: Uint8Array = new Uint8Array([1, 2, 3])): Blob {
  return new Blob([Uint8Array.from(bytes).buffer], { type: "audio/wav" });
}

function geminiResponse(transcript: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ transcript }) }],
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("encodeAudioBufferAsMonoWav", () => {
  it("downmixes stereo and resamples to a 16 kHz mono PCM WAV", () => {
    const left = new Float32Array(48_000).fill(0.5);
    const right = new Float32Array(48_000).fill(-0.25);
    const wav = encodeAudioBufferAsMonoWav({
      length: 48_000,
      numberOfChannels: 2,
      sampleRate: 48_000,
      getChannelData: (channel) => (channel === 0 ? left : right),
    });
    const view = new DataView(wav);

    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(32_000);
    expect(view.getInt16(44, true)).toBeCloseTo(4096, -1);
  });
});

describe("transcribeWavWithGemini", () => {
  it("requests a structured multilingual transcript without putting the key in the URL", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(geminiResponse("Привіт, check src/index.ts."));

    await expect(
      transcribeWavWithGemini({ apiKey: " test-key ", wav: wavBlob(), fetch }),
    ).resolves.toBe("Привіт, check src/index.ts.");

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).not.toContain("test-key");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-key");
    const body = JSON.parse(String(init?.body)) as {
      contents: Array<{ parts: Array<{ text?: string }> }>;
      generationConfig: { responseMimeType: string };
    };
    expect(body.contents[0]?.parts[0]?.text).toContain("English, Russian, Ukrainian");
    expect(body.contents[0]?.parts[0]?.text).toContain("never translate");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("turns rejected credentials into an actionable error", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response("forbidden", { status: 403, headers: { "Content-Type": "text/plain" } }),
      );

    await expect(
      transcribeWavWithGemini({ apiKey: "bad-key", wav: wavBlob(), fetch }),
    ).rejects.toMatchObject({ code: "invalid-api-key" });
  });

  it("rejects oversized inline recordings before making a request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const wav = new Blob([new Uint8Array(MAX_TRANSCRIPTION_WAV_BYTES + 1)], {
      type: "audio/wav",
    });

    await expect(transcribeWavWithGemini({ apiKey: "key", wav, fetch })).rejects.toMatchObject({
      code: "audio-too-large",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects empty transcripts", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(geminiResponse("  "));

    await expect(
      transcribeWavWithGemini({ apiKey: "key", wav: wavBlob(), fetch }),
    ).rejects.toMatchObject({ code: "no-speech" });
  });
});
