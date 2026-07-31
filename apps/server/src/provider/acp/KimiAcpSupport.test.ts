import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  applyKimiAcpModelSelection,
  buildKimiAcpSpawnInput,
  resolveKimiAcpBaseModelId,
} from "./KimiAcpSupport.ts";

describe("resolveKimiAcpBaseModelId", () => {
  it("normalizes Kimi model aliases and preserves custom model ids", () => {
    expect(resolveKimiAcpBaseModelId(undefined)).toBe("kimi-code/k3");
    expect(resolveKimiAcpBaseModelId("   ")).toBe("kimi-code/k3");
    expect(resolveKimiAcpBaseModelId("k3")).toBe("kimi-code/k3");
    expect(resolveKimiAcpBaseModelId("k2.7")).toBe("kimi-code/kimi-for-coding");
    expect(resolveKimiAcpBaseModelId("  custom/provider-model  ")).toBe("custom/provider-model");
  });
});

describe("buildKimiAcpSpawnInput", () => {
  it("builds the default Kimi ACP command", () => {
    expect(buildKimiAcpSpawnInput(undefined, "/tmp/project")).toEqual({
      command: "kimi",
      args: ["acp"],
      cwd: "/tmp/project",
      forceKillAfter: "2 seconds",
    });
  });

  it("uses the configured binary and environment", () => {
    expect(
      buildKimiAcpSpawnInput({ binaryPath: "/opt/kimi/bin/kimi" }, "/tmp/project", {
        KIMI_PROFILE: "work",
      }),
    ).toEqual({
      command: "/opt/kimi/bin/kimi",
      args: ["acp"],
      cwd: "/tmp/project",
      forceKillAfter: "2 seconds",
      env: { KIMI_PROFILE: "work" },
    });
  });
});

describe("applyKimiAcpModelSelection", () => {
  it.effect("switches the negotiated model through the ACP runtime", () =>
    Effect.gen(function* () {
      const modelCalls: Array<string> = [];
      yield* applyKimiAcpModelSelection({
        runtime: {
          setModel: (model) =>
            Effect.sync(() => {
              modelCalls.push(model);
            }),
        },
        model: "k3",
        mapError: (cause) => cause.message,
      });

      expect(modelCalls).toEqual(["kimi-code/k3"]);
    }),
  );

  it.effect("maps ACP model switching failures", () =>
    Effect.gen(function* () {
      const failure = EffectAcpErrors.AcpRequestError.invalidParams("unknown model");
      const error = yield* Effect.flip(
        applyKimiAcpModelSelection({
          runtime: { setModel: () => failure },
          model: "k3",
          mapError: (cause) => cause.message,
        }),
      );

      expect(error).toBe(failure.message);
    }),
  );
});
