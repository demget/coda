import {
  McpThreadError,
  McpThreadReadInput,
  McpThreadReadResult,
  McpThreadSearchInput,
  McpThreadSearchResult,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/unstable/ai";

import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, ProjectionSnapshotQuery];

export const ThreadSearchTool = Tool.make("thread_search", {
  description:
    "Find earlier Coda threads in this environment by what was said in them. Use when the user refers to past work ('in a previous thread I tried...'), then read the match with thread_read. Returns one match per thread, most relevant first.",
  parameters: McpThreadSearchInput,
  success: McpThreadSearchResult,
  failure: McpThreadError,
  dependencies,
})
  .annotate(Tool.Title, "Search threads")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ThreadReadTool = Tool.make("thread_read", {
  description:
    "Read a Coda thread's conversation as text, oldest first. Omit threadId to read the thread this agent is running in. Returns the most recent turns by default; page further back by passing the returned beforeCursor.",
  parameters: McpThreadReadInput,
  success: McpThreadReadResult,
  failure: McpThreadError,
  dependencies,
})
  .annotate(Tool.Title, "Read thread")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ThreadToolkit = Toolkit.make(ThreadSearchTool, ThreadReadTool);
