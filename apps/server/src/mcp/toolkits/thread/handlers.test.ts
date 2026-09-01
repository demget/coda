import { it } from "@effect/vitest";
import {
  EnvironmentId,
  McpThreadNotFoundError,
  McpThreadUnavailableError,
  MessageId,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect, vi } from "vite-plus/test";

import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { threadToolkitHandlers } from "./handlers.ts";

const currentThreadId = ThreadId.make("thread-current");
const otherThreadId = ThreadId.make("thread-other");
const projectId = ProjectId.make("project-1");

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["preview", "thread"],
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId: currentThreadId,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

const modelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-5",
} as const;

function threadShell(id: ThreadId, title: string): OrchestrationThreadShell {
  return {
    id,
    projectId,
    title,
    modelSelection,
    runtimeMode: "auto",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

const projectShell: OrchestrationProjectShell = {
  id: projectId,
  title: "coda",
  workspaceRoot: "/Users/dem/Projects/coda",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
};

function thread(id: ThreadId, title: string): OrchestrationThread {
  return {
    id,
    projectId,
    title,
    modelSelection,
    runtimeMode: "auto",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [
      {
        id: MessageId.make("message-1"),
        role: "user",
        text: "how do I read a thread",
        turnId: null,
        streaming: false,
        createdAt: "2026-08-11T00:00:00.000Z",
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
    ],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}

interface StubOptions {
  readonly searchMatches?: ReadonlyArray<{
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly source: "user" | "assistant";
    readonly snippet: string;
    readonly messageCreatedAt: string | null;
  }>;
  readonly shells?: ReadonlyArray<OrchestrationThreadShell>;
  readonly detail?: OrchestrationThreadDetailSnapshot | null;
  readonly project?: OrchestrationProjectShell | null;
}

function stubProjections(options: StubOptions = {}) {
  const getThreadDetailSnapshot = vi.fn((_threadId: ThreadId, _window?: unknown) =>
    Effect.succeed(options.detail ? Option.some(options.detail) : Option.none()),
  );
  const getProjectShellById = vi.fn(() =>
    Effect.succeed(
      options.project === null ? Option.none() : Option.some(options.project ?? projectShell),
    ),
  );
  const searchThreads = vi.fn((_input: unknown) =>
    Effect.succeed({ matches: options.searchMatches ?? [] }),
  );
  const getThreadShellById = vi.fn((id: ThreadId) => {
    const shell = (options.shells ?? []).find((candidate) => candidate.id === id);
    return Effect.succeed(shell ? Option.some(shell) : Option.none());
  });

  const service = {
    getCommandReadModel: () => Effect.die("unused"),
    getSnapshot: () => Effect.die("unused"),
    getShellSnapshot: () => Effect.die("unused"),
    getArchivedShellSnapshot: () => Effect.die("unused"),
    searchThreads,
    getSnapshotSequence: () => Effect.die("unused"),
    getCounts: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
    getProjectShellById,
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.die("unused"),
    getFullThreadDiffContext: () => Effect.die("unused"),
    getThreadShellById,
    getThreadDetailById: () => Effect.die("unused"),
    getThreadDetailSnapshot,
  } as unknown as ProjectionSnapshotQuery["Service"];

  return {
    service,
    getThreadDetailSnapshot,
    getProjectShellById,
    searchThreads,
    getThreadShellById,
  };
}

const run = <A, E>(
  effect: Effect.Effect<A, E, McpInvocationContext.McpInvocationContext | ProjectionSnapshotQuery>,
  stub: ReturnType<typeof stubProjections>,
  scope = invocation(),
) =>
  effect.pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
    Effect.provideService(ProjectionSnapshotQuery, stub.service),
  );

const detailSnapshot = (
  value: OrchestrationThread,
  page?: OrchestrationThreadDetailSnapshot["page"],
): OrchestrationThreadDetailSnapshot => ({
  snapshotSequence: 42,
  thread: value,
  ...(page ? { page } : {}),
});

describe("thread_read", () => {
  it.effect("reads the calling agent's own thread when no id is given", () => {
    const stub = stubProjections({ detail: detailSnapshot(thread(currentThreadId, "Current")) });
    return Effect.gen(function* () {
      const result = yield* run(threadToolkitHandlers.thread_read({}), stub);

      expect(stub.getThreadDetailSnapshot).toHaveBeenCalledWith(currentThreadId, {
        turnLimit: 20,
      });
      expect(result).toMatchObject({
        threadId: currentThreadId,
        title: "Current",
        projectTitle: "coda",
        workspaceRoot: "/Users/dem/Projects/coda",
        messageCount: 1,
        truncated: false,
        hasMore: false,
        beforeCursor: null,
      });
      expect(result.transcript).toContain("how do I read a thread");
    });
  });

  it.effect("passes an explicit window through and echoes the page cursor back", () => {
    const stub = stubProjections({
      detail: detailSnapshot(thread(otherThreadId, "Other"), {
        beforeCursor: "cursor-2",
        hasMore: true,
        snapshotSequence: 42,
      }),
    });
    return Effect.gen(function* () {
      const result = yield* run(
        threadToolkitHandlers.thread_read({
          threadId: otherThreadId,
          turnLimit: 5,
          beforeCursor: "cursor-1",
        }),
        stub,
      );

      expect(stub.getThreadDetailSnapshot).toHaveBeenCalledWith(otherThreadId, {
        turnLimit: 5,
        beforeCursor: "cursor-1",
      });
      expect(result).toMatchObject({ hasMore: true, beforeCursor: "cursor-2" });
    });
  });

  it.effect("reports a missing thread instead of an empty transcript", () => {
    const stub = stubProjections({ detail: null });
    return Effect.gen(function* () {
      const error = yield* run(
        threadToolkitHandlers.thread_read({ threadId: otherThreadId }),
        stub,
      ).pipe(Effect.flip);

      expect(error).toBeInstanceOf(McpThreadNotFoundError);
      expect(error).toMatchObject({ threadId: otherThreadId });
    });
  });

  it.effect("survives a thread whose project record is gone", () => {
    const stub = stubProjections({
      detail: detailSnapshot(thread(currentThreadId, "Current")),
      project: null,
    });
    return Effect.gen(function* () {
      const result = yield* run(threadToolkitHandlers.thread_read({}), stub);

      expect(result).toMatchObject({ projectTitle: null, workspaceRoot: null });
    });
  });

  it.effect("refuses a credential without the thread capability", () => {
    const stub = stubProjections({ detail: detailSnapshot(thread(currentThreadId, "Current")) });
    return Effect.gen(function* () {
      const error = yield* run(
        threadToolkitHandlers.thread_read({}),
        stub,
        invocation(["preview"]),
      ).pipe(Effect.flip);

      expect(error).toBeInstanceOf(McpThreadUnavailableError);
      expect(stub.getThreadDetailSnapshot).not.toHaveBeenCalled();
    });
  });
});

describe("thread_search", () => {
  it.effect("labels matches with their thread title, project, and current-thread flag", () => {
    const stub = stubProjections({
      searchMatches: [
        {
          threadId: currentThreadId,
          projectId,
          source: "user",
          snippet: "…read a thread…",
          messageCreatedAt: "2026-08-11T00:00:00.000Z",
        },
        {
          threadId: otherThreadId,
          projectId,
          source: "assistant",
          snippet: "…thread search…",
          messageCreatedAt: null,
        },
      ],
      shells: [threadShell(currentThreadId, "Current"), threadShell(otherThreadId, "Other")],
    });
    return Effect.gen(function* () {
      const result = yield* run(threadToolkitHandlers.thread_search({ query: "thread" }), stub);

      expect(stub.searchThreads).toHaveBeenCalledWith({ query: "thread", limit: 10 });
      expect(result.matches).toEqual([
        {
          threadId: currentThreadId,
          projectId,
          title: "Current",
          projectTitle: "coda",
          source: "user",
          snippet: "…read a thread…",
          matchedAt: "2026-08-11T00:00:00.000Z",
          updatedAt: "2026-08-11T00:00:00.000Z",
          isCurrentThread: true,
        },
        {
          threadId: otherThreadId,
          projectId,
          title: "Other",
          projectTitle: "coda",
          source: "assistant",
          snippet: "…thread search…",
          matchedAt: null,
          updatedAt: "2026-08-11T00:00:00.000Z",
          isCurrentThread: false,
        },
      ]);
      // Both matches share a project; the second must not re-query it.
      expect(stub.getProjectShellById).toHaveBeenCalledTimes(1);
    });
  });

  it.effect("drops a match whose thread disappeared between the two reads", () => {
    const stub = stubProjections({
      searchMatches: [
        {
          threadId: otherThreadId,
          projectId,
          source: "user",
          snippet: "…gone…",
          messageCreatedAt: null,
        },
      ],
      shells: [],
    });
    return Effect.gen(function* () {
      const result = yield* run(threadToolkitHandlers.thread_search({ query: "gone" }), stub);

      expect(result.matches).toEqual([]);
    });
  });

  it.effect("refuses a credential without the thread capability", () => {
    const stub = stubProjections();
    return Effect.gen(function* () {
      const error = yield* run(
        threadToolkitHandlers.thread_search({ query: "thread" }),
        stub,
        invocation(["preview"]),
      ).pipe(Effect.flip);

      expect(error).toBeInstanceOf(McpThreadUnavailableError);
      expect(stub.searchThreads).not.toHaveBeenCalled();
    });
  });
});
