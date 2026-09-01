import {
  MCP_THREAD_DEFAULT_SEARCH_LIMIT,
  MCP_THREAD_DEFAULT_TURN_LIMIT,
  McpThreadNotFoundError,
  McpThreadReadFailedError,
  McpThreadUnavailableError,
  type McpThreadSearchMatch,
  type ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { renderThreadTranscript } from "./render.ts";
import { ThreadToolkit } from "./tools.ts";

const requireThreadCapability = Effect.fn("ThreadToolkit.requireCapability")(function* () {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  if (!invocation.capabilities.has("thread")) {
    return yield* new McpThreadUnavailableError({
      capability: "thread",
      environmentId: invocation.environmentId,
      threadId: invocation.threadId,
      providerSessionId: invocation.providerSessionId,
      providerInstanceId: invocation.providerInstanceId,
    });
  }
  return invocation;
});

const readFailed =
  (operation: "search" | "read") =>
  (error: { readonly message: string }): McpThreadReadFailedError =>
    new McpThreadReadFailedError({ operation, reason: error.message });

/** Exported for tests; the toolkit layer below is the production entry point. */
export const threadToolkitHandlers = {
  thread_search: Effect.fn("ThreadToolkit.thread_search")(function* (input) {
    const invocation = yield* requireThreadCapability();
    const projections = yield* ProjectionSnapshotQuery;
    const { matches } = yield* projections
      .searchThreads({
        query: input.query,
        limit: input.limit ?? MCP_THREAD_DEFAULT_SEARCH_LIMIT,
      })
      .pipe(Effect.mapError(readFailed("search")));

    // The search returns one row per thread but carries no navigation
    // metadata, so titles come from a shell lookup per hit — bounded by the
    // input limit (25) and keyed by primary key. Project titles are cached
    // because threads cluster into a handful of projects.
    const projectTitles = new Map<ProjectId, string | null>();
    const enriched: McpThreadSearchMatch[] = [];
    for (const match of matches) {
      const shell = yield* projections
        .getThreadShellById(match.threadId)
        .pipe(Effect.mapError(readFailed("search")));
      if (Option.isNone(shell)) {
        continue;
      }
      let projectTitle = projectTitles.get(match.projectId);
      if (projectTitle === undefined) {
        const project = yield* projections
          .getProjectShellById(match.projectId)
          .pipe(Effect.mapError(readFailed("search")));
        projectTitle = Option.isSome(project) ? project.value.title : null;
        projectTitles.set(match.projectId, projectTitle);
      }
      enriched.push({
        threadId: match.threadId,
        projectId: match.projectId,
        title: shell.value.title,
        projectTitle,
        source: match.source,
        snippet: match.snippet,
        matchedAt: match.messageCreatedAt,
        updatedAt: shell.value.updatedAt,
        isCurrentThread: match.threadId === invocation.threadId,
      });
    }
    return { matches: enriched };
  }),

  thread_read: Effect.fn("ThreadToolkit.thread_read")(function* (input) {
    const invocation = yield* requireThreadCapability();
    const projections = yield* ProjectionSnapshotQuery;
    const threadId = input.threadId ?? invocation.threadId;
    const snapshot = yield* projections
      .getThreadDetailSnapshot(threadId, {
        turnLimit: input.turnLimit ?? MCP_THREAD_DEFAULT_TURN_LIMIT,
        ...(input.beforeCursor === undefined ? {} : { beforeCursor: input.beforeCursor }),
      })
      .pipe(Effect.mapError(readFailed("read")));
    if (Option.isNone(snapshot)) {
      return yield* new McpThreadNotFoundError({ threadId });
    }

    const { thread, page } = snapshot.value;
    const project = yield* projections
      .getProjectShellById(thread.projectId)
      .pipe(Effect.mapError(readFailed("read")));
    const rendered = renderThreadTranscript(thread, {
      includeTools: input.includeTools ?? false,
    });

    return {
      threadId: thread.id,
      title: thread.title,
      projectTitle: Option.isSome(project) ? project.value.title : null,
      workspaceRoot: Option.isSome(project) ? project.value.workspaceRoot : null,
      updatedAt: thread.updatedAt,
      transcript: rendered.transcript,
      messageCount: rendered.messageCount,
      toolCount: rendered.toolCount,
      truncated: rendered.truncated,
      hasMore: page?.hasMore ?? false,
      beforeCursor: page?.beforeCursor ?? null,
    };
  }),
} satisfies Parameters<typeof ThreadToolkit.toLayer>[0];

export const ThreadToolkitHandlersLive = ThreadToolkit.toLayer(threadToolkitHandlers);
