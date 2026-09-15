import { describe, expect, it } from "vite-plus/test";

import { isNightlyDesktopVersion, resolveDefaultDesktopUpdateChannel } from "./updateChannels.ts";

describe("updateChannels", () => {
  it("keeps preview builds branded as nightly but on the latest update channel", () => {
    expect(isNightlyDesktopVersion("0.0.41-preview.20260911.7")).toBe(true);
    expect(resolveDefaultDesktopUpdateChannel("0.0.41-preview.20260911.7")).toBe("latest");
    expect(resolveDefaultDesktopUpdateChannel("0.0.41-nightly.20260911.7")).toBe("nightly");
  });

  it("keeps Coda snapshots and releases on the nightly update feed", () => {
    for (const version of [
      "0.0.41-nightly.20260915.1752.coda.2.487",
      "0.0.41-nightly.20260915.1752.coda.2.487.200",
    ]) {
      expect(isNightlyDesktopVersion(version)).toBe(true);
      expect(resolveDefaultDesktopUpdateChannel(version)).toBe("nightly");
    }
    expect(resolveDefaultDesktopUpdateChannel("1.2.3-foo-nightly.20260915.1")).toBe("latest");
  });

  it("only matches the first prerelease identifier", () => {
    expect(isNightlyDesktopVersion("1.2.3-foo-preview.20260911.1")).toBe(false);
    expect(isNightlyDesktopVersion("1.2.3")).toBe(false);
  });
});
