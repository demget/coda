import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";

describe("ComposerPendingUserInputPanel", () => {
  it("renders an accessible collapse control with the question expanded by default", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingUserInputPanel
        pendingUserInputs={[
          {
            requestId: ApprovalRequestId.make("request-1"),
            createdAt: "2026-07-31T00:00:00.000Z",
            questions: [
              {
                id: "scope",
                header: "Scope",
                question: "Which surface should this change cover?",
                options: [
                  {
                    label: "Web and desktop",
                    description: "Use the shared web composer.",
                  },
                ],
                multiSelect: false,
              },
            ],
          },
        ]}
        respondingRequestIds={[]}
        answers={{}}
        questionIndex={0}
        onToggleOption={vi.fn()}
        onAdvance={vi.fn()}
      />,
    );

    expect(markup).toContain('data-pending-user-input-collapsed="false"');
    expect(markup).toContain('aria-label="Collapse question"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toMatch(/aria-controls="([^"]+)"/);
    expect(markup).toMatch(/<div id="[^"]+"><p class="text-sm/);
    expect(markup).not.toContain('hidden=""');
    expect(markup).not.toContain("rotate-180");
  });
});
