import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import {
  type FilePathChecker,
  type FilePathStatus,
  filePathExistenceStore,
} from "~/lib/filePathExistence";
import { projectEnvironment } from "~/state/projects";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

const STATUS_CHARS: Record<FilePathStatus, string> = {
  exists: "e",
  missing: "m",
  pending: "p",
  unverified: "u",
};

/**
 * Verdicts for path-shaped text a renderer wants to turn into a file link.
 * Without an environment to ask there is no verdict, so callers keep whatever
 * their own path heuristics decided.
 */
export function useFilePathExistence(
  environmentId: EnvironmentId | null,
  cwd: string | undefined,
  paths: readonly string[],
): (path: string) => FilePathStatus {
  const runCheck = useAtomQueryRunner(projectEnvironment.checkPaths, {
    reportFailure: false,
    reportDefect: false,
  });
  const check = useCallback<FilePathChecker>(
    async (target) => {
      if (!environmentId) return null;
      const result = await runCheck({
        environmentId,
        input: {
          ...(target.cwd ? { cwd: target.cwd } : {}),
          paths: target.paths,
        },
      });
      if (result._tag === "Failure") return null;
      return result.value.entries.map((entry) => ({
        path: entry.path,
        exists: entry.kind !== undefined,
      }));
    },
    [environmentId, runCheck],
  );

  // The path list is derived from message text: stable in content across
  // renders, but not in identity, so everything downstream keys on the content.
  const pathsKey = paths.join("\n");
  useEffect(() => {
    if (!environmentId || pathsKey.length === 0) return;
    filePathExistenceStore.observe({
      environmentId,
      cwd: cwd ?? null,
      paths: pathsKey.split("\n"),
      check,
    });
  }, [check, cwd, environmentId, pathsKey]);

  // Every answer anywhere in the app bumps the store, so subscribers compare
  // their own verdicts: a message only re-renders when one of its paths moved.
  const getSignature = useCallback(() => {
    if (!environmentId || pathsKey.length === 0) return "";
    let signature = "";
    for (const path of pathsKey.split("\n")) {
      signature += STATUS_CHARS[filePathExistenceStore.status(environmentId, cwd ?? null, path)];
    }
    return signature;
  }, [cwd, environmentId, pathsKey]);
  const signature = useSyncExternalStore(
    filePathExistenceStore.subscribe,
    getSignature,
    getSignature,
  );

  return useMemo(() => {
    void signature;
    return (path: string): FilePathStatus =>
      environmentId
        ? filePathExistenceStore.status(environmentId, cwd ?? null, path)
        : "unverified";
  }, [cwd, environmentId, signature]);
}
