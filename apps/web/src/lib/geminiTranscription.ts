const GEMINI_TRANSCRIPTION_MODEL = "gemini-3.6-flash";
const GEMINI_TRANSCRIPTION_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TRANSCRIPTION_MODEL}:generateContent`;
const TARGET_SAMPLE_RATE = 16_000;
export const MAX_TRANSCRIPTION_WAV_BYTES = 6 * 1024 * 1024;

const TRANSCRIPTION_PROMPT = [
  "Transcribe the speech in this recording.",
  "Return the spoken words only, with natural punctuation.",
  "Preserve the language exactly as spoken and never translate.",
  "The speaker may use English, Russian, Ukrainian, or switch between them.",
  "Preserve technical terms, file paths, command names, and code identifiers carefully.",
].join(" ");

export type VoiceTranscriptionErrorCode =
  | "audio-decode-failed"
  | "audio-empty"
  | "audio-too-large"
  | "invalid-api-key"
  | "network"
  | "no-speech"
  | "rate-limited"
  | "response-invalid"
  | "service-error";

export class VoiceTranscriptionError extends Error {
  readonly code: VoiceTranscriptionErrorCode;

  constructor(code: VoiceTranscriptionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VoiceTranscriptionError";
    this.code = code;
  }
}

interface AudioBufferSource {
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

/** Downmix and resample browser-decoded audio into Gemini-friendly mono PCM WAV. */
export function encodeAudioBufferAsMonoWav(audio: AudioBufferSource): ArrayBuffer {
  if (audio.length === 0 || audio.numberOfChannels === 0 || audio.sampleRate <= 0) {
    throw new VoiceTranscriptionError("audio-empty", "The recording did not contain audio.");
  }

  const outputSampleRate = Math.min(audio.sampleRate, TARGET_SAMPLE_RATE);
  const outputLength = Math.max(
    1,
    Math.round((audio.length * outputSampleRate) / audio.sampleRate),
  );
  const wav = new ArrayBuffer(44 + outputLength * 2);
  const view = new DataView(wav);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + outputLength * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, outputSampleRate, true);
  view.setUint32(28, outputSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, outputLength * 2, true);

  const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) =>
    audio.getChannelData(channel),
  );
  const sourceFramesPerOutputFrame = audio.sampleRate / outputSampleRate;

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourcePosition = outputIndex * sourceFramesPerOutputFrame;
    const sourceIndex = Math.min(audio.length - 1, Math.floor(sourcePosition));
    const nextSourceIndex = Math.min(audio.length - 1, sourceIndex + 1);
    const interpolation = sourcePosition - sourceIndex;
    let sample = 0;

    for (const channel of channels) {
      const current = channel[sourceIndex] ?? 0;
      const next = channel[nextSourceIndex] ?? current;
      sample += current + (next - current) * interpolation;
    }

    sample = Math.max(-1, Math.min(1, sample / channels.length));
    view.setInt16(
      44 + outputIndex * 2,
      sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff),
      true,
    );
  }

  return wav;
}

export async function convertRecordedAudioToWav(recording: Blob): Promise<Blob> {
  if (recording.size === 0) {
    throw new VoiceTranscriptionError("audio-empty", "The recording did not contain audio.");
  }

  const AudioContextConstructor =
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new VoiceTranscriptionError(
      "audio-decode-failed",
      "This browser cannot prepare microphone audio for transcription.",
    );
  }

  const audioContext = new AudioContextConstructor();
  try {
    const decoded = await audioContext.decodeAudioData(await recording.arrayBuffer());
    const wav = new Blob([encodeAudioBufferAsMonoWav(decoded)], { type: "audio/wav" });
    if (wav.size > MAX_TRANSCRIPTION_WAV_BYTES) {
      throw new VoiceTranscriptionError(
        "audio-too-large",
        "The recording is too long to transcribe in one request.",
      );
    }
    return wav;
  } catch (error) {
    if (error instanceof VoiceTranscriptionError) throw error;
    throw new VoiceTranscriptionError(
      "audio-decode-failed",
      "The recorded audio could not be decoded.",
      { cause: error },
    );
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 32_768;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function readGeminiResponseText(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("candidates" in value)) return null;
  const candidates = (value as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return null;
  const candidate = candidates[0];
  if (typeof candidate !== "object" || candidate === null || !("content" in candidate)) return null;
  const content = (candidate as { content?: unknown }).content;
  if (typeof content !== "object" || content === null || !("parts" in content)) return null;
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .flatMap((part) =>
      typeof part === "object" && part !== null && "text" in part && typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("")
    .trim();
  return text || null;
}

function readGeminiErrorMessage(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("error" in value)) return null;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== "object" || error === null || !("message" in error)) return null;
  return typeof error.message === "string" ? error.message.trim() || null : null;
}

export async function transcribeWavWithGemini(input: {
  readonly apiKey: string;
  readonly wav: Blob;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<string> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new VoiceTranscriptionError("invalid-api-key", "A Gemini API key is required.");
  }
  if (input.wav.size === 0) {
    throw new VoiceTranscriptionError("audio-empty", "The recording did not contain audio.");
  }
  if (input.wav.size > MAX_TRANSCRIPTION_WAV_BYTES) {
    throw new VoiceTranscriptionError(
      "audio-too-large",
      "The recording is too long to transcribe in one request.",
    );
  }

  const audioBytes = new Uint8Array(await input.wav.arrayBuffer());
  let response: Response;
  try {
    response = await (input.fetch ?? globalThis.fetch)(GEMINI_TRANSCRIPTION_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: TRANSCRIPTION_PROMPT },
              {
                inlineData: {
                  mimeType: "audio/wav",
                  data: bytesToBase64(audioBytes),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: { transcript: { type: "STRING" } },
            required: ["transcript"],
          },
        },
      }),
    });
  } catch (error) {
    throw new VoiceTranscriptionError("network", "Could not reach Gemini.", { cause: error });
  }

  let responseBody: unknown = null;
  try {
    responseBody = await response.json();
  } catch (error) {
    if (response.ok) {
      throw new VoiceTranscriptionError(
        "response-invalid",
        "Gemini returned an unreadable response.",
        { cause: error },
      );
    }
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new VoiceTranscriptionError("invalid-api-key", "Gemini rejected the API key.");
    }
    if (response.status === 429) {
      throw new VoiceTranscriptionError(
        "rate-limited",
        "Gemini is rate-limiting transcription requests. Try again shortly.",
      );
    }
    throw new VoiceTranscriptionError(
      "service-error",
      readGeminiErrorMessage(responseBody) ?? "Gemini could not transcribe the recording.",
    );
  }

  const responseText = readGeminiResponseText(responseBody);
  if (!responseText) {
    throw new VoiceTranscriptionError(
      "response-invalid",
      "Gemini returned no transcription result.",
    );
  }

  let structured: unknown;
  try {
    structured = JSON.parse(responseText);
  } catch (error) {
    throw new VoiceTranscriptionError(
      "response-invalid",
      "Gemini returned an invalid transcription result.",
      { cause: error },
    );
  }
  if (
    typeof structured !== "object" ||
    structured === null ||
    !("transcript" in structured) ||
    typeof structured.transcript !== "string"
  ) {
    throw new VoiceTranscriptionError(
      "response-invalid",
      "Gemini returned an invalid transcription result.",
    );
  }

  const transcript = structured.transcript.trim();
  if (!transcript) {
    throw new VoiceTranscriptionError("no-speech", "No speech was detected in the recording.");
  }
  return transcript;
}

export async function transcribeRecordedAudio(input: {
  readonly apiKey: string;
  readonly recording: Blob;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<string> {
  const wav = await convertRecordedAudioToWav(input.recording);
  return transcribeWavWithGemini({
    apiKey: input.apiKey,
    wav,
    ...(input.fetch ? { fetch: input.fetch } : {}),
  });
}
