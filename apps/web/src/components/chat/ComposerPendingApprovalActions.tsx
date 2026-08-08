import { type ApprovalRequestId, type ProviderApprovalDecision } from "@t3tools/contracts";
import { memo } from "react";
import { Button } from "../ui/button";

interface ComposerPendingApprovalActionsProps {
  requestId: ApprovalRequestId;
  isResponding: boolean;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const handleCancelTurn = () => {
    void onRespondToApproval(requestId, "cancel");
  };
  const handleDecline = () => {
    void onRespondToApproval(requestId, "decline");
  };
  const handleAllowForSession = () => {
    void onRespondToApproval(requestId, "acceptForSession");
  };
  const handleApproveOnce = () => {
    void onRespondToApproval(requestId, "accept");
  };

  return (
    <div
      className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      data-pending-approval-actions="true"
    >
      <div className="flex items-center gap-1.5">
        <Button
          className="flex-1 sm:flex-none"
          size="sm"
          variant="ghost"
          disabled={isResponding}
          onClick={handleCancelTurn}
        >
          Cancel turn
        </Button>
        <Button
          className="flex-1 sm:flex-none"
          size="sm"
          variant="destructive-outline"
          disabled={isResponding}
          onClick={handleDecline}
        >
          Decline
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
        <Button size="sm" variant="outline" disabled={isResponding} onClick={handleAllowForSession}>
          Allow for session
        </Button>
        <Button size="sm" variant="default" disabled={isResponding} onClick={handleApproveOnce}>
          Approve once
        </Button>
      </div>
    </div>
  );
});
