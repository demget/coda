/**
 * Kimi Code CLI ACP support.
 *
 * Kimi Code speaks Agent Client Protocol over stdio (`kimi acp`), so the
 * generic {@link AcpSessionRuntime} does all the transport work. What is
 * specific to Kimi lives here:
 *
 *   - the spawn shape (`kimi acp`),
 *   - the auth method id it advertises (`login`), and
 *   - model id normalization.
 *
 * Kimi exposes its model list as an ACP **session config option**
 * (`category: "model"`), the same way Cursor does, rather than through the
 * `models` field on the session-setup response that Grok uses. That means
 * model switching goes through `session/set_config_option` — the runtime's
 * `setModel`, not `setSessionModel`.
 *
 * @module provider/acp/KimiAcpSupport
 */
import { type KimiSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import { normalizeModelSlug } from "@t3tools/shared/model";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

const KIMI_DRIVER_KIND = ProviderDriverKind.make("kimi");

/**
 * Fallback model id. Kimi reports fully-qualified `<provider>/<model>` ids,
 * and K3 is the default `kimi-code` alias ships with.
 */
export const KIMI_DEFAULT_MODEL_ID = "kimi-code/k3";

/**
 * The single auth method Kimi advertises. It is a `terminal`-type method, so
 * `authenticate` is a no-op when credentials are already cached (the usual
 * case — the user logs in once via `kimi login`) and never blocks on a device
 * code flow from inside the ACP session.
 */
const KIMI_AUTH_METHOD_ID = "login";
const KIMI_FORCE_KILL_AFTER = "2 seconds";

type KimiAcpRuntimeKimiSettings = Pick<KimiSettings, "binaryPath">;

export interface KimiAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly kimiSettings: KimiAcpRuntimeKimiSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export function buildKimiAcpSpawnInput(
  kimiSettings: KimiAcpRuntimeKimiSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: kimiSettings?.binaryPath || "kimi",
    args: ["acp"],
    cwd,
    forceKillAfter: KIMI_FORCE_KILL_AFTER,
    ...(environment ? { env: environment } : {}),
  };
}

export const makeKimiAcpRuntime = (
  input: KimiAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildKimiAcpSpawnInput(input.kimiSettings, input.cwd, input.environment),
        authMethodId: KIMI_AUTH_METHOD_ID,
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

/**
 * Resolve a user- or thread-supplied model value to the id Kimi expects,
 * expanding the bare-name aliases registered in contracts (`k3` →
 * `kimi-code/k3`) and falling back to the default when nothing usable is set.
 */
export function resolveKimiAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  const base = trimmed && trimmed.length > 0 ? trimmed : KIMI_DEFAULT_MODEL_ID;
  return normalizeModelSlug(base, KIMI_DRIVER_KIND) ?? KIMI_DEFAULT_MODEL_ID;
}

interface KimiAcpModelSelectionRuntime {
  readonly setModel: (model: string) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
}

export function applyKimiAcpModelSelection<E>(input: {
  readonly runtime: KimiAcpModelSelectionRuntime;
  readonly model: string | null | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<void, E> {
  return input.runtime
    .setModel(resolveKimiAcpBaseModelId(input.model))
    .pipe(Effect.mapError(input.mapError), Effect.asVoid);
}
