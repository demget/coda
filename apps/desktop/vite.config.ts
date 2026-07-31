import { defineConfig } from "vite-plus";

import { loadRepoEnv } from "../../scripts/lib/public-config.ts";

const repoEnv = loadRepoEnv();
/**
 * `CODA_DESKTOP_AUTO_RELAUNCH=0` gives the app a fixed build for its whole
 * lifetime, for working on Coda from inside Coda: the window you are using is
 * never restarted out from under you, and picking up new code is a deliberate
 * re-run of the dev command.
 *
 * It has to change how the app is launched, not just whether something restarts
 * it. `vp pack --watch` re-runs its `onSuccess` command on every rebuild, so the
 * supervisor that owns the Electron process is itself replaced each time, and
 * the outgoing one takes its app down with it. Manual mode therefore builds once
 * and launches the supervisor directly, leaving the watch pipeline out of it.
 */
const autoRelaunch = process.env.CODA_DESKTOP_AUTO_RELAUNCH !== "0";
const shouldLaunchElectronAfterPack = process.env.CODA_DESKTOP_DEV === "1" && autoRelaunch;
export const DEV_WORKTREE_WATCH_IGNORED = [
  "**/.claude/worktrees/**",
  "**/.codex/worktrees/**",
  "**/apps/server/worktrees/**",
] as const;
const publicConfigDefine = {
  __CODA_BUILD_CLERK_PUBLISHABLE_KEY__: JSON.stringify(
    repoEnv.CODA_CLERK_PUBLISHABLE_KEY?.trim() ?? "",
  ),
};

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "node scripts/build-preview-annotation-css.mjs && vp pack",
        dependsOn: ["coda#build"],
        cache: false,
      },
      dev: {
        command: autoRelaunch
          ? "node scripts/build-preview-annotation-css.mjs && cross-env CODA_DESKTOP_DEV=1 vp pack --watch"
          : "node scripts/build-preview-annotation-css.mjs && vp pack && node scripts/dev-electron.mjs",
        dependsOn: ["coda#build"],
        cache: false,
      },
      "dev:bundle": {
        command: "node scripts/build-preview-annotation-css.mjs && vp pack --watch",
        cache: false,
      },
      "dev:electron": {
        command: "node scripts/dev-electron.mjs",
        dependsOn: ["coda#build"],
        cache: false,
      },
    },
  },
  pack: [
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      define: publicConfigDefine,
      ignoreWatch: [...DEV_WORKTREE_WATCH_IGNORED],
      entry: ["src/main.ts"],
      clean: true,
      deps: {
        alwaysBundle: (id) => id.startsWith("@t3tools/"),
      },
      ...(shouldLaunchElectronAfterPack ? { onSuccess: "node scripts/dev-electron.mjs" } : {}),
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      define: publicConfigDefine,
      ignoreWatch: [...DEV_WORKTREE_WATCH_IGNORED],
      entry: ["src/preload.ts"],
      deps: {
        // Sandboxed Electron preloads cannot reliably resolve package imports
        // from inside the packaged ASAR. Bundle Clerk's preload bridge into the
        // preload artifact instead of leaving a runtime require() behind.
        alwaysBundle: (id) => id === "@clerk/electron" || id.startsWith("@clerk/electron/"),
      },
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      ignoreWatch: [...DEV_WORKTREE_WATCH_IGNORED],
      entry: ["src/preview-pick-preload.ts"],
      deps: {
        alwaysBundle: (id) => id === "react-grab" || id.startsWith("react-grab/"),
      },
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      ignoreWatch: [...DEV_WORKTREE_WATCH_IGNORED],
      entry: ["src/preview-pip-preload.ts"],
    },
  ],
});
