// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { KimiSettings, ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { makeKimiAdapter } from "./KimiAdapter.ts";

const decodeKimiSettings = Schema.decodeSync(KimiSettings);
const currentDirectory = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(currentDirectory, "../../../scripts/acp-mock-agent.ts");

async function makeMockAgentWrapper() {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kimi-acp-mock-"));
  const wrapperPath = NodePath.join(directory, "kimi");
  const script = `#!/bin/sh
exec node ${JSON.stringify(mockAgentPath)} "$@"
`;
  await NodeFSP.writeFile(wrapperPath, script, "utf8");
  await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

const kimiAdapterTestLayer = it.layer(
  ServerConfig.layerTest(process.cwd(), { prefix: "coda-kimi-adapter-test-" }).pipe(
    Layer.provideMerge(NodeServices.layer),
  ),
);

kimiAdapterTestLayer("KimiAdapterLive", (it) => {
  it.effect("starts a Kimi ACP session and maps prompt flow to runtime events", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const wrapperPath = yield* Effect.promise(makeMockAgentWrapper);
        const adapter = yield* makeKimiAdapter(decodeKimiSettings({ binaryPath: wrapperPath }));
        const threadId = ThreadId.make("kimi-mock-thread");

        const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 9).pipe(
          Stream.runCollect,
          Effect.forkChild,
        );

        const session = yield* adapter.startSession({
          threadId,
          provider: ProviderDriverKind.make("kimi"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          modelSelection: {
            instanceId: ProviderInstanceId.make("kimi"),
            model: "default",
          },
        });

        assert.equal(session.provider, "kimi");
        assert.equal(session.model, "default");
        assert.deepStrictEqual(session.resumeCursor, {
          schemaVersion: 1,
          sessionId: "mock-session-1",
        });

        yield* adapter.sendTurn({
          threadId,
          input: "hello from Kimi",
          attachments: [],
        });

        const eventTypes = Array.from(yield* Fiber.join(runtimeEventsFiber), (event) => event.type);
        for (const eventType of [
          "session.started",
          "session.state.changed",
          "thread.started",
          "turn.started",
          "turn.plan.updated",
          "item.started",
          "content.delta",
          "item.completed",
          "turn.completed",
        ] as const) {
          assert.include(eventTypes, eventType);
        }

        yield* adapter.stopSession(threadId);
      }),
    ),
  );

  it.effect("rejects a mismatched provider", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const wrapperPath = yield* Effect.promise(makeMockAgentWrapper);
        const adapter = yield* makeKimiAdapter(decodeKimiSettings({ binaryPath: wrapperPath }));
        const error = yield* Effect.flip(
          adapter.startSession({
            threadId: ThreadId.make("kimi-provider-mismatch"),
            provider: ProviderDriverKind.make("cursor"),
            cwd: process.cwd(),
            runtimeMode: "full-access",
          }),
        );

        assert.equal(error._tag, "ProviderAdapterValidationError");
      }),
    ),
  );
});
