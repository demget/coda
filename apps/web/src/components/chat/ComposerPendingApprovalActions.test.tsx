import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";

describe("ComposerPendingApprovalActions", () => {
  it("groups turn controls separately from approval scopes", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalActions
        requestId={ApprovalRequestId.make("approval-1")}
        isResponding={false}
        onRespondToApproval={vi.fn()}
      />,
    );

    expect(markup).toContain('data-pending-approval-actions="true"');
    expect(markup).toContain("Cancel turn");
    expect(markup).toContain("Decline");
    expect(markup).toContain("Allow for session");
    expect(markup).toContain("Approve once");
  });
});
