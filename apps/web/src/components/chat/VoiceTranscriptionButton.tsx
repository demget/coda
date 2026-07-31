import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircleIcon, MicIcon, SquareIcon } from "lucide-react";

import { transcribeRecordedAudio } from "../../lib/geminiTranscription";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { formatVoiceRecordingElapsed } from "./voiceTranscription";

const MAX_RECORDING_MS = 120_000;

type VoiceTranscriptionPhase = "idle" | "requesting" | "recording" | "transcribing";

interface VoiceTranscriptionButtonProps {
  readonly apiKey: string;
  readonly onTranscript: (transcript: string) => void;
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
  let label: string;
  let buttonContent: ReactNode;
  switch (phase) {
    case "requesting":
      label = "Waiting for microphone permission";
      buttonContent = (
        <>
          <LoaderCircleIcon aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">Permission…</span>
        </>
      );
      break;
    case "recording":
      label = `Stop recording (${elapsedLabel})`;
      buttonContent = (
        <>
          <SquareIcon aria-hidden="true" className="size-3.5 fill-current" />
          <span>{elapsedLabel}</span>
        </>
      );
      break;
    case "transcribing":
      label = "Transcribing recording";
      buttonContent = (
        <>
          <LoaderCircleIcon aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">Transcribing…</span>
        </>
      );
      break;
    default:
      label = "Record voice message";
      buttonContent = <ComposerControlIcon icon={MicIcon} />;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl
            aria-label={label}
            className={cn(
              "shrink-0 tabular-nums",
              phase === "recording" &&
                "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive",
            )}
            disabled={phase === "requesting" || phase === "transcribing"}
            onClick={handleClick}
            onPointerDown={(event) => event.preventDefault()}
            type="button"
          />
        }
      >
        {buttonContent}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
