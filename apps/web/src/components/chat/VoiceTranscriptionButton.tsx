import { useCallback, useEffect, useRef, useState } from "react";
import { MicIcon } from "lucide-react";

import { transcribeRecordedAudio } from "../../lib/geminiTranscription";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { formatVoiceRecordingElapsed } from "./voiceTranscription";

const MAX_RECORDING_MS = 120_000;

export type VoiceTranscriptionPhase = "idle" | "requesting" | "recording" | "transcribing";

interface VoiceTranscriptionPresentation {
  readonly label: string;
  readonly liveStatus: string;
  readonly ribbonLabel: string;
}

interface VoiceTranscriptionButtonProps {
  readonly apiKey: string;
  readonly onTranscript: (transcript: string) => void;
}

interface VoiceSignalMarkProps {
  readonly phase: VoiceTranscriptionPhase;
}

interface VoiceTranscriptionControlContentProps {
  readonly elapsedLabel: string;
  readonly phase: VoiceTranscriptionPhase;
}

function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function microphoneErrorDescription(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Allow microphone access for Coda in your browser or system settings, then try again.";
    }
    if (error.name === "NotFoundError") {
      return "No microphone was found on this device.";
    }
  }
  return error instanceof Error ? error.message : "Coda could not start microphone recording.";
}

export function getVoiceTranscriptionPresentation(
  phase: VoiceTranscriptionPhase,
  elapsedLabel: string,
): VoiceTranscriptionPresentation {
  switch (phase) {
    case "requesting":
      return {
        label: "Waiting for microphone permission",
        liveStatus: "Waiting for microphone permission",
        ribbonLabel: "Allow mic",
      };
    case "recording":
      return {
        label: `Stop recording (${elapsedLabel})`,
        liveStatus: "Recording started",
        ribbonLabel: elapsedLabel,
      };
    case "transcribing":
      return {
        label: "Transcribing recording",
        liveStatus: "Transcribing recording",
        ribbonLabel: "Transcribing",
      };
    case "idle":
      return {
        label: "Record voice message",
        liveStatus: "",
        ribbonLabel: "",
      };
  }
}

function VoiceSignalMark({ phase }: VoiceSignalMarkProps) {
  const heights =
    phase === "recording"
      ? [4, 9, 13, 7, 3]
      : phase === "transcribing"
        ? [3, 6, 10, 6, 3]
        : [3, 4, 7, 4, 3];

  return (
    <svg
      aria-hidden="true"
      className="size-4 overflow-visible"
      data-voice-signal-mark
      viewBox="0 0 18 14"
    >
      {heights.map((height, index) => {
        const x = 1.5 + index * 3.75;
        const inset = (14 - height) / 2;
        return (
          <line
            key={x}
            x1={x}
            x2={x}
            y1={inset}
            y2={14 - inset}
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        );
      })}
    </svg>
  );
}

function VoiceStopMark() {
  return (
    <svg aria-hidden="true" className="size-3" data-voice-stop-mark viewBox="0 0 12 12">
      <rect x="2" y="2" width="8" height="8" rx="1.75" fill="currentColor" />
    </svg>
  );
}

export function VoiceTranscriptionControlContent(props: VoiceTranscriptionControlContentProps) {
  const { elapsedLabel, phase } = props;
  const isActive = phase !== "idle";
  const presentation = getVoiceTranscriptionPresentation(phase, elapsedLabel);

  return (
    <span className="flex w-full min-w-0 items-center justify-center">
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-[opacity,filter,scale] duration-300 [transition-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
            isActive ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-0",
          )}
        >
          <ComposerControlIcon icon={MicIcon} />
        </span>
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-[opacity,filter,scale] duration-300 [transition-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
            isActive ? "scale-100 opacity-100 blur-0" : "scale-[0.25] opacity-0 blur-[4px]",
          )}
        >
          <VoiceSignalMark phase={phase} />
        </span>
      </span>

      {isActive ? (
        <>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left font-medium text-xs leading-none",
              phase === "recording" && "tabular-nums",
            )}
          >
            {presentation.ribbonLabel}
          </span>
          <span
            className={cn(
              "flex size-3.5 shrink-0 items-center justify-center transition-[opacity,filter,scale] duration-300 [transition-timing-function:cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
              phase === "recording"
                ? "scale-100 opacity-100 blur-0"
                : "scale-[0.25] opacity-0 blur-[4px]",
            )}
          >
            <VoiceStopMark />
          </span>
        </>
      ) : null}
    </span>
  );
}

export function VoiceTranscriptionButton(props: VoiceTranscriptionButtonProps) {
  const { apiKey, onTranscript } = props;
  const [phase, setPhaseState] = useState<VoiceTranscriptionPhase>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const mountedRef = useRef(true);
  const phaseRef = useRef<VoiceTranscriptionPhase>("idle");
  const operationRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  const elapsedIntervalRef = useRef<number | null>(null);
  const maximumDurationTimeoutRef = useRef<number | null>(null);

  const setPhase = useCallback((nextPhase: VoiceTranscriptionPhase) => {
    phaseRef.current = nextPhase;
    if (mountedRef.current) setPhaseState(nextPhase);
  }, []);

  const clearRecordingTimers = useCallback(() => {
    if (elapsedIntervalRef.current !== null) {
      window.clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
    if (maximumDurationTimeoutRef.current !== null) {
      window.clearTimeout(maximumDurationTimeoutRef.current);
      maximumDurationTimeoutRef.current = null;
    }
  }, []);

  const releaseMicrophone = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
  }, []);

  const stopRecording = useCallback(
    (discard = false) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") return;

      discardRecordingRef.current = discard;
      clearRecordingTimers();
      if (!discard) setPhase("transcribing");
      recorder.stop();
      releaseMicrophone();
    },
    [clearRecordingTimers, releaseMicrophone, setPhase],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      clearRecordingTimers();
      discardRecordingRef.current = true;
      const recorder = recorderRef.current;
      if (recorder?.state === "recording" || recorder?.state === "paused") recorder.stop();
      releaseMicrophone();
    };
  }, [clearRecordingTimers, releaseMicrophone]);

  const startRecording = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    if (!apiKey.trim()) {
      toastManager.add({
        type: "info",
        title: "Set up voice input",
        description: "Add a Gemini API key in Settings → General → Voice input.",
      });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toastManager.add({
        type: "error",
        title: "Voice input is unavailable",
        description: "This browser does not support microphone recording for Coda.",
      });
      return;
    }

    const operation = operationRef.current + 1;
    operationRef.current = operation;
    setPhase("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true },
      });
    } catch (error) {
      if (!mountedRef.current || operationRef.current !== operation) return;
      setPhase("idle");
      toastManager.add({
        type: "error",
        title: "Microphone unavailable",
        description: microphoneErrorDescription(error),
      });
      return;
    }

    if (!mountedRef.current || operationRef.current !== operation) {
      stopStream(stream);
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { audioBitsPerSecond: 64_000 });
    } catch (error) {
      stopStream(stream);
      setPhase("idle");
      toastManager.add({
        type: "error",
        title: "Could not start recording",
        description: microphoneErrorDescription(error),
      });
      return;
    }

    chunksRef.current = [];
    discardRecordingRef.current = false;
    streamRef.current = stream;
    recorderRef.current = recorder;
    const handleDataAvailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    const handleRecorderError = () => {
      discardRecordingRef.current = true;
      if (mountedRef.current) {
        toastManager.add({
          type: "error",
          title: "Recording failed",
          description: "The microphone stopped before Coda could capture the recording.",
        });
      }
      stopRecording(true);
    };
    const handleRecorderStop = () => {
      recorderRef.current = null;
      clearRecordingTimers();
      releaseMicrophone();

      if (discardRecordingRef.current || !mountedRef.current) {
        chunksRef.current = [];
        if (mountedRef.current) setPhase("idle");
        return;
      }

      const recording = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      chunksRef.current = [];
      void transcribeRecordedAudio({ apiKey, recording })
        .then((transcript) => {
          if (!mountedRef.current || operationRef.current !== operation) return;
          onTranscript(transcript);
        })
        .catch((error: unknown) => {
          if (!mountedRef.current || operationRef.current !== operation) return;
          toastManager.add({
            type: "error",
            title: "Could not transcribe recording",
            description: error instanceof Error ? error.message : "Gemini transcription failed.",
          });
        })
        .finally(() => {
          if (mountedRef.current && operationRef.current === operation) setPhase("idle");
        });
    };
    recorder.addEventListener("dataavailable", handleDataAvailable);
    recorder.addEventListener("error", handleRecorderError, { once: true });
    recorder.addEventListener("stop", handleRecorderStop, { once: true });

    try {
      recorder.start(1_000);
    } catch (error) {
      recorderRef.current = null;
      releaseMicrophone();
      setPhase("idle");
      toastManager.add({
        type: "error",
        title: "Could not start recording",
        description: microphoneErrorDescription(error),
      });
      return;
    }

    recordingStartedAtRef.current = Date.now();
    setElapsedSeconds(0);
    setPhase("recording");
    elapsedIntervalRef.current = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1_000));
    }, 1_000);
    maximumDurationTimeoutRef.current = window.setTimeout(() => {
      stopRecording();
    }, MAX_RECORDING_MS);
  }, [apiKey, clearRecordingTimers, onTranscript, releaseMicrophone, setPhase, stopRecording]);

  const handleClick = useCallback(() => {
    if (phaseRef.current === "recording") {
      stopRecording();
      return;
    }
    if (phaseRef.current === "idle") void startRecording();
  }, [startRecording, stopRecording]);

  const elapsedLabel = formatVoiceRecordingElapsed(elapsedSeconds);
  const presentation = getVoiceTranscriptionPresentation(phase, elapsedLabel);
  const isActive = phase !== "idle";
  const isRecording = phase === "recording";
  const isBusy = phase === "requesting" || phase === "transcribing";

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerControl
              aria-busy={isBusy || undefined}
              aria-label={presentation.label}
              aria-pressed={isRecording}
              className={cn(
                "h-8 min-h-8 shrink-0 px-0 after:absolute after:left-1/2 after:top-1/2 after:min-h-10 after:min-w-10 after:-translate-x-1/2 after:-translate-y-1/2 active:not-disabled:scale-[0.96] motion-reduce:transition-none pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11",
                "transition-[width,background-color,color,box-shadow,scale] duration-200 [transition-timing-function:cubic-bezier(0.2,0,0,1)]",
                isActive ? "w-[8.25rem]" : "w-9",
                isRecording
                  ? "bg-[oklch(0.94_0.028_28)] text-[oklch(0.46_0.145_28)] inset-shadow-[0_1px_--theme(--color-white/38%)] hover:bg-[oklch(0.92_0.038_28)] hover:text-[oklch(0.42_0.145_28)] dark:bg-[oklch(0.32_0.052_28)] dark:text-[oklch(0.82_0.095_28)] dark:inset-shadow-[0_1px_--theme(--color-white/10%)] dark:hover:bg-[oklch(0.35_0.06_28)] dark:hover:text-[oklch(0.86_0.095_28)]"
                  : isActive
                    ? "bg-foreground/[0.055] text-foreground/72 inset-shadow-[0_1px_--theme(--color-white/28%)] disabled:opacity-100 dark:inset-shadow-[0_1px_--theme(--color-white/8%)]"
                    : "text-muted-foreground/70 hover:text-foreground/80",
                isBusy && "cursor-wait",
                isActive ? "[&>span]:gap-1.5 [&>span]:px-2" : "[&>span]:px-0",
              )}
              data-voice-transcription-phase={phase}
              disabled={isBusy}
              onClick={handleClick}
              onPointerDown={(event) => event.preventDefault()}
              type="button"
            />
          }
        >
          <VoiceTranscriptionControlContent elapsedLabel={elapsedLabel} phase={phase} />
        </TooltipTrigger>
        <TooltipPopup side="top">{presentation.label}</TooltipPopup>
      </Tooltip>
      <span aria-live="polite" className="sr-only" role="status">
        {presentation.liveStatus}
      </span>
    </>
  );
}
