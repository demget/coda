import * as NodeAssert from "node:assert/strict";
import { describe, it } from "vite-plus/test";

import {
  compareNightlyTags,
  createDownstreamVersion,
  decodeDownstreamState,
  findPathCollisions,
  renderCollisionReport,
  resolveDownstreamUpdate,
  selectLatestNightlyRelease,
} from "./downstream-sync.ts";

const sha = (character: string) => character.repeat(40);

const state = {
  repository: "pingdotgg/t3code",
  branch: "main",
  mainSha: sha("a"),
  nightlyTag: "v0.0.32-nightly.20260803.986",
  nightlySha: sha("b"),
  version: "0.0.32-nightly.20260803.986.coda.0.10",
} as const;

describe("downstream sync", () => {
  it("decodes bootstrap and published checkpoints", () => {
    NodeAssert.equal(
      decodeDownstreamState({ ...state, nightlyTag: null, nightlySha: null, version: null })
        .version,
      null,
    );
    NodeAssert.deepEqual(decodeDownstreamState(state), state);
    NodeAssert.throws(() => decodeDownstreamState({ ...state, nightlySha: null }), /both be set/);
  });

  it("selects the greatest valid published nightly", () => {
    NodeAssert.equal(
      selectLatestNightlyRelease([
        {
          tag_name: "v0.0.32-nightly.20260803.986",
          prerelease: true,
          published_at: "2026-08-03T10:00:00Z",
        },
        {
          tag_name: "v0.0.32-nightly.20260803.992",
          prerelease: true,
          published_at: "2026-08-03T22:00:00Z",
        },
        { tag_name: "v0.0.33", prerelease: false, published_at: "2026-08-04T00:00:00Z" },
      ]).tag,
      "v0.0.32-nightly.20260803.992",
    );
  });

  it("creates monotonically comparable Coda versions", () => {
    const version = createDownstreamVersion({
      releaseVersion: "0.0.32-nightly.20260803.992",
      mainDistance: 3,
      runNumber: 44,
    });
    NodeAssert.equal(version, "0.0.32-nightly.20260803.992.coda.3.44");
    NodeAssert.ok(compareNightlyTags(`v${version}`, "v0.0.32-nightly.20260803.992") > 0);
  });

  it("resolves upstream movement and manual rebuilds", () => {
    const release = {
      tag: "v0.0.32-nightly.20260803.992",
      version: "0.0.32-nightly.20260803.992",
      publishedAt: "2026-08-03T22:00:00Z",
    };
    const update = resolveDownstreamUpdate({
      state,
      release,
      mainSha: sha("c"),
      nightlySha: sha("d"),
      mainDistance: 2,
      runNumber: 20,
      force: false,
    });
    NodeAssert.equal(update.has_update, "true");
    NodeAssert.equal(update.version, "0.0.32-nightly.20260803.992.coda.2.20");

    const noUpdate = resolveDownstreamUpdate({
      state,
      release: {
        tag: state.nightlyTag,
        version: state.nightlyTag.slice(1),
        publishedAt: "2026-08-03T10:00:00Z",
      },
      mainSha: state.mainSha,
      nightlySha: state.nightlySha,
      mainDistance: 0,
      runNumber: 21,
      force: false,
    });
    NodeAssert.equal(noUpdate.has_update, "false");
    NodeAssert.equal(
      resolveDownstreamUpdate({
        state,
        release: {
          tag: state.nightlyTag,
          version: state.nightlyTag.slice(1),
          publishedAt: "2026-08-03T10:00:00Z",
        },
        mainSha: state.mainSha,
        nightlySha: state.nightlySha,
        mainDistance: 0,
        runNumber: 21,
        force: true,
      }).has_update,
      "true",
    );
  });

  it("reports only real path overlap and unmerged files", () => {
    NodeAssert.deepEqual(findPathCollisions(["a.ts", "b.ts"], ["b.ts", "c.ts"]), ["b.ts"]);
    const report = renderCollisionReport({
      oldSha: sha("a"),
      newTag: "v1",
      newSha: sha("b"),
      overlappingPaths: ["b.ts"],
      unmergedPaths: ["b.ts"],
      rebaseError: "conflict",
    });
    NodeAssert.match(report, /The candidate was not built, published, or pushed/);
    NodeAssert.match(report, /`b\.ts`/);
  });
});
