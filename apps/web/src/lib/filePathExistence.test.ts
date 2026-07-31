import { describe, expect, it, vi } from "vite-plus/test";

import {
  type FilePathCheckTarget,
  type FilePathChecker,
  createFilePathExistenceStore,
} from "./filePathExistence";

const ENVIRONMENT = "env-1";
const CWD = "/workspace";

/** Lets the batch timer fire and the checker promise settle. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function checkerFor(existing: ReadonlySet<string>): {
  readonly check: FilePathChecker;
  readonly calls: FilePathCheckTarget[];
} {
  const calls: FilePathCheckTarget[] = [];
  const check: FilePathChecker = (target) => {
    calls.push(target);
    return Promise.resolve(target.paths.map((path) => ({ path, exists: existing.has(path) })));
  };
  return { check, calls };
}

function makeStore(options?: Parameters<typeof createFilePathExistenceStore>[0]) {
  return createFilePathExistenceStore({ batchDelayMs: 0, ...options });
}

describe("filePathExistenceStore", () => {
  it("answers exists and missing from one coalesced batch", async () => {
    const store = makeStore();
    const { check, calls } = checkerFor(new Set(["/workspace/src/main.ts"]));

    store.observe({
      environmentId: ENVIRONMENT,
      cwd: CWD,
      paths: ["/workspace/src/main.ts"],
      check,
    });
    store.observe({
      environmentId: ENVIRONMENT,
      cwd: CWD,
      paths: ["/workspace/src/main.ts", "/workspace/deepseek/deepseek-v3.2"],
      check,
    });

    expect(store.status(ENVIRONMENT, CWD, "/workspace/src/main.ts")).toBe("pending");
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.paths).toEqual([
      "/workspace/src/main.ts",
      "/workspace/deepseek/deepseek-v3.2",
    ]);
    expect(store.status(ENVIRONMENT, CWD, "/workspace/src/main.ts")).toBe("exists");
    expect(store.status(ENVIRONMENT, CWD, "/workspace/deepseek/deepseek-v3.2")).toBe("missing");
  });

  it("keeps answers separate per environment and workspace", async () => {
    const store = makeStore();
    const { check } = checkerFor(new Set(["/workspace/src/main.ts"]));

    store.observe({
      environmentId: ENVIRONMENT,
      cwd: CWD,
      paths: ["/workspace/src/main.ts"],
      check,
    });
    await settle();

    expect(store.status(ENVIRONMENT, CWD, "/workspace/src/main.ts")).toBe("exists");
    expect(store.status("env-2", CWD, "/workspace/src/main.ts")).toBe("pending");
    expect(store.status(ENVIRONMENT, "/other", "/workspace/src/main.ts")).toBe("pending");
  });

  it("reuses cached answers until they expire", async () => {
    let clock = 0;
    const store = makeStore({ missingTtlMs: 1_000, now: () => clock });
    const { check, calls } = checkerFor(new Set());
    const observation = {
      environmentId: ENVIRONMENT,
      cwd: CWD,
      paths: ["/workspace/notes.md"],
      check,
    };

    store.observe(observation);
    await settle();
    store.observe(observation);
    await settle();
    expect(calls).toHaveLength(1);

    clock += 1_001;
    store.observe(observation);
    await settle();
    expect(calls).toHaveLength(2);
  });

  it("treats an unanswered environment as unverified rather than missing", async () => {
    const store = makeStore();
    const unavailable: FilePathChecker = () => Promise.resolve(null);
    const rejecting: FilePathChecker = () => Promise.reject(new Error("socket closed"));

    store.observe({
      environmentId: ENVIRONMENT,
      cwd: CWD,
      paths: ["/workspace/src/main.ts"],
      check: unavailable,
    });
    store.observe({
      environmentId: "env-2",
      cwd: CWD,
      paths: ["/workspace/src/main.ts"],
      check: rejecting,
    });
    await settle();

    expect(store.status(ENVIRONMENT, CWD, "/workspace/src/main.ts")).toBe("unverified");
    expect(store.status("env-2", CWD, "/workspace/src/main.ts")).toBe("unverified");
  });

  it("gives up on an environment that never answers", async () => {
    const store = makeStore({ checkTimeoutMs: 1 });
    const silent: FilePathChecker = () => new Promise(() => {});

    store.observe({
      environmentId: ENVIRONMENT,
      cwd: CWD,
      paths: ["/workspace/src/main.ts"],
      check: silent,
    });
    await settle();
    await settle();

    expect(store.status(ENVIRONMENT, CWD, "/workspace/src/main.ts")).toBe("unverified");
  });

  it("leaves paths the environment skipped unverified", async () => {
    const store = makeStore();
    const partial: FilePathChecker = () =>
      Promise.resolve([{ path: "/workspace/a.ts", exists: true }]);

    store.observe({
      environmentId: ENVIRONMENT,
      cwd: CWD,
      paths: ["/workspace/a.ts", "/workspace/b.ts"],
      check: partial,
    });
    await settle();

    expect(store.status(ENVIRONMENT, CWD, "/workspace/a.ts")).toBe("exists");
    expect(store.status(ENVIRONMENT, CWD, "/workspace/b.ts")).toBe("unverified");
  });

  it("splits oversized path sets across requests", async () => {
    const store = makeStore({ maxBatchSize: 2 });
    const { check, calls } = checkerFor(new Set());

    store.observe({
      environmentId: ENVIRONMENT,
      cwd: CWD,
      paths: ["/a.ts", "/b.ts", "/c.ts"],
      check,
    });
    await settle();

    expect(calls.map((call) => call.paths)).toEqual([["/a.ts", "/b.ts"], ["/c.ts"]]);
  });

  it("notifies subscribers once answers land", async () => {
    const store = makeStore();
    const { check } = checkerFor(new Set(["/workspace/src/main.ts"]));
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.observe({
      environmentId: ENVIRONMENT,
      cwd: CWD,
      paths: ["/workspace/src/main.ts"],
      check,
    });
    expect(listener).not.toHaveBeenCalled();
    await settle();

    expect(listener).toHaveBeenCalled();
    expect(store.getVersion()).toBeGreaterThan(0);

    unsubscribe();
    store.reset();
    expect(store.status(ENVIRONMENT, CWD, "/workspace/src/main.ts")).toBe("pending");
  });

  it("evicts the least recently answered paths", async () => {
    const store = makeStore({ maxCacheSize: 1 });
    const { check } = checkerFor(new Set(["/a.ts", "/b.ts"]));

    store.observe({ environmentId: ENVIRONMENT, cwd: CWD, paths: ["/a.ts"], check });
    await settle();
    store.observe({ environmentId: ENVIRONMENT, cwd: CWD, paths: ["/b.ts"], check });
    await settle();

    expect(store.status(ENVIRONMENT, CWD, "/b.ts")).toBe("exists");
    expect(store.status(ENVIRONMENT, CWD, "/a.ts")).toBe("pending");
  });
});
