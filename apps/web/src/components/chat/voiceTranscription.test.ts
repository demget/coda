import { describe, expect, it } from "vite-plus/test";

import { buildVoiceTranscriptInsertion, formatVoiceRecordingElapsed } from "./voiceTranscription";

describe("buildVoiceTranscriptInsertion", () => {
  it("inserts a transcript into an empty prompt without padding", () => {
    expect(buildVoiceTranscriptInsertion("", 0, "  Hello world.  ")).toBe("Hello world.");
  });

  it("separates a transcript from words on both sides", () => {
    expect(buildVoiceTranscriptInsertion("beforeafter", 6, "voice text")).toBe(" voice text ");
  });

  it("does not introduce spaces inside surrounding punctuation", () => {
    expect(buildVoiceTranscriptInsertion("()", 1, "hello")).toBe("hello");
    expect(buildVoiceTranscriptInsertion("Say .", 4, "hello")).toBe("hello");
  });

  it("clamps a stale cursor to the current prompt", () => {
    expect(buildVoiceTranscriptInsertion("hello", 99, "world")).toBe(" world");
  });
});

describe("formatVoiceRecordingElapsed", () => {
  it("formats elapsed seconds without fractional or negative values", () => {
    expect(formatVoiceRecordingElapsed(65.9)).toBe("1:05");
    expect(formatVoiceRecordingElapsed(-1)).toBe("0:00");
  });
});
