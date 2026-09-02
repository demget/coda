import {
  type AntigravitySettings,
  type ModelCapabilities,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";
import { causeErrorTag } from "@t3tools/shared/observability";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";
import {
  ANTIGRAVITY_DEFAULT_MODEL_ID,
  makeAntigravityAcpRuntime,
  resolveAntigravityAcpBaseModelId,
} from "../acp/AntigravityAcpSupport.ts";

const ANTIGRAVITY_PRESENTATION = {
  displayName: "Antigravity",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: true,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const VERSION_PROBE_TIMEOUT_MS = 4_000;
const ANTIGRAVITY_ACP_MODEL_DISCOVERY_TIMEOUT_MS = 15_000;

/**
 * Fallback list used until the ACP server has been probed, or when the probe
 * fails. The live list comes from `session/new` and replaces this one. Ids
 * and names mirror what `agy_acp_server` advertised on 2026-09-02.
 */
const ANTIGRAVITY_MODEL_CATALOG: ReadonlyArray<readonly [slug: string, name: string]> = [
  ["gemini-3.8-flash-high", "Gemini 3.8 Flash (High)"],
  ["gemini-3.8-flash-medium", "Gemini 3.8 Flash (Medium)"],
  ["gemini-3.8-flash-low", "Gemini 3.8 Flash (Low)"],
  [ANTIGRAVITY_DEFAULT_MODEL_ID, "Gemini 3.7 Flash (High)"],
  ["gemini-3.7-flash-medium", "Gemini 3.7 Flash (Medium)"],
  ["gemini-3.7-flash-low", "Gemini 3.7 Flash (Low)"],
  ["gemini-3.6-flash-high", "Gemini 3.6 Flash (High)"],
  ["gemini-3.6-flash-medium", "Gemini 3.6 Flash (Medium)"],
  ["gemini-3.6-flash-low", "Gemini 3.6 Flash (Low)"],
  ["gemini-pro-agent", "Gemini 3.1 Pro (High)"],
  ["gemini-3.1-pro-low", "Gemini 3.1 Pro (Low)"],
];
const ANTIGRAVITY_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> =
  ANTIGRAVITY_MODEL_CATALOG.map(([slug, name]) => ({
    slug,
    name,
    isCustom: false,
    capabilities: EMPTY_CAPABILITIES,
  }));

export function buildInitialAntigravityProviderSnapshot(
  antigravitySettings: AntigravitySettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = antigravityModelsFromSettings(antigravitySettings.customModels);

    if (!antigravitySettings.enabled) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Antigravity is disabled in Coda settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: ANTIGRAVITY_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Antigravity ACP server availability...",
      },
    });
  });
}

function antigravityModelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  builtInModels: ReadonlyArray<ServerProviderModel> = ANTIGRAVITY_BUILT_IN_MODELS,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(builtInModels, customModels ?? [], EMPTY_CAPABILITIES);
}

function buildAntigravityDiscoveredModelsFromSessionModelState(
  modelState: EffectAcpSchema.SessionModelState | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  if (!modelState || modelState.availableModels.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  return modelState.availableModels
    .map((model): ServerProviderModel | undefined => {
      const slug = resolveAntigravityAcpBaseModelId(model.modelId);
      if (!slug || seen.has(slug)) {
        return undefined;
      }
      seen.add(slug);
      return {
        slug,
        name: model.name.trim() || slug,
        isCustom: false,
        capabilities: EMPTY_CAPABILITIES,
      };
    })
    .filter((model): model is ServerProviderModel => model !== undefined);
}

/**
 * One ACP session against the server: the `initialize` response carries the
 * server build id (its `--version` output has no parseable version), and the
 * session-setup response carries every model the account can use.
 */
const discoverAntigravityViaAcp = (
  antigravitySettings: AntigravitySettings,
  environment: NodeJS.ProcessEnv = process.env,
) =>
  Effect.gen(function* () {
    const acp = yield* makeAntigravityAcpRuntime({
      antigravitySettings,
      environment,
      cwd: process.cwd(),
      clientInfo: { name: "coda-provider-probe", version: "0.0.0" },
    });
    const started = yield* acp.start();
    return {
      version: started.initializeResult.agentInfo?.version?.trim() || null,
      models: buildAntigravityDiscoveredModelsFromSessionModelState(
        started.sessionSetupResult.models,
      ),
    };
  }).pipe(Effect.scoped);

const runAntigravityVersionCommand = (
  antigravitySettings: AntigravitySettings,
  environment: NodeJS.ProcessEnv = process.env,
) =>
  Effect.gen(function* () {
    const command = antigravitySettings.binaryPath?.trim() || "agy_acp_server";
    const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], {
      env: environment,
    });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  });

export const checkAntigravityProviderStatus = Effect.fn("checkAntigravityProviderStatus")(
  function* (
    antigravitySettings: AntigravitySettings,
    environment: NodeJS.ProcessEnv = process.env,
  ): Effect.fn.Return<
    ServerProviderDraft,
    never,
    ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
  > {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const fallbackModels = antigravityModelsFromSettings(antigravitySettings.customModels);

    if (!antigravitySettings.enabled) {
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: false,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Antigravity is disabled in Coda settings.",
        },
      });
    }

    // The ACP server binary may not implement `--version`; a non-zero exit or
    // unparseable output is tolerated and only the command-missing case is
    // treated as "not installed".
    const versionResult = yield* runAntigravityVersionCommand(
      antigravitySettings,
      environment,
    ).pipe(Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS), Effect.result);

    let version: string | null = null;
    if (Result.isFailure(versionResult)) {
      const error = versionResult.failure;
      if (isCommandMissingCause(error)) {
        return buildServerProvider({
          presentation: ANTIGRAVITY_PRESENTATION,
          enabled: antigravitySettings.enabled,
          checkedAt,
          models: fallbackModels,
          probe: {
            installed: false,
            version: null,
            status: "error",
            auth: { status: "unknown" },
            message: "Antigravity ACP server (`agy_acp_server`) is not installed or not on PATH.",
          },
        });
      }
      yield* Effect.logWarning("Antigravity version probe failed.", {
        errorTag: error._tag,
      });
    } else if (Option.isSome(versionResult.success)) {
      const versionOutput = versionResult.success.value;
      version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
    }

    const discoveryExit = yield* discoverAntigravityViaAcp(antigravitySettings, environment).pipe(
      Effect.timeoutOption(ANTIGRAVITY_ACP_MODEL_DISCOVERY_TIMEOUT_MS),
      Effect.exit,
    );
    if (Exit.isFailure(discoveryExit)) {
      yield* Effect.logWarning("Antigravity ACP model discovery failed", {
        errorTag: causeErrorTag(discoveryExit.cause),
      });
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: antigravitySettings.enabled,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version,
          status: "error",
          auth: { status: "unknown" },
          message:
            "Antigravity ACP server is installed but ACP startup failed. Check server logs for details.",
        },
      });
    }
    if (Option.isNone(discoveryExit.value)) {
      yield* Effect.logWarning(
        `Antigravity ACP model discovery timed out after ${ANTIGRAVITY_ACP_MODEL_DISCOVERY_TIMEOUT_MS}ms.`,
      );
      return buildServerProvider({
        presentation: ANTIGRAVITY_PRESENTATION,
        enabled: antigravitySettings.enabled,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version,
          status: "error",
          auth: { status: "unknown" },
          message: `Antigravity ACP server is installed but ACP startup timed out after ${ANTIGRAVITY_ACP_MODEL_DISCOVERY_TIMEOUT_MS}ms.`,
        },
      });
    }
    const discovered = discoveryExit.value.value;
    const models =
      discovered.models.length > 0
        ? antigravityModelsFromSettings(antigravitySettings.customModels, discovered.models)
        : fallbackModels;

    return buildServerProvider({
      presentation: ANTIGRAVITY_PRESENTATION,
      enabled: antigravitySettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: discovered.version ?? version,
        status: "ready",
        auth: { status: "unknown" },
      },
    });
  },
);

export const enrichAntigravitySnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly enableProviderUpdateChecks?: boolean;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<void> => {
  const { snapshot, publishSnapshot } = input;

  return enrichProviderSnapshotWithVersionAdvisory(snapshot, input.maintenanceCapabilities, {
    enableProviderUpdateChecks: input.enableProviderUpdateChecks,
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, input.httpClient),
    Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
    Effect.catchCause((cause) =>
      Effect.logWarning("Antigravity version advisory enrichment failed", {
        errorTag: causeErrorTag(cause),
      }),
    ),
    Effect.asVoid,
  );
};
