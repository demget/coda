import {
  EventId,
  MessageId,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
  TurnId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { renderThreadTranscript } from "./render.ts";

const turnId = TurnId.make("turn-1");

function message(
  index: number,
  role: OrchestrationMessage["role"],
  text: string,
  overrides: Partial<OrchestrationMessage> = {},
): OrchestrationMessage {
  const createdAt = `2026-08-12T00:${String(index).padStart(2, "0")}:00.000Z`;
  return {
    id: MessageId.make(`message-${index}`),
    role,
    text,
    turnId,
    streaming: false,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function activity(
  index: number,
  kind: string,
  tone: OrchestrationThreadActivity["tone"],
  overrides: Partial<OrchestrationThreadActivity> = {},
): OrchestrationThreadActivity {
  return {
    id: EventId.make(`event-${index}`),
    tone,
    kind,
    summary: `${kind} summary`,
    payload: { detail: `${kind} detail` },
    turnId,
    createdAt: `2026-08-12T00:${String(index).padStart(2, "0")}:00.000Z`,
    ...overrides,
  };
}

describe("renderThreadTranscript", () => {
  it("renders the conversation without tool activity by default", () => {
    const rendered = renderThreadTranscript({
      messages: [message(1, "user", "fix the sidebar"), message(3, "assistant", "done")],
      activities: [activity(2, "tool.completed", "tool")],
    });

    expect(rendered.transcript).toBe(
      "### user · 2026-08-12 00:01\nfix the sidebar\n\n### assistant · 2026-08-12 00:03\ndone",
    );
    expect(rendered).toMatchObject({ messageCount: 2, toolCount: 0, truncated: false });
  });

  it("interleaves tool calls with the conversation when asked", () => {
    const rendered = renderThreadTranscript(
      {
        messages: [message(1, "user", "fix the sidebar"), message(3, "assistant", "done")],
        activities: [
          activity(2, "tool.completed", "tool", { payload: { detail: "Bash: pnpm test" } }),
        ],
      },
      { includeTools: true },
    );

    expect(rendered.transcript).toBe(
      [
        "### user · 2026-08-12 00:01",
        "fix the sidebar",
        "",
        "- Bash: pnpm test",
        "",
        "### assistant · 2026-08-12 00:03",
        "done",
      ].join("\n"),
    );
    expect(rendered).toMatchObject({ messageCount: 2, toolCount: 1 });
  });

  it("drops in-flight and informational activity that a completion already covers", () => {
    const rendered = renderThreadTranscript(
      {
        messages: [message(1, "user", "go")],
        activities: [
          activity(2, "tool.started", "tool"),
          activity(3, "tool.updated", "tool"),
          activity(4, "context-window.updated", "info"),
          activity(5, "tool.completed", "tool"),
        ],
      },
      { includeTools: true },
    );

    expect(rendered.toolCount).toBe(1);
    expect(rendered.transcript).toContain("tool.completed detail");
    expect(rendered.transcript).not.toContain("tool.updated");
    expect(rendered.transcript).not.toContain("context-window");
  });

  it("always surfaces errors, even with tool activity switched off", () => {
    const rendered = renderThreadTranscript({
      messages: [message(1, "user", "go")],
      activities: [
        activity(2, "tool.completed", "tool"),
        activity(3, "tool.denied", "error", { payload: { detail: "Bash: rm -rf /" } }),
      ],
    });

    expect(rendered.transcript).toContain("- [error] Bash: rm -rf /");
    expect(rendered.toolCount).toBe(1);
  });

  it("clamps a tool line whose detail carries an entire file argument", () => {
    const rendered = renderThreadTranscript(
      {
        messages: [],
        activities: [
          activity(1, "tool.completed", "tool", {
            payload: { detail: `Write: {"content":"${"x".repeat(5_000)}\n\nmore"}` },
          }),
        ],
      },
      { includeTools: true },
    );

    expect(rendered.transcript.length).toBe(202);
    expect(rendered.transcript.startsWith('- Write: {"content":"xxx')).toBe(true);
    expect(rendered.transcript.endsWith("…")).toBe(true);
    expect(rendered.transcript).not.toContain("\n");
  });

  it("falls back to the activity summary when the payload carries no detail", () => {
    const rendered = renderThreadTranscript({
      messages: [],
      activities: [activity(1, "runtime.error", "error", { payload: null })],
    });

    expect(rendered.transcript).toBe("- [error] runtime.error summary");
  });

  it("skips empty messages but keeps attachment-only ones", () => {
    const rendered = renderThreadTranscript({
      messages: [
        message(1, "assistant", "   "),
        message(2, "user", "", {
          attachments: [
            {
              type: "image",
              id: "att-1",
              name: "screenshot.png",
              mimeType: "image/png",
              sizeBytes: 12,
            },
          ],
        }),
      ],
      activities: [],
    });

    expect(rendered.transcript).toBe("### user · 2026-08-12 00:02\n(attached: screenshot.png)");
    expect(rendered.messageCount).toBe(1);
  });

  it("marks a streaming message so a half-written reply is not read as final", () => {
    const rendered = renderThreadTranscript({
      messages: [message(1, "assistant", "working on", { streaming: true })],
      activities: [],
    });

    expect(rendered.transcript).toContain("### assistant · 2026-08-12 00:01 · still streaming");
  });

  it("drops the oldest entries when the transcript exceeds its budget", () => {
    const rendered = renderThreadTranscript(
      {
        messages: [
          message(1, "user", "oldest"),
          message(2, "assistant", "middle"),
          message(3, "user", "newest"),
        ],
        activities: [],
      },
      { maxChars: 60 },
    );

    expect(rendered.truncated).toBe(true);
    expect(rendered.transcript).toContain("earlier entries omitted");
    expect(rendered.transcript).toContain("newest");
    expect(rendered.transcript).not.toContain("oldest");
  });

  it("keeps the newest entry even when it alone exceeds the budget", () => {
    const rendered = renderThreadTranscript(
      { messages: [message(1, "user", "a".repeat(500))], activities: [] },
      { maxChars: 10 },
    );

    expect(rendered.messageCount).toBe(1);
    expect(rendered.truncated).toBe(false);
  });
});
