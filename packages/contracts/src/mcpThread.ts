import { Schema } from "effect";

import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";
import { OrchestrationThreadSearchSource } from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/**
 * Upper bound on a single rendered transcript. A thread is a conversation, not
 * a file: the agent reading it has already spent context getting here, so the
 * tool truncates rather than letting one call swallow the window. Callers that
 * need more walk backwards a page at a time with `beforeCursor`.
 */
export const MCP_THREAD_TRANSCRIPT_MAX_CHARS = 60_000;

/**
 * Upper bound on one rendered tool line. A tool's `detail` is whatever the
 * provider put there, and for file writes that is the entire file: one
 * unclamped line can swallow the whole transcript budget.
 */
export const MCP_THREAD_TOOL_LINE_MAX_CHARS = 200;

/** Turns returned when the caller does not ask for a specific window. */
export const MCP_THREAD_DEFAULT_TURN_LIMIT = 20;

/** Matches returned when the caller does not ask for a specific count. */
export const MCP_THREAD_DEFAULT_SEARCH_LIMIT = 10;

export const McpThreadSearchInput = Schema.Struct({
  query: TrimmedString.check(Schema.isMinLength(2), Schema.isMaxLength(200)).annotate({
    description:
      "Literal text to look for in user prompts and final assistant replies. Not a regex, and archived threads are excluded.",
  }),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 25 })).annotate({
      description: `Maximum matches to return. Defaults to ${MCP_THREAD_DEFAULT_SEARCH_LIMIT}.`,
    }),
  ),
});
export type McpThreadSearchInput = typeof McpThreadSearchInput.Type;

export const McpThreadSearchMatch = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  /** Null when the thread outlived its project record. */
  projectTitle: Schema.NullOr(TrimmedNonEmptyString),
  /** Whether the hit came from a user prompt or an assistant reply. */
  source: OrchestrationThreadSearchSource,
  snippet: Schema.String,
  matchedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
  /** True when the match is the thread the calling agent is running in. */
  isCurrentThread: Schema.Boolean,
});
export type McpThreadSearchMatch = typeof McpThreadSearchMatch.Type;

export const McpThreadSearchResult = Schema.Struct({
  matches: Schema.Array(McpThreadSearchMatch),
});
export type McpThreadSearchResult = typeof McpThreadSearchResult.Type;

export const McpThreadReadInput = Schema.Struct({
  threadId: Schema.optional(
    ThreadId.annotate({
      description: "Thread to read. Omit to read the thread this agent is running in.",
    }),
  ),
  turnLimit: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(100)).annotate({
      description: `Most recent user turns to include. Defaults to ${MCP_THREAD_DEFAULT_TURN_LIMIT}.`,
    }),
  ),
  beforeCursor: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Cursor from a previous read's `beforeCursor`. Returns the adjacent page of older turns.",
    }),
  ),
  includeTools: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "Include one line per tool call alongside the messages. Off by default because tool activity dwarfs the conversation.",
    }),
  ),
});
export type McpThreadReadInput = typeof McpThreadReadInput.Type;

export const McpThreadReadResult = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  /** Null when the thread outlived its project record. */
  projectTitle: Schema.NullOr(TrimmedNonEmptyString),
  /** Null when the thread outlived its project record. */
  workspaceRoot: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
  /** Rendered conversation, oldest first. */
  transcript: Schema.String,
  messageCount: NonNegativeInt,
  toolCount: NonNegativeInt,
  /** True when the transcript hit the character ceiling and lost its oldest content. */
  truncated: Schema.Boolean,
  /** True when older turns exist before this page. */
  hasMore: Schema.Boolean,
  /** Pass back as `beforeCursor` to read the next page of older turns. */
  beforeCursor: Schema.NullOr(TrimmedNonEmptyString),
});
export type McpThreadReadResult = typeof McpThreadReadResult.Type;

export class McpThreadUnavailableError extends Schema.TaggedErrorClass<McpThreadUnavailableError>()(
  "McpThreadUnavailableError",
  {
    capability: Schema.Literal("thread"),
    environmentId: EnvironmentId,
    threadId: ThreadId,
    providerSessionId: TrimmedNonEmptyString,
    providerInstanceId: ProviderInstanceId,
  },
) {
  override get message(): string {
    return `MCP credential does not grant the ${this.capability} capability.`;
  }
}

export class McpThreadNotFoundError extends Schema.TaggedErrorClass<McpThreadNotFoundError>()(
  "McpThreadNotFoundError",
  {
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return `No thread ${this.threadId} in this environment.`;
  }
}

export class McpThreadReadFailedError extends Schema.TaggedErrorClass<McpThreadReadFailedError>()(
  "McpThreadReadFailedError",
  {
    operation: Schema.Literals(["search", "read"]),
    reason: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return `Thread ${this.operation} failed: ${this.reason}`;
  }
}

export const McpThreadError = Schema.Union([
  McpThreadUnavailableError,
  McpThreadNotFoundError,
  McpThreadReadFailedError,
]);
export type McpThreadError = typeof McpThreadError.Type;
