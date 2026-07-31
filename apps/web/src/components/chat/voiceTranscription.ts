export function buildVoiceTranscriptInsertion(
  prompt: string,
  cursor: number,
  transcript: string,
): string {
  const text = transcript.trim();
  if (!text) return "";

  const safeCursor = Math.max(0, Math.min(prompt.length, cursor));
  const previous = prompt[safeCursor - 1];
  const next = prompt[safeCursor];
  const needsLeadingSpace =
    previous !== undefined && !/[\s([{"'“‘]/u.test(previous) && !/^[.,!?;:)}\]”’]/u.test(text);
  const needsTrailingSpace =
    next !== undefined && !/[\s.,!?;:)}\]”’]/u.test(next) && !/[([{"'“‘]$/u.test(text);

  return `${needsLeadingSpace ? " " : ""}${text}${needsTrailingSpace ? " " : ""}`;
}

export function formatVoiceRecordingElapsed(elapsedSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(elapsedSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
