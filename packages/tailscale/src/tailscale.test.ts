import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  buildTailscaleHttpsBaseUrl,
  disableTailscaleServe,
  ensureTailscaleServe,
  isTailscaleIpv4Address,
  parseTailscaleMagicDnsName,
  parseTailscaleStatus,
  readTailscaleStatus,
  TAILSCALE_STATUS_TIMEOUT,
  TailscaleCommandExitError,
  TailscaleCommandSpawnError,
  TailscaleCommandTimeoutError,
  TailscaleLocalApiError,
  TailscaleStatusParseError,
} from "./tailscale.ts";

const encoder = new TextEncoder();

/**
 * Asserts nothing reachable from `error` contains `secret`. Recurses through
 * nested objects, arrays, and `cause` chains rather than checking only
 * top-level strings: a leak one level down (say, a wrapped cause carrying raw
 * stderr) is just as visible in a log, and a shallow check would pass it.
 *
 * Walks values instead of serializing so it holds for fields added later, and
 * tracks visited objects so a cyclic cause chain terminates.
 */
function assertCarriesNoSecret(error: object, secret: string): void {
  const seen = new WeakSet<object>();

  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      assert.notInclude(value, secret, `${path} leaked stderr`);
      return;
    }
    if (typeof value !== "object" || value === null || seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${String(index)}]`));
      return;
    }
    // `message` and `cause` are getters on Error subclasses, so they are not
    // own enumerable properties and Object.entries alone would skip them.
    walk((value as { message?: unknown }).message, `${path}.message`);
    walk((value as { cause?: unknown }).cause, `${path}.cause`);
    for (const [key, nested] of Object.entries(value)) {
      walk(nested, `${path}.${key}`);
    }
  };

  walk(error, "error");
}
const tailscaleStatusJson = `{"Self":{"DNSName":"desktop.tail.ts.net.","TailscaleIPs":["100.100.100.100","fd7a:115c:a1e0::1","192.168.1.20"]}}`;
const tailscaleStatusWithSingleIpJson = `{"Self":{"DNSName":"desktop.tail.ts.net.","TailscaleIPs":["100.90.1.2"]}}`;

function mockHandle(result: { stdout?: string; stderr?: string; code?: number }) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout ?? "")),
    stderr: Stream.make(encoder.encode(result.stderr ?? "")),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function neverFinishingMockHandle() {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.never,
    isRunning: Effect.succeed(true),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function mockSpawnerLayer(
  handler: (
    command: string,
    args: ReadonlyArray<string>,
  ) => { stdout?: string; stderr?: string; code?: number },
) {
  return cliTestLayer(
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) => {
        const childProcess = command as unknown as {
          readonly command: string;
          readonly args: ReadonlyArray<string>;
        };
        return Effect.succeed(mockHandle(handler(childProcess.command, childProcess.args)));
      }),
    ),
  );
}

const cliTestLayer = <E, R>(
  spawnerLayer: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner, E, R>,
) =>
  Layer.mergeAll(
    spawnerLayer,
    Layer.succeed(HostProcessPlatform, "linux"),
    Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({})),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die("unexpected Tailscale local API request")),
    ),
  );

const localApiToken = "local-api-test-token";

function macosTestLayer(
  handler: (request: HttpClientRequest.HttpClientRequest) => Response,
  options: {
    readonly fileSystem?: FileSystem.FileSystem;
    readonly spawn?: (
      command: string,
      args: ReadonlyArray<string>,
    ) => ReturnType<typeof mockHandle>;
  } = {},
) {
  const fileSystem =
    options.fileSystem ??
    FileSystem.makeNoop({
      readLink: (path) =>
        Effect.sync(() => {
          assert.equal(path, "/Library/Tailscale/ipnport");
          return "59085";
        }),
      readFileString: (path) =>
        Effect.sync(() => {
          assert.equal(path, "/Library/Tailscale/sameuserproof-59085");
          return localApiToken;
        }),
    });

  return Layer.mergeAll(
    Layer.succeed(HostProcessPlatform, "darwin"),
    Layer.succeed(FileSystem.FileSystem, fileSystem),
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) => {
        const childProcess = command as unknown as {
          readonly command: string;
          readonly args: ReadonlyArray<string>;
        };
        return options.spawn
          ? Effect.succeed(options.spawn(childProcess.command, childProcess.args))
          : Effect.die(`unexpected process spawn: ${childProcess.command}`);
      }),
    ),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => HttpClientResponse.fromWeb(request, handler(request))),
      ),
    ),
  );
}

function requestJsonBody(
  request: HttpClientRequest.HttpClientRequest,
): Readonly<Record<string, unknown>> {
  assert.equal(request.body._tag, "Uint8Array");
  if (request.body._tag !== "Uint8Array") {
    return {};
  }
  return JSON.parse(new TextDecoder().decode(request.body.body)) as Readonly<
    Record<string, unknown>
  >;
}

describe("tailscale", () => {
  it.effect("detects Tailnet IPv4 addresses", () =>
    Effect.sync(() => {
      assert.equal(isTailscaleIpv4Address("100.64.0.1"), true);
      assert.equal(isTailscaleIpv4Address("100.127.255.254"), true);
      assert.equal(isTailscaleIpv4Address("100.128.0.1"), false);
      assert.equal(isTailscaleIpv4Address("192.168.1.44"), false);
    }),
  );

  it.effect("parses MagicDNS names from tailscale status", () =>
    Effect.gen(function* () {
      const dnsName = yield* parseTailscaleMagicDnsName(tailscaleStatusJson);
      assert.equal(dnsName, "desktop.tail.ts.net");
      assert.equal(yield* parseTailscaleMagicDnsName("{}"), null);
    }),
  );

  it.effect("parses status facts", () =>
    Effect.gen(function* () {
      const status = yield* parseTailscaleStatus(tailscaleStatusJson);
      assert.deepEqual(status, {
        magicDnsName: "desktop.tail.ts.net",
        tailnetIpv4Addresses: ["100.100.100.100"],
      });
    }),
  );

  it.effect("preserves status decoding failures without exposing cause text", () =>
    Effect.gen(function* () {
      const error = yield* parseTailscaleStatus("{not-json").pipe(Effect.flip);

      assert.instanceOf(error, TailscaleStatusParseError);
      assert.equal(error.message, "Failed to decode tailscale status JSON.");
      assert.isDefined(error.cause);
      assert.notInclude(error.message, String(error.cause));
    }),
  );

  it.effect("builds clean HTTPS base URLs", () =>
    Effect.sync(() => {
      assert.equal(
        buildTailscaleHttpsBaseUrl({ magicDnsName: "desktop.tail.ts.net" }),
        "https://desktop.tail.ts.net/",
      );
      assert.equal(
        buildTailscaleHttpsBaseUrl({ magicDnsName: "desktop.tail.ts.net", servePort: 8443 }),
        "https://desktop.tail.ts.net:8443/",
      );
    }),
  );

  it.effect("reads tailscale status through the process spawner service", () => {
    const layer = mockSpawnerLayer((command, args) => {
      assert.equal(command, "tailscale");
      assert.deepEqual(args, ["status", "--json"]);
      return {
        stdout: tailscaleStatusWithSingleIpJson,
      };
    });

    return Effect.gen(function* () {
      const status = yield* readTailscaleStatus.pipe(Effect.provide(layer));
      assert.deepEqual(status, {
        magicDnsName: "desktop.tail.ts.net",
        tailnetIpv4Addresses: ["100.90.1.2"],
      });
    });
  });

  it.effect("reads macOS status through the local API without starting Tailscale.app", () => {
    const layer = macosTestLayer((request) => {
      assert.equal(request.method, "GET");
      assert.equal(request.url, "http://127.0.0.1:59085/localapi/v0/status?peers=false");
      assert.equal(
        request.headers.authorization,
        `Basic ${Buffer.from(`:${localApiToken}`).toString("base64")}`,
      );
      return new Response(tailscaleStatusWithSingleIpJson);
    });

    return Effect.gen(function* () {
      const status = yield* readTailscaleStatus.pipe(Effect.provide(layer));
      assert.deepEqual(status, {
        magicDnsName: "desktop.tail.ts.net",
        tailnetIpv4Addresses: ["100.90.1.2"],
      });
    });
  });

  it.effect("discovers the Mac App Store local API credential through lsof", () => {
    const missingSharedDirectory = FileSystem.makeNoop({
      readLink: (path) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "NotFound",
            module: "FileSystem",
            method: "readLink",
            pathOrDescriptor: path,
          }),
        ),
    });
    const layer = macosTestLayer(
      (request) => {
        assert.equal(request.url, "http://127.0.0.1:59086/localapi/v0/status?peers=false");
        return new Response(tailscaleStatusWithSingleIpJson);
      },
      {
        fileSystem: missingSharedDirectory,
        spawn: (command, args) => {
          assert.equal(command, "/usr/sbin/lsof");
          assert.include(args, "-c");
          assert.include(args, "IPNExtension");
          return mockHandle({
            stdout:
              "p1234\nn/Users/test/Library/Containers/io.tailscale.ipn.macos/sameuserproof-59086-local-api-test-token\n",
          });
        },
      },
    );

    return readTailscaleStatus.pipe(
      Effect.tap((status) =>
        Effect.sync(() => assert.equal(status.magicDnsName, "desktop.tail.ts.net")),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("preserves tailscale spawn failures as causes", () => {
    const systemCause = new Error("private executable lookup detail");
    const cause = PlatformError.systemError({
      _tag: "NotFound",
      module: "ChildProcess",
      method: "spawn",
      cause: systemCause,
    });
    const layer = cliTestLayer(
      Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() => Effect.fail(cause)),
      ),
    );

    return Effect.gen(function* () {
      const error = yield* readTailscaleStatus.pipe(Effect.flip, Effect.provide(layer));

      assert.instanceOf(error, TailscaleCommandSpawnError);
      assert.equal(error.executable, "tailscale");
      assert.equal(error.subcommand, "status");
      assert.equal(error.argumentCount, 2);
      assert.strictEqual(error.cause, cause);
      assert.equal(error.message, "Failed to spawn tailscale status.");
      assert.notInclude(error.message, systemCause.message);
    });
  });

  it.effect("turns spawn defects into typed spawn failures", () => {
    // A non-directory entry on PATH makes node's spawn throw ENOTDIR
    // synchronously. The platform spawner calls `NodeChildProcess.spawn` from
    // inside an `Effect.callback` registration, so that throw arrives as a
    // defect rather than a typed error - the shape reproduced here.
    const defect = Object.assign(new Error("spawn tailscale ENOTDIR"), { code: "ENOTDIR" });
    const layer = cliTestLayer(
      Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() =>
          Effect.callback<never, never>(() => {
            throw defect;
          }),
        ),
      ),
    );

    return Effect.gen(function* () {
      const statusError = yield* readTailscaleStatus.pipe(Effect.flip, Effect.provide(layer));
      assert.instanceOf(statusError, TailscaleCommandSpawnError);
      assert.equal(statusError.subcommand, "status");
      assert.strictEqual(statusError.cause, defect);

      const serveError = yield* ensureTailscaleServe({ localPort: 13773, servePort: 8443 }).pipe(
        Effect.flip,
        Effect.provide(layer),
      );
      assert.instanceOf(serveError, TailscaleCommandSpawnError);
      assert.equal(serveError.subcommand, "serve");
      assert.strictEqual(serveError.cause, defect);

      // What callers actually rely on: the desktop endpoint providers recover
      // with `Effect.orElseSucceed`, which only sees the typed error channel.
      const degraded = yield* readTailscaleStatus.pipe(
        Effect.orElseSucceed(() => null),
        Effect.provide(layer),
      );
      assert.equal(degraded, null);
    });
  });

  it.effect("keeps nonzero exit diagnostics structured", () => {
    const layer = mockSpawnerLayer(() => ({
      code: 7,
      stderr: "not logged in tskey-auth-secret-token-value",
    }));

    return Effect.gen(function* () {
      const error = yield* readTailscaleStatus.pipe(Effect.flip, Effect.provide(layer));

      assert.instanceOf(error, TailscaleCommandExitError);
      assert.equal(error.executable, "tailscale");
      assert.equal(error.subcommand, "status");
      assert.equal(error.argumentCount, 2);
      assert.equal(error.exitCode, 7);
      assert.equal(error.stdoutLength, 0);
      assert.equal(error.stderrLength, 43);
      assert.notProperty(error, "command");
      assert.notProperty(error, "stderr");
      assert.notInclude(error.message, "tskey-auth-secret-token-value");
      assert.equal(error.message, "tailscale status exited with code 7.");
      assert.equal(error.stderrDiagnostic, "not-logged-in");
      assertCarriesNoSecret(error, "tskey-auth-secret-token-value");
    });
  });

  it.effect("classifies unrecognized stderr without quoting it", () => {
    const layer = mockSpawnerLayer(() => ({
      code: 3,
      stderr: "something novel went wrong for node fluffy-badger tskey-auth-secret-token-value",
    }));

    return Effect.gen(function* () {
      const error = yield* readTailscaleStatus.pipe(Effect.flip, Effect.provide(layer));

      assert.instanceOf(error, TailscaleCommandExitError);
      // Unmatched stderr degrades to "unknown" rather than passing text
      // through — that fallback is what keeps novel output from leaking.
      assert.equal(error.stderrDiagnostic, "unknown");
      assertCarriesNoSecret(error, "tskey-auth-secret-token-value");
      assertCarriesNoSecret(error, "fluffy-badger");
    });
  });

  it.effect("times out tailscale status through TestClock", () => {
    const layer = Layer.merge(
      TestClock.layer(),
      cliTestLayer(
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.succeed(neverFinishingMockHandle())),
        ),
      ),
    );

    return Effect.gen(function* () {
      const fiber = yield* readTailscaleStatus.pipe(Effect.flip, Effect.forkScoped);
      yield* Effect.yieldNow;
      yield* TestClock.adjust(TAILSCALE_STATUS_TIMEOUT);
      const error = yield* Fiber.join(fiber);

      assert.instanceOf(error, TailscaleCommandTimeoutError);
      assert.equal(error.executable, "tailscale");
      assert.equal(error.subcommand, "status");
      assert.equal(error.argumentCount, 2);
      assert.equal(error.timeoutMs, 1_500);
      assert.isTrue(Cause.isTimeoutError(error.cause));
      assert.equal(error.message, "tailscale status timed out after 1500ms.");
    }).pipe(Effect.provide(layer));
  });

  it.effect("configures tailscale serve through the process spawner service", () => {
    const layer = mockSpawnerLayer((command, args) => {
      assert.equal(command, "tailscale");
      assert.deepEqual(args, ["serve", "--bg", "--https=8443", "http://127.0.0.1:13773"]);
      return {};
    });

    return ensureTailscaleServe({ localPort: 13773, servePort: 8443 }).pipe(Effect.provide(layer));
  });

  it.effect("configures macOS Serve through the local API and preserves unrelated mappings", () => {
    const initialConfig = {
      TCP: { "22": { TCPForward: "127.0.0.1:22" } },
      Web: {
        "other.tail.ts.net:443": {
          Handlers: { "/docs": { Proxy: "http://127.0.0.1:9000" } },
        },
      },
      AllowFunnel: { "other.tail.ts.net:443": true },
      Services: { "svc:test": { TCP: 5432 } },
    };
    let postedConfig: Readonly<Record<string, unknown>> | undefined;
    const layer = macosTestLayer((request) => {
      if (request.url.endsWith("/status?peers=false")) {
        return new Response(tailscaleStatusJson);
      }
      if (request.method === "GET") {
        return new Response(JSON.stringify(initialConfig), { headers: { ETag: "revision-1" } });
      }
      assert.equal(request.method, "POST");
      assert.equal(request.headers["if-match"], "revision-1");
      postedConfig = requestJsonBody(request);
      return new Response(null, { status: 200 });
    });

    return Effect.gen(function* () {
      yield* ensureTailscaleServe({ localPort: 13773, servePort: 8443 }).pipe(
        Effect.provide(layer),
      );
      assert.deepEqual(postedConfig, {
        ...initialConfig,
        TCP: {
          ...initialConfig.TCP,
          "8443": { HTTPS: true },
        },
        Web: {
          ...initialConfig.Web,
          "desktop.tail.ts.net:8443": {
            Handlers: { "/": { Proxy: "http://127.0.0.1:13773" } },
          },
        },
      });
    });
  });

  it.effect("retains tailscale serve exit diagnostics", () => {
    const layer = mockSpawnerLayer(() => ({
      code: 1,
      stderr: "serve permission denied tskey-auth-secret-token-value",
    }));

    return Effect.gen(function* () {
      const error = yield* ensureTailscaleServe({ localPort: 13773, servePort: 8443 }).pipe(
        Effect.flip,
        Effect.provide(layer),
      );

      assert.instanceOf(error, TailscaleCommandExitError);
      assert.equal(error.executable, "tailscale");
      assert.equal(error.subcommand, "serve");
      assert.equal(error.argumentCount, 4);
      assert.equal(error.exitCode, 1);
      assert.equal(error.stderrLength, 53);
      assert.notProperty(error, "command");
      assert.notProperty(error, "stderr");
      assert.notInclude(error.message, "tskey-auth-secret-token-value");
      // The diagnostic classifies the failure without quoting stderr, so the
      // key cannot reach a log through it either.
      assert.equal(error.stderrDiagnostic, "permission-denied");
      assertCarriesNoSecret(error, "tskey-auth-secret-token-value");
    });
  });

  it.effect("disables tailscale serve through the process spawner service", () => {
    const commands: {
      readonly command: string;
      readonly args: ReadonlyArray<string>;
    }[] = [];
    const layer = mockSpawnerLayer((command, args) => {
      commands.push({ command, args });
      assert.equal(command, "tailscale");
      assert.deepEqual(args, ["serve", "--https=8443", "off"]);
      return {};
    });

    return Effect.gen(function* () {
      yield* disableTailscaleServe({ servePort: 8443 }).pipe(Effect.provide(layer));
      assert.deepEqual(commands, [
        { command: "tailscale", args: ["serve", "--https=8443", "off"] },
      ]);
    });
  });

  it.effect("disables only the target macOS Serve mapping through the local API", () => {
    const initialConfig = {
      TCP: {
        "22": { TCPForward: "127.0.0.1:22" },
        "8443": { HTTPS: true },
      },
      Web: {
        "desktop.tail.ts.net:8443": {
          Handlers: { "/": { Proxy: "http://127.0.0.1:13773" } },
        },
        "other.tail.ts.net:443": {
          Handlers: { "/docs": { Proxy: "http://127.0.0.1:9000" } },
        },
      },
      AllowFunnel: {
        "desktop.tail.ts.net:8443": true,
        "other.tail.ts.net:443": true,
      },
      Services: { "svc:test": { TCP: 5432 } },
    };
    let postedConfig: Readonly<Record<string, unknown>> | undefined;
    const layer = macosTestLayer((request) => {
      if (request.url.endsWith("/status?peers=false")) {
        return new Response(tailscaleStatusJson);
      }
      if (request.method === "GET") {
        return new Response(JSON.stringify(initialConfig), { headers: { ETag: "revision-2" } });
      }
      assert.equal(request.headers["if-match"], "revision-2");
      postedConfig = requestJsonBody(request);
      return new Response(null, { status: 200 });
    });

    return Effect.gen(function* () {
      yield* disableTailscaleServe({ servePort: 8443 }).pipe(Effect.provide(layer));
      assert.deepEqual(postedConfig, {
        TCP: { "22": { TCPForward: "127.0.0.1:22" } },
        Web: {
          "other.tail.ts.net:443": {
            Handlers: { "/docs": { Proxy: "http://127.0.0.1:9000" } },
          },
        },
        AllowFunnel: { "other.tail.ts.net:443": true },
        Services: initialConfig.Services,
      });
    });
  });

  it.effect("keeps macOS local API credentials out of update failures", () => {
    const layer = macosTestLayer((request) => {
      if (request.url.endsWith("/status?peers=false")) {
        return new Response(tailscaleStatusJson);
      }
      if (request.method === "GET") {
        return new Response("null", { headers: { ETag: "revision-3" } });
      }
      return new Response(null, { status: 412 });
    });

    return Effect.gen(function* () {
      const error = yield* ensureTailscaleServe({ localPort: 13773 }).pipe(
        Effect.flip,
        Effect.provide(layer),
      );
      assert.instanceOf(error, TailscaleLocalApiError);
      assert.equal(error.reason, "concurrent-update");
      assertCarriesNoSecret(error, localApiToken);
    });
  });
});
