import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export const DEFAULT_TAILSCALE_SERVE_PORT = 443;
export const TAILSCALE_STATUS_TIMEOUT = Duration.millis(1_500);
export const TAILSCALE_SERVE_TIMEOUT = Duration.seconds(10);
export const TAILSCALE_PROBE_TIMEOUT = Duration.millis(2_500);

const MACOS_TAILSCALE_SHARED_DIRECTORY = "/Library/Tailscale";
const MACOS_TAILSCALE_APP_STORE_LSOF = "/usr/sbin/lsof";
const MACOS_TAILSCALE_LOCAL_API_PATH = "/localapi/v0";

// tailscale is a real executable everywhere (`tailscale.exe` on Windows), so
// it is always spawned directly rather than through cmd.exe shell mode.
const tailscaleCommandForPlatform = (platform: NodeJS.Platform): "tailscale" | "tailscale.exe" =>
  platform === "win32" ? "tailscale.exe" : "tailscale";

const TailscaleCommandContext = {
  executable: Schema.Literals(["tailscale", "tailscale.exe"]),
  subcommand: Schema.Literals(["status", "serve"]),
  argumentCount: Schema.Number,
};

/**
 * Failure kinds we can name without quoting the CLI. Anything unrecognized
 * becomes "unknown" rather than falling back to raw text — stderr can contain
 * auth keys (`tskey-…`) and node names, and these labels are logged.
 */
export const TailscaleStderrDiagnostic = Schema.Literals([
  "no-existing-handler",
  "not-logged-in",
  "permission-denied",
  "unknown",
]);
export type TailscaleStderrDiagnostic = typeof TailscaleStderrDiagnostic.Type;

// Matched against stderr, most specific first. Patterns are deliberately short
// and anchored on tailscale's own wording.
const STDERR_DIAGNOSTIC_PATTERNS: ReadonlyArray<
  readonly [RegExp, Exclude<TailscaleStderrDiagnostic, "unknown">]
> = [
  [/handler does not exist/i, "no-existing-handler"],
  [/not logged in|logged out|needs? login/i, "not-logged-in"],
  [/permission denied|access denied|must be root|operation not permitted/i, "permission-denied"],
];

/** Classifies stderr into a safe label, dropping the text itself. */
export const stderrDiagnosticOf = (stderr: string): TailscaleStderrDiagnostic | undefined => {
  if (stderr.trim().length === 0) {
    return undefined;
  }
  return STDERR_DIAGNOSTIC_PATTERNS.find(([pattern]) => pattern.test(stderr))?.[1] ?? "unknown";
};

export class TailscaleCommandSpawnError extends Schema.TaggedErrorClass<TailscaleCommandSpawnError>()(
  "TailscaleCommandSpawnError",
  {
    ...TailscaleCommandContext,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to spawn tailscale ${this.subcommand}.`;
  }
}

export class TailscaleCommandOutputError extends Schema.TaggedErrorClass<TailscaleCommandOutputError>()(
  "TailscaleCommandOutputError",
  {
    ...TailscaleCommandContext,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read output from tailscale ${this.subcommand}.`;
  }
}

export class TailscaleCommandExitError extends Schema.TaggedErrorClass<TailscaleCommandExitError>()(
  "TailscaleCommandExitError",
  {
    ...TailscaleCommandContext,
    exitCode: Schema.Number,
    stdoutLength: Schema.optional(Schema.Number),
    stderrLength: Schema.Number,
    // A classified diagnostic, never raw CLI output. `tailscale` prints auth
    // keys and node identifiers into stderr, and this field is surfaced in
    // dev-runner logs — so it carries only a known-safe label from the closed
    // set below. Callers that need to recognize a specific failure (e.g.
    // `serve off` on a port with no mapping) match on the label.
    stderrDiagnostic: Schema.optional(TailscaleStderrDiagnostic),
  },
) {
  override get message(): string {
    return `tailscale ${this.subcommand} exited with code ${this.exitCode}.`;
  }
}

export class TailscaleCommandTimeoutError extends Schema.TaggedErrorClass<TailscaleCommandTimeoutError>()(
  "TailscaleCommandTimeoutError",
  {
    ...TailscaleCommandContext,
    timeoutMs: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `tailscale ${this.subcommand} timed out after ${this.timeoutMs}ms.`;
  }
}

export const TailscaleCommandError = Schema.Union([
  TailscaleCommandSpawnError,
  TailscaleCommandOutputError,
  TailscaleCommandExitError,
  TailscaleCommandTimeoutError,
]);
export type TailscaleCommandError = typeof TailscaleCommandError.Type;

export const TailscaleLocalApiOperation = Schema.Literals([
  "discover",
  "status",
  "get-serve-config",
  "set-serve-config",
]);
export type TailscaleLocalApiOperation = typeof TailscaleLocalApiOperation.Type;

export const TailscaleLocalApiFailureReason = Schema.Literals([
  "credentials-unavailable",
  "request-failed",
  "unexpected-status",
  "invalid-response",
  "concurrent-update",
  "incompatible-serve-config",
]);
export type TailscaleLocalApiFailureReason = typeof TailscaleLocalApiFailureReason.Type;

export class TailscaleLocalApiError extends Schema.TaggedErrorClass<TailscaleLocalApiError>()(
  "TailscaleLocalApiError",
  {
    operation: TailscaleLocalApiOperation,
    reason: TailscaleLocalApiFailureReason,
    status: Schema.optional(Schema.Number),
  },
) {
  override get message(): string {
    return `Tailscale local API ${this.operation} failed (${this.reason}).`;
  }
}

export class TailscaleStatusParseError extends Schema.TaggedErrorClass<TailscaleStatusParseError>()(
  "TailscaleStatusParseError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to decode tailscale status JSON.";
  }
}

export const TailscaleError = Schema.Union([
  TailscaleCommandError,
  TailscaleLocalApiError,
  TailscaleStatusParseError,
]);
export type TailscaleError = typeof TailscaleError.Type;

const TailscaleStatusSelf = Schema.Struct({
  DNSName: Schema.optional(Schema.Unknown),
  TailscaleIPs: Schema.optional(Schema.Unknown),
});

const TailscaleStatusJson = Schema.Struct({
  Self: Schema.optional(TailscaleStatusSelf),
});

export type TailscaleStatusSelf = typeof TailscaleStatusSelf.Type;
export type TailscaleStatusJson = typeof TailscaleStatusJson.Type;

export interface TailscaleStatus {
  readonly magicDnsName: string | null;
  readonly tailnetIpv4Addresses: readonly string[];
}

const collectStdout = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const collectStderr = collectStdout;

const decodeTailscaleStatusJson = Schema.decodeEffect(Schema.fromJsonString(TailscaleStatusJson));

function normalizeMagicDnsName(status: TailscaleStatusJson): string | null {
  const dnsName = status.Self?.DNSName;
  if (typeof dnsName !== "string") {
    return null;
  }

  const normalized = dnsName.trim().replace(/\.$/u, "");
  return normalized.length > 0 ? normalized : null;
}

export const parseTailscaleMagicDnsName = (
  rawStatusJson: string,
): Effect.Effect<string | null, TailscaleStatusParseError> =>
  decodeTailscaleStatusJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map(normalizeMagicDnsName),
  );

export function isTailscaleIpv4Address(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const [first, second, third, fourth] = parts.map((part) => Number.parseInt(part, 10));
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    [first, second, third, fourth].some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return first === 100 && second >= 64 && second <= 127;
}

export const parseTailscaleStatus = (
  rawStatusJson: string,
): Effect.Effect<TailscaleStatus, TailscaleStatusParseError> =>
  decodeTailscaleStatusJson(rawStatusJson).pipe(
    Effect.mapError((cause) => new TailscaleStatusParseError({ cause })),
    Effect.map((parsed) => {
      const rawIps = parsed.Self?.TailscaleIPs;
      const tailnetIpv4Addresses: Array<string> = [];
      if (Array.isArray(rawIps)) {
        for (const address of rawIps) {
          if (typeof address === "string" && isTailscaleIpv4Address(address)) {
            tailnetIpv4Addresses.push(address);
          }
        }
      }

      return {
        magicDnsName: normalizeMagicDnsName(parsed),
        tailnetIpv4Addresses,
      };
    }),
  );

interface MacosTailscaleLocalApiCredentials {
  readonly port: number;
  readonly token: Redacted.Redacted<string>;
}

interface MacosTailscaleServeConfig {
  readonly config: Readonly<Record<string, unknown>>;
  readonly etag: string;
}

const LocalApiPortString = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
);
const LocalApiToken = Schema.String.check(Schema.isMinLength(16)).check(
  Schema.isPattern(/^[A-Za-z0-9_-]+$/u),
);
const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);
const ServeConfigJson = Schema.fromJsonString(Schema.NullOr(UnknownRecord));

const decodeLocalApiPortOption = Schema.decodeUnknownOption(LocalApiPortString);
const decodeLocalApiTokenOption = Schema.decodeUnknownOption(LocalApiToken);
const decodeUnknownRecordOption = Schema.decodeUnknownOption(UnknownRecord);
const decodeServeConfigJson = Schema.decodeEffect(ServeConfigJson);

const localApiError = (
  operation: TailscaleLocalApiOperation,
  reason: TailscaleLocalApiFailureReason,
  status?: number,
): TailscaleLocalApiError =>
  new TailscaleLocalApiError({ operation, reason, ...(status === undefined ? {} : { status }) });

const parseMacosLocalApiCredentials = (
  portInput: string,
  tokenInput: string,
): Option.Option<MacosTailscaleLocalApiCredentials> =>
  Option.all({
    port: decodeLocalApiPortOption(portInput.trim()),
    token: decodeLocalApiTokenOption(tokenInput.trim()),
  }).pipe(
    Option.map(({ port, token }) => ({
      port,
      token: Redacted.make(token),
    })),
  );

const parseMacosAppStoreCredentials = (
  lsofOutput: string,
): Option.Option<MacosTailscaleLocalApiCredentials> => {
  const match = /\.tailscale\.ipn\.macos\/sameuserproof-(\d+)-([A-Za-z0-9_-]+)/u.exec(lsofOutput);
  return match?.[1] && match[2] ? parseMacosLocalApiCredentials(match[1], match[2]) : Option.none();
};

const readMacosStandaloneCredentials = Effect.fn("tailscale.readMacosStandaloneCredentials")(
  function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const portInput = yield* fileSystem.readLink(`${MACOS_TAILSCALE_SHARED_DIRECTORY}/ipnport`);
    const port = decodeLocalApiPortOption(portInput.trim());
    if (Option.isNone(port)) {
      return yield* localApiError("discover", "credentials-unavailable");
    }
    const tokenInput = yield* fileSystem.readFileString(
      `${MACOS_TAILSCALE_SHARED_DIRECTORY}/sameuserproof-${port.value}`,
    );
    const credentials = parseMacosLocalApiCredentials(portInput, tokenInput);
    if (Option.isNone(credentials)) {
      return yield* localApiError("discover", "credentials-unavailable");
    }
    return credentials.value;
  },
);

const readMacosAppStoreCredentials = Effect.fn("tailscale.readMacosAppStoreCredentials")(
  function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const uid = process.getuid?.();
    const args = [
      "-n",
      "-a",
      ...(uid === undefined ? [] : [`-u${uid}`]),
      "-c",
      "IPNExtension",
      "-F",
    ];
    const child = yield* spawner.spawn(ChildProcess.make(MACOS_TAILSCALE_APP_STORE_LSOF, args));
    const [stdout, _stderr, exitCode] = yield* Effect.all(
      [
        collectStdout(child.stdout),
        collectStderr(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );
    if (exitCode !== 0) {
      return yield* localApiError("discover", "credentials-unavailable");
    }
    const credentials = parseMacosAppStoreCredentials(stdout);
    if (Option.isNone(credentials)) {
      return yield* localApiError("discover", "credentials-unavailable");
    }
    return credentials.value;
  },
);

const resolveMacosLocalApiCredentials = readMacosStandaloneCredentials().pipe(
  Effect.mapError(() => localApiError("discover", "credentials-unavailable")),
  Effect.catch(() =>
    readMacosAppStoreCredentials().pipe(
      Effect.scoped,
      Effect.timeout(TAILSCALE_STATUS_TIMEOUT),
      Effect.mapError(() => localApiError("discover", "credentials-unavailable")),
    ),
  ),
);

const runMacosLocalApiRequest = Effect.fn("tailscale.runMacosLocalApiRequest")(function* (input: {
  readonly credentials: MacosTailscaleLocalApiCredentials;
  readonly operation: TailscaleLocalApiOperation;
  readonly request: HttpClientRequest.HttpClientRequest;
  readonly timeout: Duration.Input;
}) {
  const client = yield* HttpClient.HttpClient;
  const request = input.request.pipe(HttpClientRequest.basicAuth("", input.credentials.token));
  const response = yield* client.execute(request).pipe(
    Effect.timeout(input.timeout),
    Effect.mapError(() => localApiError(input.operation, "request-failed")),
  );
  return response;
});

const localApiUrl = (
  credentials: MacosTailscaleLocalApiCredentials,
  path: "status" | "serve-config",
): string => `http://127.0.0.1:${credentials.port}${MACOS_TAILSCALE_LOCAL_API_PATH}/${path}`;

const readMacosTailscaleStatusWithCredentials = Effect.fn(
  "tailscale.readMacosTailscaleStatusWithCredentials",
)(function* (credentials: MacosTailscaleLocalApiCredentials) {
  const response = yield* runMacosLocalApiRequest({
    credentials,
    operation: "status",
    request: HttpClientRequest.get(`${localApiUrl(credentials, "status")}?peers=false`),
    timeout: TAILSCALE_STATUS_TIMEOUT,
  });
  if (response.status !== 200) {
    return yield* localApiError("status", "unexpected-status", response.status);
  }
  const rawStatusJson = yield* response.text.pipe(
    Effect.mapError(() => localApiError("status", "invalid-response")),
  );
  return yield* parseTailscaleStatus(rawStatusJson);
});

const readMacosServeConfig = Effect.fn("tailscale.readMacosServeConfig")(function* (
  credentials: MacosTailscaleLocalApiCredentials,
) {
  const response = yield* runMacosLocalApiRequest({
    credentials,
    operation: "get-serve-config",
    request: HttpClientRequest.get(localApiUrl(credentials, "serve-config")),
    timeout: TAILSCALE_SERVE_TIMEOUT,
  });
  if (response.status !== 200) {
    return yield* localApiError("get-serve-config", "unexpected-status", response.status);
  }
  const etag = response.headers.etag;
  if (!etag) {
    return yield* localApiError("get-serve-config", "invalid-response");
  }
  const rawConfig = yield* response.text.pipe(
    Effect.mapError(() => localApiError("get-serve-config", "invalid-response")),
  );
  const decodedConfig = yield* decodeServeConfigJson(rawConfig).pipe(
    Effect.mapError(() => localApiError("get-serve-config", "invalid-response")),
  );
  const config = decodedConfig ?? {};
  return { config, etag } satisfies MacosTailscaleServeConfig;
});

const writeMacosServeConfig = Effect.fn("tailscale.writeMacosServeConfig")(function* (input: {
  readonly credentials: MacosTailscaleLocalApiCredentials;
  readonly config: Readonly<Record<string, unknown>>;
  readonly etag: string;
}) {
  const request = HttpClientRequest.post(localApiUrl(input.credentials, "serve-config")).pipe(
    HttpClientRequest.setHeader("if-match", input.etag),
    HttpClientRequest.bodyJsonUnsafe(input.config),
  );
  const response = yield* runMacosLocalApiRequest({
    credentials: input.credentials,
    operation: "set-serve-config",
    request,
    timeout: TAILSCALE_SERVE_TIMEOUT,
  });
  if (response.status === 412) {
    return yield* localApiError("set-serve-config", "concurrent-update", response.status);
  }
  if (response.status !== 200) {
    return yield* localApiError("set-serve-config", "unexpected-status", response.status);
  }
});

const recordOrEmpty = Effect.fn("tailscale.recordOrEmpty")(function* (
  value: unknown,
  operation: TailscaleLocalApiOperation,
) {
  if (value === undefined) {
    return {} as Readonly<Record<string, unknown>>;
  }
  const record = decodeUnknownRecordOption(value);
  if (Option.isNone(record)) {
    return yield* localApiError(operation, "invalid-response");
  }
  return record.value;
});

const withoutRecordKey = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> => {
  const { [key]: _ignored, ...remaining } = record;
  return remaining;
};

const setOrRemoveRecord = (
  root: Readonly<Record<string, unknown>>,
  key: string,
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> =>
  Object.keys(value).length === 0
    ? withoutRecordKey(root, key)
    : {
        ...root,
        [key]: value,
      };

const ensureMacosTailscaleServe = Effect.fn("tailscale.ensureMacosTailscaleServe")(
  function* (input: {
    readonly localPort: number;
    readonly servePort: number;
    readonly localHost: string;
  }) {
    const credentials = yield* resolveMacosLocalApiCredentials;
    const status = yield* readMacosTailscaleStatusWithCredentials(credentials);
    if (!status.magicDnsName) {
      return yield* localApiError("status", "invalid-response");
    }
    const { config, etag } = yield* readMacosServeConfig(credentials);
    const tcp = yield* recordOrEmpty(config.TCP, "get-serve-config");
    const servePort = String(input.servePort);
    const existingTcpHandler = tcp[servePort];
    if (existingTcpHandler !== undefined) {
      const handler = yield* recordOrEmpty(existingTcpHandler, "get-serve-config");
      if (handler.HTTPS !== true && handler.HTTP !== true) {
        return yield* localApiError("set-serve-config", "incompatible-serve-config");
      }
    }

    const web = yield* recordOrEmpty(config.Web, "get-serve-config");
    const hostPort = `${status.magicDnsName}:${servePort}`;
    const webServer = yield* recordOrEmpty(web[hostPort], "get-serve-config");
    const handlers = yield* recordOrEmpty(webServer.Handlers, "get-serve-config");
    const updatedConfig = {
      ...config,
      TCP: {
        ...tcp,
        [servePort]: { HTTPS: true },
      },
      Web: {
        ...web,
        [hostPort]: {
          ...webServer,
          Handlers: {
            ...handlers,
            "/": { Proxy: `http://${input.localHost}:${input.localPort}` },
          },
        },
      },
    };
    yield* writeMacosServeConfig({ credentials, config: updatedConfig, etag });
  },
);

const disableMacosTailscaleServe = Effect.fn("tailscale.disableMacosTailscaleServe")(
  function* (input: { readonly servePort: number }) {
    const credentials = yield* resolveMacosLocalApiCredentials;
    const status = yield* readMacosTailscaleStatusWithCredentials(credentials);
    if (!status.magicDnsName) {
      return yield* localApiError("status", "invalid-response");
    }
    const { config, etag } = yield* readMacosServeConfig(credentials);
    const web = yield* recordOrEmpty(config.Web, "get-serve-config");
    const servePort = String(input.servePort);
    const hostPort = `${status.magicDnsName}:${servePort}`;
    if (web[hostPort] === undefined) {
      return;
    }

    const tcp = yield* recordOrEmpty(config.TCP, "get-serve-config");
    const allowFunnel = yield* recordOrEmpty(config.AllowFunnel, "get-serve-config");
    let updatedConfig = setOrRemoveRecord(config, "Web", withoutRecordKey(web, hostPort));
    updatedConfig = setOrRemoveRecord(updatedConfig, "TCP", withoutRecordKey(tcp, servePort));
    updatedConfig = setOrRemoveRecord(
      updatedConfig,
      "AllowFunnel",
      withoutRecordKey(allowFunnel, hostPort),
    );
    yield* writeMacosServeConfig({ credentials, config: updatedConfig, etag });
  },
);

const readTailscaleStatusFromCli = Effect.gen(function* () {
  const args = ["status", "--json"];
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const hostPlatform = yield* HostProcessPlatform;
  const executable = tailscaleCommandForPlatform(hostPlatform);
  const commandContext = {
    executable,
    subcommand: "status" as const,
    argumentCount: args.length,
  };
  return yield* Effect.gen(function* () {
    const child = yield* spawner.spawn(ChildProcess.make(executable, args)).pipe(
      Effect.mapError((cause) => new TailscaleCommandSpawnError({ ...commandContext, cause })),
      // Spawning can also fail as a defect rather than a typed error - a
      // non-directory entry on PATH makes node throw ENOTDIR synchronously.
      // `mapError` never sees that, so it would escape as an uncaught error.
      Effect.catchDefect((cause) =>
        Effect.fail(new TailscaleCommandSpawnError({ ...commandContext, cause })),
      ),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStdout(child.stdout),
        collectStderr(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError((cause) => new TailscaleCommandOutputError({ ...commandContext, cause })),
    );
    if (exitCode !== 0) {
      return yield* new TailscaleCommandExitError({
        ...commandContext,
        exitCode,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
        ...(stderrDiagnosticOf(stderr) !== undefined
          ? { stderrDiagnostic: stderrDiagnosticOf(stderr) }
          : {}),
      });
    }
    return yield* parseTailscaleStatus(stdout);
  }).pipe(
    Effect.scoped,
    Effect.timeout(TAILSCALE_STATUS_TIMEOUT),
    Effect.catchTags({
      TimeoutError: (cause) =>
        Effect.fail(
          new TailscaleCommandTimeoutError({
            ...commandContext,
            timeoutMs: Duration.toMillis(TAILSCALE_STATUS_TIMEOUT),
            cause,
          }),
        ),
    }),
  );
});

export const readTailscaleStatus = Effect.gen(function* () {
  const hostPlatform = yield* HostProcessPlatform;
  if (hostPlatform !== "darwin") {
    return yield* readTailscaleStatusFromCli;
  }

  const localApiResult = yield* Effect.result(
    resolveMacosLocalApiCredentials.pipe(Effect.flatMap(readMacosTailscaleStatusWithCredentials)),
  );
  if (Result.isSuccess(localApiResult)) {
    return localApiResult.success;
  }
  if (
    localApiResult.failure._tag === "TailscaleLocalApiError" &&
    localApiResult.failure.reason === "credentials-unavailable"
  ) {
    return yield* readTailscaleStatusFromCli;
  }
  return yield* localApiResult.failure;
});

export function buildTailscaleHttpsBaseUrl(input: {
  readonly magicDnsName: string;
  readonly servePort?: number;
}): string {
  const url = new URL(`https://${input.magicDnsName}`);
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  if (servePort !== DEFAULT_TAILSCALE_SERVE_PORT) {
    url.port = String(servePort);
  }
  url.pathname = "/";
  return url.toString();
}

const runTailscaleCommand = (
  args: readonly string[],
  timeoutInput: Duration.Input,
): Effect.Effect<void, TailscaleCommandError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const hostPlatform = yield* HostProcessPlatform;
    const executable = tailscaleCommandForPlatform(hostPlatform);
    const commandContext = {
      executable,
      subcommand: "serve" as const,
      argumentCount: args.length,
    };
    const timeout = Duration.fromInputUnsafe(timeoutInput);
    return yield* Effect.gen(function* () {
      const child = yield* spawner.spawn(ChildProcess.make(executable, args)).pipe(
        Effect.mapError((cause) => new TailscaleCommandSpawnError({ ...commandContext, cause })),
        Effect.catchDefect((cause) =>
          Effect.fail(new TailscaleCommandSpawnError({ ...commandContext, cause })),
        ),
      );
      const [stderr, exitCode] = yield* Effect.all(
        [collectStderr(child.stderr), child.exitCode.pipe(Effect.map(Number))],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.mapError((cause) => new TailscaleCommandOutputError({ ...commandContext, cause })),
      );
      if (exitCode !== 0) {
        return yield* new TailscaleCommandExitError({
          ...commandContext,
          exitCode,
          stderrLength: stderr.length,
          ...(stderrDiagnosticOf(stderr) !== undefined
            ? { stderrDiagnostic: stderrDiagnosticOf(stderr) }
            : {}),
        });
      }
    }).pipe(
      Effect.scoped,
      Effect.timeout(timeout),
      Effect.catchTags({
        TimeoutError: (cause) =>
          Effect.fail(
            new TailscaleCommandTimeoutError({
              ...commandContext,
              timeoutMs: Duration.toMillis(timeout),
              cause,
            }),
          ),
      }),
    );
  });

export const ensureTailscaleServe = (input: {
  readonly localPort: number;
  readonly servePort?: number;
  readonly localHost?: string;
}) => {
  const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
  const localHost = input.localHost ?? "127.0.0.1";
  return Effect.gen(function* () {
    const hostPlatform = yield* HostProcessPlatform;
    if (hostPlatform !== "darwin") {
      const args = [
        "serve",
        "--bg",
        `--https=${servePort}`,
        `http://${localHost}:${input.localPort}`,
      ];
      return yield* runTailscaleCommand(args, TAILSCALE_SERVE_TIMEOUT);
    }

    const localApiResult = yield* Effect.result(
      ensureMacosTailscaleServe({
        localPort: input.localPort,
        servePort,
        localHost,
      }),
    );
    if (Result.isSuccess(localApiResult)) {
      return;
    }
    if (
      localApiResult.failure._tag === "TailscaleLocalApiError" &&
      localApiResult.failure.reason === "credentials-unavailable"
    ) {
      return yield* runTailscaleCommand(
        ["serve", "--bg", `--https=${servePort}`, `http://${localHost}:${input.localPort}`],
        TAILSCALE_SERVE_TIMEOUT,
      );
    }
    return yield* localApiResult.failure;
  });
};

export const disableTailscaleServe = (
  input: {
    readonly servePort?: number;
  } = {},
) =>
  Effect.gen(function* () {
    const servePort = input.servePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
    const hostPlatform = yield* HostProcessPlatform;
    if (hostPlatform !== "darwin") {
      return yield* runTailscaleCommand(
        ["serve", `--https=${servePort}`, "off"],
        TAILSCALE_SERVE_TIMEOUT,
      );
    }

    const localApiResult = yield* Effect.result(disableMacosTailscaleServe({ servePort }));
    if (Result.isSuccess(localApiResult)) {
      return;
    }
    if (
      localApiResult.failure._tag === "TailscaleLocalApiError" &&
      localApiResult.failure.reason === "credentials-unavailable"
    ) {
      return yield* runTailscaleCommand(
        ["serve", `--https=${servePort}`, "off"],
        TAILSCALE_SERVE_TIMEOUT,
      );
    }
    return yield* localApiResult.failure;
  });

export const probeTailscaleHttpsEndpoint = (input: {
  readonly baseUrl: string;
  readonly timeout?: Duration.Input;
}): Effect.Effect<boolean, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* Effect.gen(function* () {
      const url = new URL("/.well-known/t3/environment", input.baseUrl);
      const request = HttpClientRequest.get(url.toString());
      return yield* client.execute(request);
    }).pipe(Effect.timeoutOption(input.timeout ?? TAILSCALE_PROBE_TIMEOUT));

    return Option.match(response, {
      onNone: () => false,
      onSome: (httpResponse) => httpResponse.status >= 200 && httpResponse.status < 300,
    });
  }).pipe(Effect.orElseSucceed(() => false));
