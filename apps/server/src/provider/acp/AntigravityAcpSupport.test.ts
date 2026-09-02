import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  applyAntigravityAcpModelSelection,
  buildAntigravityAcpSpawnInput,
  resolveAntigravityAcpBaseModelId,
  resolveAntigravityAuthMethodId,
} from "./AntigravityAcpSupport.ts";

describe("resolveAntigravityAcpBaseModelId", () => {
  it("normalizes empty and custom Antigravity model ids", () => {
    expect(resolveAntigravityAcpBaseModelId(undefined)).toBe("gemini-3.7-flash-high");
    expect(resolveAntigravityAcpBaseModelId("   ")).toBe("gemini-3.7-flash-high");
    expect(resolveAntigravityAcpBaseModelId("  gemini-3.8-flash-low  ")).toBe(
      "gemini-3.8-flash-low",
    );
  });

  it("expands the CLI id for Gemini 3.1 Pro (High) to the ACP id", () => {
    expect(resolveAntigravityAcpBaseModelId("gemini-3.1-pro-high")).toBe("gemini-pro-agent");
  });
});

describe("resolveAntigravityAuthMethodId", () => {
  it("uses the Google account login unless a Gemini API key is set", () => {
    expect(resolveAntigravityAuthMethodId(undefined)).toBe("oauth-personal");
    expect(resolveAntigravityAuthMethodId({ GEMINI_API_KEY: "  " })).toBe("oauth-personal");
    expect(resolveAntigravityAuthMethodId({ GEMINI_API_KEY: "key" })).toBe("gemini-api-key");
  });
});

describe("buildAntigravityAcpSpawnInput", () => {
  it("spawns the configured binary with no extra args", () => {
    const spawn = buildAntigravityAcpSpawnInput(
      { binaryPath: "/usr/local/bin/agy_acp_server.par" },
      "/tmp/project",
      { PATH: "/usr/bin" },
    );

    expect(spawn).toEqual({
      command: "/usr/local/bin/agy_acp_server.par",
      args: [],
      cwd: "/tmp/project",
      env: {
        PATH: "/usr/bin",
      },
    });
  });

  it("falls back to the default binary name on PATH", () => {
    const spawn = buildAntigravityAcpSpawnInput({ binaryPath: "" }, "/tmp/project");

    expect(spawn.command).toBe("agy_acp_server");
    expect(spawn.args).toEqual([]);
  });
});

describe("applyAntigravityAcpModelSelection", () => {
  const makeRecordingRuntime = (failure?: EffectAcpErrors.AcpError) => {
    const modelCalls: Array<string> = [];
    const runtime = {
      setSessionModel: (modelId: string) =>
        Effect.gen(function* () {
          modelCalls.push(modelId);
          if (failure) return yield* failure;
          return {};
        }),
    };
    return { runtime, modelCalls };
  };

  it.effect("calls session/set_model when the requested model differs from current", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyAntigravityAcpModelSelection({
        runtime,
        currentModelId: "gemini-3-pro",
        requestedModelId: "gemini-3-flash",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual(["gemini-3-flash"]);
      expect(result).toBe("gemini-3-flash");
    }),
  );

  it.effect("skips set_model when requested matches current", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyAntigravityAcpModelSelection({
        runtime,
        currentModelId: "gemini-3-pro",
        requestedModelId: "gemini-3-pro",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toBe("gemini-3-pro");
    }),
  );

  it.effect("skips set_model when no model is requested", () =>
    Effect.gen(function* () {
      const { runtime, modelCalls } = makeRecordingRuntime();
      const result = yield* applyAntigravityAcpModelSelection({
        runtime,
        currentModelId: "gemini-3-pro",
        requestedModelId: undefined,
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toBe("gemini-3-pro");
    }),
  );

  it.effect("propagates session/set_model failures via mapError", () =>
    Effect.gen(function* () {
      const failure = EffectAcpErrors.AcpRequestError.invalidParams("session id not known");
      const { runtime } = makeRecordingRuntime(failure);
      const error = yield* Effect.flip(
        applyAntigravityAcpModelSelection({
          runtime,
          currentModelId: "gemini-3-pro",
          requestedModelId: "gemini-3-flash",
          mapError: (cause) => cause.message,
        }),
      );
      expect(error).toBe(failure.message);
    }),
  );
});
