import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, it } from "vite-plus/test";

const script = NodePath.join(import.meta.dirname, "downstream-merge-candidate.sh");
const reportScript = NodePath.join(import.meta.dirname, "downstream-sync.ts");

function run(command: string, cwd: string, env: NodeJS.ProcessEnv = {}) {
  return NodeChildProcess.execSync(command, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Coda test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Coda test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      ...env,
    },
  });
}

function git(cwd: string, args: string) {
  return run(`git ${args}`, cwd).trim();
}

function write(path: string, contents: string) {
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  NodeFS.writeFileSync(path, contents);
}

function parseOutput(stdout: string) {
  return Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)] as const;
      }),
  );
}

function createRepos() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "coda-merge-candidate-"));
  const official = NodePath.join(root, "official");
  const coda = NodePath.join(root, "coda");
  const temp = NodePath.join(root, "tmp");
  NodeFS.mkdirSync(temp);

  run("git init -b main official", root);
  write(NodePath.join(official, "shared.ts"), "upstream v1\n");
  write(NodePath.join(official, "upstream-only.ts"), "from upstream\n");
  git(official, "add .");
  git(official, "commit -m 'feat: official start'");
  const baseSha = git(official, "rev-parse HEAD");
  git(official, "tag v0.0.1-nightly.20260101.1");

  run("git clone official coda", root);
  write(NodePath.join(coda, "coda-only.ts"), "coda customization\n");
  write(NodePath.join(coda, ".coda-upstream/upstream.json"), "{}\n");
  git(coda, "add .");
  git(coda, "commit -m 'chore: coda customization'");
  const oldHead = git(coda, "rev-parse HEAD");
  write(
    NodePath.join(coda, "scripts/downstream-sync.ts"),
    NodeFS.readFileSync(reportScript, "utf8"),
  );

  return { root, official, coda, temp, baseSha, oldHead };
}

function envFor(input: {
  readonly coda: string;
  readonly official: string;
  readonly temp: string;
  readonly baseSha: string;
  readonly oldHead: string;
  readonly officialMainSha: string;
  readonly keepConflicted?: boolean;
}) {
  return {
    UPSTREAM_REPOSITORY: "example/upstream",
    UPSTREAM_BRANCH: "main",
    OFFICIAL_TAG: "v0.0.1-nightly.20260101.1",
    OFFICIAL_MAIN_SHA: input.officialMainSha,
    OFFICIAL_NIGHTLY_SHA: input.baseSha,
    OLD_MAIN_SHA: input.baseSha,
    OLD_HEAD: input.oldHead,
    RELEASE_VERSION: "0.0.1-nightly.20260101.1.coda.1.1",
    RUNNER_TEMP: input.temp,
    OFFICIAL_REMOTE_URL: input.official,
    KEEP_CONFLICTED: input.keepConflicted ? "true" : "",
    CANDIDATE_DIR: NodePath.join(input.temp, "coda-candidate"),
  };
}

describe("downstream merge candidate", () => {
  it("bundles a clean upstream merge", () => {
    const repos = createRepos();
    write(NodePath.join(repos.official, "upstream-only.ts"), "from upstream v2\n");
    git(repos.official, "add upstream-only.ts");
    git(repos.official, "commit -m 'feat: upstream move'");
    const officialMainSha = git(repos.official, "rev-parse HEAD");

    const output = parseOutput(
      run(
        `bash ${JSON.stringify(script)} attempt`,
        repos.coda,
        envFor({ ...repos, officialMainSha }),
      ),
    );
    NodeAssert.equal(output.conflicted, "false");

    const finished = parseOutput(
      run(
        `bash ${JSON.stringify(script)} finish`,
        repos.coda,
        envFor({ ...repos, officialMainSha }),
      ),
    );
    NodeAssert.match(finished.candidate_sha ?? "", /^[0-9a-f]{40}$/u);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(repos.temp, "candidate.bundle")), true);
  });

  it("keeps a conflicted worktree when asked", () => {
    const repos = createRepos();
    write(NodePath.join(repos.official, "shared.ts"), "upstream v2\n");
    git(repos.official, "add shared.ts");
    git(repos.official, "commit -m 'feat: touch shared'");
    const officialMainSha = git(repos.official, "rev-parse HEAD");

    write(NodePath.join(repos.coda, "shared.ts"), "coda v2\n");
    git(repos.coda, "add shared.ts");
    git(repos.coda, "commit -m 'fix: coda shared'");
    const oldHead = git(repos.coda, "rev-parse HEAD");

    const output = parseOutput(
      run(
        `bash ${JSON.stringify(script)} attempt`,
        repos.coda,
        envFor({ ...repos, officialMainSha, oldHead, keepConflicted: true }),
      ),
    );
    NodeAssert.equal(output.conflicted, "true");
    const unmerged = NodeFS.readFileSync(NodePath.join(repos.temp, "unmerged-paths.txt"), "utf8");
    NodeAssert.match(unmerged, /shared\.ts/);
    NodeAssert.equal(NodeFS.existsSync(output.candidate_dir ?? ""), true);

    const candidateDir = output.candidate_dir ?? "";
    run("git checkout --ours -- shared.ts", candidateDir);
    run("git add shared.ts", candidateDir);
    const finished = parseOutput(
      run(
        `bash ${JSON.stringify(script)} finish`,
        repos.coda,
        envFor({ ...repos, officialMainSha, oldHead, keepConflicted: true }),
      ),
    );
    NodeAssert.match(finished.candidate_sha ?? "", /^[0-9a-f]{40}$/u);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(repos.temp, "candidate.bundle")), true);
  });
});
