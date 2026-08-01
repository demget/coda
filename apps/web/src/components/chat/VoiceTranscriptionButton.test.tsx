import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  getVoiceTranscriptionPresentation,
  VoiceTranscriptionControlContent,
} from "./VoiceTranscriptionButton";

describe("getVoiceTranscriptionPresentation", () => {
  it("keeps the active ribbon labels short while preserving descriptive accessible labels", () => {
    expect(getVoiceTranscriptionPresentation("requesting", "0:00")).toEqual({
      label: "Waiting for microphone permission",
      liveStatus: "Waiting for microphone permission",
      ribbonLabel: "Allow mic",
    });
    expect(getVoiceTranscriptionPresentation("recording", "1:05")).toEqual({
      label: "Stop recording (1:05)",
      liveStatus: "Recording started",
      ribbonLabel: "1:05",
    });
    expect(getVoiceTranscriptionPresentation("transcribing", "1:05")).toEqual({
      label: "Transcribing recording",
      liveStatus: "Transcribing recording",
      ribbonLabel: "Transcribing",
    });
  });
});

describe("VoiceTranscriptionControlContent", () => {
  it("renders the signal and stop marks with a tabular timer while recording", () => {
    const markup = renderToStaticMarkup(
      <VoiceTranscriptionControlContent elapsedLabel="0:42" phase="recording" />,
    );

    expect(markup).toContain("data-voice-signal-mark");
    expect(markup).toContain("data-voice-stop-mark");
    expect(markup).toContain("tabular-nums");
    expect(markup).toContain(">0:42</span>");
  });

  it("keeps the stop mark visually hidden while transcribing", () => {
    const markup = renderToStaticMarkup(
      <VoiceTranscriptionControlContent elapsedLabel="0:42" phase="transcribing" />,
    );

    expect(markup).toContain("data-voice-signal-mark");
    expect(markup).toContain(">Transcribing</span>");
    expect(markup).toContain("data-voice-stop-mark");
    expect(markup).toContain("scale-[0.25] opacity-0 blur-[4px]");
  });
});
