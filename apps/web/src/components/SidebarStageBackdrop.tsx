import { useAtomValue } from "@effect/atom-react";
import { useId } from "react";

import { APP_STAGE_LABEL } from "../branding";
import { resolveServerBackedAppStageLabel } from "../branding.logic";
import { primaryServerConfigAtom } from "../state/server";

export type SidebarStageBackdropVariant = "nightly" | "dev";
export type EnvironmentIdentificationPillLabel = "Dev" | "Nightly";

// A wide viewBox keeps the 96-unit art height at a fixed scale while sidebar resizing reveals
// more horizontal canvas instead of zooming the scene.
const STAGE_BACKDROP_VIEW_BOX = "0 0 8192 96";

export function resolveSidebarStageBackdropVariant(
  stageLabel: string,
  enabled = true,
): SidebarStageBackdropVariant | null {
  if (!enabled) return null;
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "nightly") return "nightly";
  if (normalized === "dev") return "dev";
  return null;
}

export function resolveSidebarStageFocusRingOffsetClass(
  variant: SidebarStageBackdropVariant,
): string {
  return variant === "nightly"
    ? "focus-visible:ring-offset-(--stage-night-bottom)"
    : "focus-visible:ring-offset-(--stage-art-bottom)";
}

export function resolveEnvironmentIdentificationPillLabel(
  stageLabel: string,
): EnvironmentIdentificationPillLabel | null {
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "dev") return "Dev";
  if (normalized === "nightly") return "Nightly";
  return null;
}

export function useEnvironmentStageLabel(): string {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;

  return resolveServerBackedAppStageLabel({
    primaryServerVersion,
    fallbackStageLabel: APP_STAGE_LABEL,
  });
}

export function useSidebarStageBackdropVariant(enabled = true): SidebarStageBackdropVariant | null {
  return resolveSidebarStageBackdropVariant(useEnvironmentStageLabel(), enabled);
}

/** Stage-channel header art; each variant is a neutral map of editor and agent activity. */
export function SidebarStageBackdrop({ variant }: { variant: SidebarStageBackdropVariant }) {
  return (
    <div
      aria-hidden
      className="sidebar-stage-backdrop pointer-events-none absolute inset-x-0 top-0 z-0 h-20 select-none overflow-hidden"
    >
      <EditorTraceArt variant={variant} />
    </div>
  );
}

export function StageBackdropArt({ variant }: { variant: SidebarStageBackdropVariant }) {
  return <EditorTraceArt variant={variant} />;
}

export function StageBackdropButtonArt({ variant }: { variant: SidebarStageBackdropVariant }) {
  return <EditorTraceArt compact variant={variant} />;
}

const EDITOR_TRACE_PALETTES = {
  dev: {
    background: "#30312D",
    panel: "#3A3B36",
    line: "#D4D7CD",
    strong: "#FAFBF4",
  },
  nightly: {
    background: "#11120F",
    panel: "#1B1C18",
    line: "#AFB3A8",
    strong: "#FAFBF4",
  },
} as const;

function EditorTraceArt({
  compact = false,
  variant,
}: {
  compact?: boolean;
  variant: SidebarStageBackdropVariant;
}) {
  const idPrefix = useId().replaceAll(":", "");
  const panelsId = `${idPrefix}-stage-editor-panels`;
  const rowsId = `${idPrefix}-stage-editor-rows`;
  const tracesId = `${idPrefix}-stage-editor-traces`;
  const palette = EDITOR_TRACE_PALETTES[variant];

  return (
    <svg
      className="h-full w-full"
      fill="none"
      preserveAspectRatio="xMinYMin slice"
      viewBox={compact ? "72 0 8192 96" : STAGE_BACKDROP_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id={panelsId} width="480" height="96" patternUnits="userSpaceOnUse">
          <rect width="142" height="96" fill={palette.panel} fillOpacity="0.72" />
          <path d="M142 0V96M360 0V96" stroke={palette.line} strokeOpacity="0.1" />
          <rect x="361" width="119" height="96" fill={palette.panel} fillOpacity="0.34" />
        </pattern>
        <pattern id={rowsId} width="480" height="16" patternUnits="userSpaceOnUse">
          <path d="M0 16H480" stroke={palette.line} strokeOpacity="0.07" />
        </pattern>
        <pattern id={tracesId} width="480" height="96" patternUnits="userSpaceOnUse">
          <g stroke={palette.line} strokeLinecap="round">
            <path d="M22 19V73M32 27V65" strokeOpacity="0.2" />
            <path d="M182 21H215V39H247V60H286" strokeOpacity="0.28" strokeWidth="0.8" />
            <path d="M181 69H218V53H265" strokeDasharray="3 4" strokeOpacity="0.22" />
            <path d="M382 25L388 31L382 37M394 37H408" strokeOpacity="0.42" />
          </g>

          <g fill={palette.line}>
            <rect x="44" y="19" width="53" height="3" rx="1.5" fillOpacity="0.42" />
            <rect x="44" y="29" width="79" height="3" rx="1.5" fillOpacity="0.24" />
            <rect x="54" y="39" width="43" height="3" rx="1.5" fillOpacity="0.36" />
            <rect x="54" y="49" width="65" height="3" rx="1.5" fillOpacity="0.2" />
            <rect x="44" y="59" width="36" height="3" rx="1.5" fillOpacity="0.3" />
            <rect x="44" y="69" width="72" height="3" rx="1.5" fillOpacity="0.16" />

            <circle cx="182" cy="21" r="2" fillOpacity="0.54" />
            <circle cx="215" cy="39" r="2" fillOpacity="0.36" />
            <circle cx="247" cy="60" r="2" fillOpacity="0.54" />
            <circle cx="286" cy="60" r="2" fillOpacity="0.3" />
            <circle cx="218" cy="53" r="1.5" fillOpacity="0.3" />

            <rect x="324" y="20" width="3" height="13" rx="1.5" fillOpacity="0.42" />
            <rect x="332" y="20" width="18" height="3" rx="1.5" fillOpacity="0.18" />
            <rect x="332" y="30" width="25" height="3" rx="1.5" fillOpacity="0.32" />
            <rect x="324" y="46" width="3" height="20" rx="1.5" fillOpacity="0.2" />
            <rect x="332" y="46" width="15" height="3" rx="1.5" fillOpacity="0.38" />
            <rect x="332" y="56" width="24" height="3" rx="1.5" fillOpacity="0.2" />
            <rect x="332" y="66" width="11" height="3" rx="1.5" fillOpacity="0.3" />
          </g>

          <g fill={palette.strong}>
            <circle cx="182" cy="21" r="0.8" fillOpacity="0.75" />
            <rect x="413" y="28" width="18" height="2" rx="1" fillOpacity="0.42" />
          </g>
        </pattern>
      </defs>

      <rect width="100%" height="96" fill={palette.background} />
      <rect width="100%" height="96" fill={`url(#${panelsId})`} />
      <rect width="100%" height="96" fill={`url(#${rowsId})`} />
      <rect width="100%" height="96" fill={`url(#${tracesId})`} />
    </svg>
  );
}
