import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as EffectAcpSchema from "effect-acp/schema";
import { KimiSettings } from "@t3tools/contracts";

import {
  buildInitialKimiProviderSnapshot,
  buildKimiDiscoveredModelsFromConfigOptions,
  checkKimiProviderStatus,
} from "./KimiProvider.ts";

const decodeKimiSettings = Schema.decodeSync(KimiSettings);

const kimiConfigOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> = [
  {
    type: "select",
    id: "model",
    name: "Model",
    category: "model",
    currentValue: "kimi-code/k3",
    options: [
      { value: "kimi-code/kimi-for-coding", name: "K2.7 Coding" },
      { value: "kimi-code/kimi-for-coding-highspeed", name: "K2.7 Coding Highspeed" },
      { value: "kimi-code/k3", name: "K3" },
    ],
  },
  {
    type: "select",
    id: "mode",
    name: "Mode",
    category: "mode",
    currentValue: "default",
    options: [
      { value: "default", name: "Default" },
      { value: "plan", name: "Plan" },
    ],
  },
];

describe("buildKimiDiscoveredModelsFromConfigOptions", () => {
  it("maps Kimi's model config option into provider models", () => {
    expect(buildKimiDiscoveredModelsFromConfigOptions(kimiConfigOptions)).toEqual([
      expect.objectContaining({ slug: "kimi-code/kimi-for-coding", name: "K2.7 Coding" }),
      expect.objectContaining({
        slug: "kimi-code/kimi-for-coding-highspeed",
        name: "K2.7 Coding Highspeed",
      }),
      expect.objectContaining({ slug: "kimi-code/k3", name: "K3" }),
    ]);
  });

  it("returns no models when ACP does not advertise a model option", () => {
    expect(buildKimiDiscoveredModelsFromConfigOptions(kimiConfigOptions.slice(1))).toEqual([]);
  });
});

describe("buildInitialKimiProviderSnapshot", () => {
  it.effect("returns a disabled snapshot when settings.enabled is false", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialKimiProviderSnapshot(
        decodeKimiSettings({ enabled: false }),
      );
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
    }),
  );

  it.effect("returns the Kimi fallback catalog while availability is pending", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialKimiProviderSnapshot(decodeKimiSettings({}));
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.showInteractionModeToggle).toBe(true);
      expect(snapshot.requiresNewThreadForModelChange).toBeFalsy();
      expect(snapshot.models.map((model) => model.slug)).toEqual([
        "kimi-code/k3",
        "kimi-code/kimi-for-coding",
        "kimi-code/kimi-for-coding-highspeed",
      ]);
    }),
  );
});

it.layer(NodeServices.layer)("checkKimiProviderStatus", (it) => {
  it.effect("reports the binary as missing when the binary path does not resolve", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkKimiProviderStatus(
        decodeKimiSettings({
          enabled: true,
          binaryPath: "/definitely/not/installed/kimi-binary",
        }),
      );
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toMatch(/not installed|not on PATH|Failed to execute/);
    }),
  );
});
