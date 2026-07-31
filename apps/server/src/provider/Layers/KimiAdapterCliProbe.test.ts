/**
 * Optional integration check against a real `kimi acp` install.
 * Enable with: T3_KIMI_ACP_PROBE=1 vp test run KimiAdapterCliProbe
 *
 * The probe uses the user's existing Kimi authentication and consumes a
 * small amount of provider usage.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { KimiSettings, ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { makeKimiAdapter } from "./KimiAdapter.ts";

const decodeKimiSettings = Schema.decodeSync(KimiSettings);
const threadId = ThreadId.make("kimi-real-acp-probe");

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "coda-kimi-real-acp-probe-",
}).pipe(Layer.provideMerge(NodeServices.layer));

it.live.skipIf(process.env.T3_KIMI_ACP_PROBE !== "1")(
  "completes a real turn through KimiAdapter and emits canonical runtime events",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Console.log("[kimi-probe] constructing adapter");
        const adapter = yield* makeKimiAdapter(
          decodeKimiSettings({
            enabled: true,
            binaryPath: process.env.KIMI_BINARY_PATH ?? "kimi",
          }),
        );
        const runtimeEventsFiber = yield* adapter.streamEvents.pipe(
          Stream.tap((event) => Console.log("[kimi-probe] runtime event", event.type)),
          Stream.filter((event) => event.threadId === threadId),
          Stream.takeUntil((event) => event.type === "turn.completed"),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;

        const result = yield* Effect.gen(function* () {
          yield* Console.log("[kimi-probe] starting session");
          const session = yield* adapter.startSession({
            threadId,
            provider: ProviderDriverKind.make("kimi"),
            cwd: process.cwd(),
            runtimeMode: "full-access",
            modelSelection: {
              instanceId: ProviderInstanceId.make("kimi"),
              model: "kimi-code/k3",
            },
          });

          assert.equal(session.provider, "kimi");
          assert.equal(session.model, "kimi-code/k3");
          assert.isTrue(Predicate.isObject(session.resumeCursor));
          const sessionId = Predicate.isObject(session.resumeCursor)
            ? session.resumeCursor.sessionId
            : undefined;
          assert.equal(typeof sessionId, "string");

          yield* Console.log("[kimi-probe] session started", sessionId);
          yield* Console.log("[kimi-probe] sending turn");
          const turn = yield* adapter.sendTurn({
            threadId,
            input: "Reply with exactly CODA_KIMI_SMOKE_OK and nothing else. Do not use tools.",
            attachments: [],
          });
          yield* Console.log("[kimi-probe] turn settled", turn.turnId);
          const events = Array.from(yield* Fiber.join(runtimeEventsFiber));
          const responseText = events
            .filter((event) => event.type === "content.delta")
            .map((event) => event.payload.delta)
            .join("");
          const completed = events.find((event) => event.type === "turn.completed");

          yield* Console.log("[kimi-probe] collected response", responseText);

          assert.include(responseText, "CODA_KIMI_SMOKE_OK");
          assert.equal(completed?.type, "turn.completed");
          if (completed?.type === "turn.completed") {
            assert.equal(completed.turnId, turn.turnId);
            assert.equal(completed.payload.state, "completed");
          }

          return { responseText, eventTypes: events.map((event) => event.type) };
        }).pipe(
          Effect.ensuring(
            Console.log("[kimi-probe] stopping session").pipe(
              Effect.andThen(adapter.stopSession(threadId).pipe(Effect.ignore)),
              Effect.andThen(Console.log("[kimi-probe] session stopped")),
            ),
          ),
        );

        yield* Effect.logInfo("Kimi real ACP probe completed", result);
      }),
    ).pipe(Effect.provide(testLayer)),
  40_000,
);
