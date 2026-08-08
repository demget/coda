import { CircleAlertIcon } from "lucide-react";
import { memo } from "react";
import { type PendingApproval } from "../../session-logic";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
}: ComposerPendingApprovalPanelProps) {
  const approvalDescription =
    approval.requestKind === "command"
      ? "The agent wants to run this command."
      : approval.requestKind === "file-read"
        ? "The agent wants to read this file."
        : "The agent wants to change this file.";
  const detailLabel =
    approval.requestKind === "command"
      ? "Command"
      : approval.requestKind === "file-read"
        ? "File to read"
        : "File change";

  return (
    <section aria-label="Approval required" className="px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        >
          <CircleAlertIcon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-sm font-semibold text-foreground">Approval required</h2>
            <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[0.6875rem] font-medium text-amber-800 dark:text-amber-200">
              {detailLabel}
            </span>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {approvalDescription}
          </p>
        </div>
        {pendingCount > 1 ? (
          <span className="shrink-0 rounded-full border border-border/70 bg-background px-2 py-0.5 text-[0.6875rem] font-medium tabular-nums text-muted-foreground">
            1 of {pendingCount}
          </span>
        ) : null}
      </div>
      {approval.detail ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-border/70 bg-muted/25 shadow-inner shadow-black/[0.025] dark:shadow-black/20">
          <div className="flex items-center gap-2 border-b border-border/60 bg-muted/35 px-3 py-2">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-500" />
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {detailLabel}
            </p>
          </div>
          <pre
            aria-label={detailLabel}
            className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-3.5 py-3 font-mono text-xs leading-[1.65] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            data-approval-detail="complete"
            tabIndex={0}
          >
            {approval.detail}
          </pre>
        </div>
      ) : null}
    </section>
  );
});
