#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Runs before workspace dependencies are installed.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

export interface DownstreamState {
  readonly repository: string;
  readonly branch: string;
  readonly mainSha: string;
  readonly nightlyTag: string | null;
  readonly nightlySha: string | null;
  readonly version: string | null;
}

export interface GitHubRelease {
  readonly tag_name?: unknown;
  readonly draft?: unknown;
  readonly prerelease?: unknown;
  readonly published_at?: unknown;
}

export interface NightlyRelease {
  readonly tag: string;
  readonly version: string;
  readonly publishedAt: string;
}

const OFFICIAL_NIGHTLY_TAG = /^v(\d+\.\d+\.\d+-nightly\.\d{8}\.\d+)$/u;
const CODA_NIGHTLY_VERSION = /^\d+\.\d+\.\d+-nightly\.\d{8}\.\d+\.coda\.\d+\.\d+$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Downstream state field ${field} must be a string or null.`);
  }
  return value;
}

export function decodeDownstreamState(value: unknown): DownstreamState {
  if (
    !isRecord(value) ||
    typeof value.repository !== "string" ||
    typeof value.branch !== "string" ||
    typeof value.mainSha !== "string"
  ) {
    throw new Error("Downstream state must contain repository, branch, and mainSha strings.");
  }

  const state = {
    repository: value.repository,
    branch: value.branch,
    mainSha: value.mainSha,
    nightlyTag: decodeNullableString(value.nightlyTag, "nightlyTag"),
    nightlySha: decodeNullableString(value.nightlySha, "nightlySha"),
    version: decodeNullableString(value.version, "version"),
  };

  if (!state.repository.trim() || !state.branch.trim()) {
    throw new Error("Downstream upstream repository and branch cannot be empty.");
  }
  if (!/^[0-9a-f]{40}$/u.test(state.mainSha)) {
    throw new Error("Downstream state has an invalid main commit sha.");
  }
  if ((state.nightlyTag === null) !== (state.nightlySha === null)) {
    throw new Error("Downstream nightly tag and sha must either both be set or both be null.");
  }
  if (state.nightlyTag !== null && !OFFICIAL_NIGHTLY_TAG.test(state.nightlyTag)) {
    throw new Error(`Downstream state has an invalid nightly tag: ${state.nightlyTag}`);
  }
  if (state.nightlySha !== null && !/^[0-9a-f]{40}$/u.test(state.nightlySha)) {
    throw new Error("Downstream state has an invalid nightly commit sha.");
  }
  if (state.version !== null && !CODA_NIGHTLY_VERSION.test(state.version)) {
    throw new Error(`Downstream state has an invalid published version: ${state.version}`);
  }
  return state;
}

export function compareNightlyTags(left: string, right: string): number {
  const leftParts = left.match(/\d+/gu)?.map(Number);
  const rightParts = right.match(/\d+/gu)?.map(Number);
  if (!leftParts || !rightParts) throw new Error("Cannot compare invalid nightly versions.");
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function selectLatestNightlyRelease(value: unknown): NightlyRelease {
  if (!Array.isArray(value)) throw new Error("GitHub releases payload must be an array.");

  const releases = value.flatMap((candidate): ReadonlyArray<NightlyRelease> => {
    if (!isRecord(candidate) || candidate.draft === true || candidate.prerelease !== true)
      return [];
    if (typeof candidate.tag_name !== "string" || typeof candidate.published_at !== "string") {
      return [];
    }
    const match = OFFICIAL_NIGHTLY_TAG.exec(candidate.tag_name);
    if (!match?.[1] || Number.isNaN(Date.parse(candidate.published_at))) return [];
    return [{ tag: candidate.tag_name, version: match[1], publishedAt: candidate.published_at }];
  });

  const latest = releases.toSorted((left, right) => {
    const versionOrder = compareNightlyTags(right.tag, left.tag);
    return versionOrder !== 0
      ? versionOrder
      : Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  })[0];
  if (!latest) throw new Error("No published official nightly release was found.");
  return latest;
}

export function createDownstreamVersion(input: {
  readonly releaseVersion: string;
  readonly mainDistance: number;
  readonly runNumber: number;
}): string {
  if (!OFFICIAL_NIGHTLY_TAG.test(`v${input.releaseVersion}`)) {
    throw new Error(`Invalid official nightly version: ${input.releaseVersion}`);
  }
  if (!Number.isSafeInteger(input.mainDistance) || input.mainDistance < 0) {
    throw new Error("Upstream main distance must be a non-negative integer.");
  }
  if (!Number.isSafeInteger(input.runNumber) || input.runNumber < 1) {
    throw new Error("GitHub Actions run number must be a positive integer.");
  }
  return `${input.releaseVersion}.coda.${input.mainDistance}.${input.runNumber}`;
}

export function resolveDownstreamUpdate(input: {
  readonly state: DownstreamState;
  readonly release: NightlyRelease;
  readonly mainSha: string;
  readonly nightlySha: string;
  readonly mainDistance: number;
  readonly runNumber: number;
  readonly force: boolean;
}) {
  if (!/^[0-9a-f]{40}$/u.test(input.mainSha) || !/^[0-9a-f]{40}$/u.test(input.nightlySha)) {
    throw new Error("Official inbound metadata has an invalid commit sha.");
  }

  if (input.state.nightlyTag !== null) {
    const releaseOrder = compareNightlyTags(input.release.tag, input.state.nightlyTag);
    if (releaseOrder < 0) {
      throw new Error("Refusing to move the recorded official Nightly release backward.");
    }
    if (releaseOrder === 0 && input.nightlySha !== input.state.nightlySha) {
      throw new Error("The recorded official Nightly tag now points at a different commit.");
    }
  }

  const hasUpdate =
    input.force ||
    input.release.tag !== input.state.nightlyTag ||
    input.mainSha !== input.state.mainSha;
  const version = createDownstreamVersion({
    releaseVersion: input.release.version,
    mainDistance: input.mainDistance,
    runNumber: input.runNumber,
  });
  if (
    hasUpdate &&
    input.state.version !== null &&
    compareNightlyTags(`v${version}`, `v${input.state.version}`) <= 0
  ) {
    throw new Error("Refusing to publish a downstream snapshot without advancing the version.");
  }

  return {
    has_update: String(hasUpdate),
    tag: `v${version}`,
    version,
    official_tag: input.release.tag,
    nightly_sha: input.nightlySha,
    source_sha: input.mainSha,
    old_nightly_sha: input.state.nightlySha ?? "",
    old_main_sha: input.state.mainSha,
    repository: input.state.repository,
    branch: input.state.branch,
  };
}

export function findPathCollisions(
  upstreamPaths: ReadonlyArray<string>,
  customizationPaths: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const custom = new Set(customizationPaths.map((path) => path.trim()).filter(Boolean));
  return [
    ...new Set(upstreamPaths.map((path) => path.trim()).filter((path) => custom.has(path))),
  ].toSorted();
}

export function renderCollisionReport(input: {
  readonly oldSha: string;
  readonly newTag: string;
  readonly newSha: string;
  readonly overlappingPaths: ReadonlyArray<string>;
  readonly unmergedPaths: ReadonlyArray<string>;
  readonly rebaseError: string;
}): string {
  const section = (title: string, paths: ReadonlyArray<string>) =>
    paths.length === 0
      ? `### ${title}\n\nNone.\n`
      : `### ${title}\n\n${paths.map((path) => `- \`${path}\``).join("\n")}\n`;
  return [
    "# Coda upstream sync needs review",
    "",
    `- Previous upstream main: \`${input.oldSha}\``,
    `- Candidate upstream: \`${input.newTag}\` / \`${input.newSha}\``,
    "",
    "The candidate was not built, published, or pushed.",
    "",
    section("Files changed by both upstream and Coda", input.overlappingPaths),
    section("Unmerged paths reported by Git", input.unmergedPaths),
    "### Rebase error",
    "",
    "```text",
    input.rebaseError.trim() || "Git did not provide stderr.",
    "```",
    "",
  ].join("\n");
}

function readJson(path: string): unknown {
  return JSON.parse(NodeFS.readFileSync(path, "utf8"));
}

function readPathList(path: string | undefined): ReadonlyArray<string> {
  if (!path || !NodeFS.existsSync(path)) return [];
  return NodeFS.readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function appendGitHubOutput(values: Readonly<Record<string, string>>): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT is required when --github-output is set.");
  NodeFS.appendFileSync(
    outputPath,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
}

function decodeMainSha(value: unknown): string {
  if (!isRecord(value) || typeof value.sha !== "string" || !/^[0-9a-f]{40}$/u.test(value.sha)) {
    throw new Error("Official main metadata must contain a valid commit sha.");
  }
  return value.sha;
}

function decodeMainComparison(value: unknown): {
  readonly nightlySha: string;
  readonly distance: number;
} {
  if (
    !isRecord(value) ||
    (value.status !== "ahead" && value.status !== "identical") ||
    !Number.isSafeInteger(value.ahead_by) ||
    (value.ahead_by as number) < 0 ||
    !isRecord(value.base_commit) ||
    typeof value.base_commit.sha !== "string" ||
    !/^[0-9a-f]{40}$/u.test(value.base_commit.sha)
  ) {
    throw new Error("Official Nightly must be identical to or an ancestor of upstream main.");
  }
  return { nightlySha: value.base_commit.sha, distance: value.ahead_by as number };
}

function runLatest(values: Record<string, string | boolean | undefined>): void {
  if (typeof values.releases !== "string") throw new Error("latest requires --releases.");
  process.stdout.write(
    `${JSON.stringify(selectLatestNightlyRelease(readJson(values.releases)), null, 2)}\n`,
  );
}

function runResolve(values: Record<string, string | boolean | undefined>): void {
  const { releases, state, main, compare } = values;
  if ([releases, state, main, compare].some((value) => typeof value !== "string")) {
    throw new Error("resolve requires --releases, --state, --main, and --compare.");
  }
  const runNumber = Number(values["run-number"]);
  const currentState = decodeDownstreamState(readJson(state as string));
  const release = selectLatestNightlyRelease(readJson(releases as string));
  const comparison = decodeMainComparison(readJson(compare as string));
  const output = resolveDownstreamUpdate({
    state: currentState,
    release,
    mainSha: decodeMainSha(readJson(main as string)),
    nightlySha: comparison.nightlySha,
    mainDistance: comparison.distance,
    runNumber,
    force: values.force === true,
  });
  if (values["github-output"] === true) appendGitHubOutput(output);
  else process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function runReport(values: Record<string, string | boolean | undefined>): void {
  const outputPath = values.output;
  if (typeof outputPath !== "string") throw new Error("report requires --output.");
  for (const name of ["old-sha", "new-tag", "new-sha"] as const) {
    if (typeof values[name] !== "string") throw new Error(`report requires --${name}.`);
  }
  const rebaseErrorPath =
    typeof values["rebase-error"] === "string" ? values["rebase-error"] : undefined;
  const report = renderCollisionReport({
    oldSha: values["old-sha"] as string,
    newTag: values["new-tag"] as string,
    newSha: values["new-sha"] as string,
    overlappingPaths: findPathCollisions(
      readPathList(
        typeof values["upstream-paths"] === "string" ? values["upstream-paths"] : undefined,
      ),
      readPathList(
        typeof values["customization-paths"] === "string"
          ? values["customization-paths"]
          : undefined,
      ),
    ),
    unmergedPaths: readPathList(
      typeof values["unmerged-paths"] === "string" ? values["unmerged-paths"] : undefined,
    ),
    rebaseError:
      rebaseErrorPath && NodeFS.existsSync(rebaseErrorPath)
        ? NodeFS.readFileSync(rebaseErrorPath, "utf8")
        : "",
  });
  NodeFS.mkdirSync(NodePath.dirname(NodePath.resolve(outputPath)), { recursive: true });
  NodeFS.writeFileSync(outputPath, report);
}

const isMain =
  process.argv[1] && NodePath.resolve(process.argv[1]) === NodePath.resolve(import.meta.filename);
if (isMain) {
  const command = process.argv[2];
  const { values } = NodeUtil.parseArgs({
    args: process.argv.slice(3),
    options: {
      releases: { type: "string" },
      state: { type: "string" },
      main: { type: "string" },
      compare: { type: "string" },
      "run-number": { type: "string" },
      force: { type: "boolean" },
      "github-output": { type: "boolean" },
      output: { type: "string" },
      "old-sha": { type: "string" },
      "new-tag": { type: "string" },
      "new-sha": { type: "string" },
      "upstream-paths": { type: "string" },
      "customization-paths": { type: "string" },
      "unmerged-paths": { type: "string" },
      "rebase-error": { type: "string" },
    },
    strict: true,
  });
  if (command === "latest") runLatest(values);
  else if (command === "resolve") runResolve(values);
  else if (command === "report") runReport(values);
  else throw new Error("Expected command 'latest', 'resolve', or 'report'.");
}
