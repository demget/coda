/**
 * Google Antigravity ACP support.
 *
 * Google ships `agy_acp_server`, an Agent Client Protocol server over stdio,
 * so the generic {@link AcpSessionRuntime} does the transport work. What is
 * specific to Antigravity lives here:
 *
 *   - the spawn shape (the bare binary, no arguments),
 *   - the auth method to select (`gemini-api-key` when an API key is in the
 *     environment, otherwise the Google account login), and
 *   - model id normalization.
 *
 * The server refuses `session/new` until `authenticate` has been called or an
 * `auth.type` is recorded in its own settings file, so the runtime always
 * sends `authenticate`. With cached credentials that call returns at once;
 * without them the server opens a browser login flow.
 *
 * Models arrive on the session-setup response as `models.availableModels`,
 * so switching goes through `session/set_model` (the runtime's
 * `setSessionModel`).
 *
 * @module provider/acp/AntigravityAcpSupport
 */
import { type AntigravitySettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { normalizeModelSlug } from "@t3tools/shared/model";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

const ANTIGRAVITY_DRIVER_KIND = ProviderDriverKind.make("antigravity");
const ANTIGRAVITY_DEFAULT_BINARY = "agy_acp_server";

/** The model the server selects for a fresh session when nothing is requested. */
export const ANTIGRAVITY_DEFAULT_MODEL_ID = "gemini-3.7-flash-high";

const GEMINI_API_KEY_ENV = "GEMINI_API_KEY";
const ANTIGRAVITY_AUTH_METHOD_API_KEY = "gemini-api-key";
const ANTIGRAVITY_AUTH_METHOD_GOOGLE_ACCOUNT = "oauth-personal";

/**
 * Pick the ACP auth method for this environment. A `GEMINI_API_KEY` selects
 * the Gemini Developer API; otherwise the server uses the Google account
 * login it shares with the Antigravity CLI and IDE extensions.
 */
export function resolveAntigravityAuthMethodId(environment: NodeJS.ProcessEnv | undefined): string {
  return environment?.[GEMINI_API_KEY_ENV]?.trim()
    ? ANTIGRAVITY_AUTH_METHOD_API_KEY
    : ANTIGRAVITY_AUTH_METHOD_GOOGLE_ACCOUNT;
}

type AntigravityAcpRuntimeAntigravitySettings = Pick<AntigravitySettings, "binaryPath">;

interface AntigravityAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "spawn"
> {
  readonly antigravitySettings: AntigravityAcpRuntimeAntigravitySettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export function buildAntigravityAcpSpawnInput(
  antigravitySettings: AntigravityAcpRuntimeAntigravitySettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: antigravitySettings?.binaryPath?.trim() || ANTIGRAVITY_DEFAULT_BINARY,
    args: [],
    cwd,
    env: { ...environment },
  };
}

export const makeAntigravityAcpRuntime = (
  input: AntigravityAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildAntigravityAcpSpawnInput(
          input.antigravitySettings,
          input.cwd,
          input.environment,
        ),
        authMethodId: resolveAntigravityAuthMethodId(input.environment),
      }).pipe(
        Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner)),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

/**
 * Resolve a user- or thread-supplied model value to the id the server
 * expects, expanding the aliases registered in contracts and falling back to
 * the server default when nothing usable is set.
 */
export function resolveAntigravityAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  const base = trimmed && trimmed.length > 0 ? trimmed : ANTIGRAVITY_DEFAULT_MODEL_ID;
  return normalizeModelSlug(base, ANTIGRAVITY_DRIVER_KIND) ?? ANTIGRAVITY_DEFAULT_MODEL_ID;
}

export function currentAntigravityModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return sessionSetupResult.models?.currentModelId?.trim() || undefined;
}

export function applyAntigravityAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setSessionModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  const shouldSwitchModel =
    input.requestedModelId !== undefined && input.requestedModelId !== input.currentModelId;
  if (!shouldSwitchModel) {
    return Effect.succeed(input.currentModelId);
  }
  return input.runtime
    .setSessionModel(input.requestedModelId)
    .pipe(Effect.mapError(input.mapError), Effect.as(input.requestedModelId));
}
