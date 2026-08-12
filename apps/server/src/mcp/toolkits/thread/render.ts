import {
  MCP_THREAD_TOOL_LINE_MAX_CHARS,
  MCP_THREAD_TRANSCRIPT_MAX_CHARS,
  type OrchestrationMessage,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";

export interface RenderedThread {
  readonly transcript: string;
  readonly messageCount: number;
  readonly toolCount: number;
  readonly truncated: boolean;
}

export interface RenderThreadOptions {
  readonly includeTools?: boolean;
  readonly maxChars?: number;
}

interface Entry {
  readonly at: string;
  readonly order: number;
  readonly isMessage: boolean;
  readonly block: string;
}

/**
 * `2026-08-12T00:39:23.857Z` reads as `2026-08-12 00:39`. Seconds and
 * milliseconds cost a line's worth of noise on every entry and answer no
 * question anyone asks of a transcript.
 */
function formatTimestamp(value: string): string {
  return value.length >= 16 ? `${value.slice(0, 10)} ${value.slice(11, 16)}` : value;
}

function describeAttachments(message: OrchestrationMessage): string {
  const names = (message.attachments ?? []).map((attachment) => attachment.name);
  return names.length > 0 ? `(attached: ${names.join(", ")})` : "";
}

function renderMessage(message: OrchestrationMessage): string | null {
  const text = message.text.trim();
  const attachments = describeAttachments(message);
  const body = text.length > 0 ? (attachments ? `${text}\n${attachments}` : text) : attachments;
  if (body.length === 0) {
    return null;
  }
  const streaming = message.streaming ? " · still streaming" : "";
  return `### ${message.role} · ${formatTimestamp(message.createdAt)}${streaming}\n${body}`;
}

function activityDetail(activity: OrchestrationThreadActivity): string {
  const payload = activity.payload;
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const detail = (payload as { readonly detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim().length > 0) {
      return detail.trim();
    }
  }
  return activity.summary;
}

/**
 * Which activities earn a line in an agent-facing transcript.
 *
 * Tool lifecycles emit started/updated/completed for one call, and the
 * completion carries the final state, so only completions are rendered — the
 * other two are in-flight snapshots of a row already shown. `context-window`
 * and other info churn is dropped outright: it is the single largest kind in a
 * real database and says nothing about what the thread did. Errors and
 * approvals always render, with or without `includeTools`, because a denied
 * tool or a failed turn changes how the rest of the conversation reads.
 */
function isRenderableActivity(
  activity: OrchestrationThreadActivity,
  includeTools: boolean,
): boolean {
  if (activity.tone === "error") {
    return true;
  }
  if (!includeTools) {
    return false;
  }
  return activity.tone === "approval" || activity.kind === "tool.completed";
}

/**
 * One activity, one line. The detail is collapsed and clamped because
 * providers put arbitrary tool arguments in it — a file write arrives with the
 * whole file inline, which would otherwise consume the transcript budget and
 * push the conversation out of the window.
 */
function renderActivity(activity: OrchestrationThreadActivity): string {
  const marker = activity.tone === "error" ? "[error] " : "";
  const detail = activityDetail(activity).replaceAll(/\s+/g, " ");
  const clamped =
    detail.length > MCP_THREAD_TOOL_LINE_MAX_CHARS
      ? `${detail.slice(0, MCP_THREAD_TOOL_LINE_MAX_CHARS - 1)}…`
      : detail;
  return `- ${marker}${clamped}`;
}

/**
 * Renders a thread as an agent-readable transcript, oldest first.
 *
 * Truncation drops the *oldest* entries, so a caller that asks for a thread
 * bigger than the budget still gets the part nearest to now; the omitted head
 * is announced in the transcript and flagged on the result so the caller can
 * page backwards with `beforeCursor` instead of silently reasoning about half
 * a conversation.
 */
export function renderThreadTranscript(
  thread: Pick<OrchestrationThread, "messages" | "activities">,
  options: RenderThreadOptions = {},
): RenderedThread {
  const includeTools = options.includeTools ?? false;
  const maxChars = options.maxChars ?? MCP_THREAD_TRANSCRIPT_MAX_CHARS;

  const entries: Entry[] = [];
  let order = 0;
  for (const message of thread.messages) {
    const block = renderMessage(message);
    if (block !== null) {
      entries.push({ at: message.createdAt, order: order++, isMessage: true, block });
    }
  }
  for (const activity of thread.activities) {
    if (isRenderableActivity(activity, includeTools)) {
      entries.push({
        at: activity.createdAt,
        order: order++,
        isMessage: false,
        block: renderActivity(activity),
      });
    }
  }

  // Messages and activities are each already ordered; interleaving them by
  // timestamp keeps a tool call next to the reply that ran it. Ties fall back
  // to insertion order so equal timestamps stay stable.
  entries.sort((left, right) =>
    left.at === right.at ? left.order - right.order : left.at < right.at ? -1 : 1,
  );

  const kept: Entry[] = [];
  let size = 0;
  let dropped = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    const cost = entry.block.length + 2;
    if (size + cost > maxChars && kept.length > 0) {
      dropped = index + 1;
      break;
    }
    kept.push(entry);
    size += cost;
  }
  kept.reverse();

  const body = kept.map((entry) => entry.block).join("\n\n");
  const transcript =
    dropped > 0
      ? `… ${dropped} earlier ${dropped === 1 ? "entry" : "entries"} omitted …\n\n${body}`
      : body;

  return {
    transcript,
    messageCount: kept.filter((entry) => entry.isMessage).length,
    toolCount: kept.filter((entry) => !entry.isMessage).length,
    truncated: dropped > 0,
  };
}
