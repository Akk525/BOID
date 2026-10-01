import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hashCanonical } from "../economic-model/canonical.ts";
import {
  DEFAULT_SNAPSHOT_LIMITS, parseGitHubPin, resolveSourceSpan, snapshotGitCommit,
  snapshotLocal, SnapshotError,
} from "./snapshot.ts";

const fixture = "fixtures/creator-marketplace";

test("fixture snapshot is deterministic, selects source, and resolves exact pinned lines", () => {
  const first = snapshotLocal(fixture);
  const second = snapshotLocal(fixture);
  assert.deepEqual(second, first);
  assert.equal(first.snapshotHash, hashCanonical({
    schemaVersion: first.schemaVersion, source: first.source, selection: first.selection,
    limits: first.limits, files: first.files, totalBytes: first.totalBytes,
  }));
  assert.deepEqual(first.files.map((file) => file.path), [
    "src/checkout.mjs", "src/config.mjs", "src/referrals.mjs", "src/sample-data.mjs",
  ]);
  const span = resolveSourceSpan(first, "src/config.mjs", 3, 5);
  assert.equal(span.text, readFileSync(join(fixture, "src/config.mjs"), "utf8")
    .split("\n").slice(2, 5).join("\n"));
  assert.equal(span.fileSha256, first.files.find((file) => file.path === span.path)?.sha256);
  assert.throws(() => resolveSourceSpan(first, "../src/config.mjs", 1, 1), SnapshotError);
  assert.throws(() => resolveSourceSpan(first, "src/config.mjs", 1, 1000), SnapshotError);
  const cli = JSON.parse(execFileSync(process.execPath, [
    "src/repository/snapshot-cli.ts", fixture, "--span", "src/config.mjs", "3", "5",
  ], { encoding: "utf8" }));
  assert.equal(cli.snapshotHash, first.snapshotHash);
  assert.deepEqual(cli.span, span);
});

test("file, byte, and entry limits fail with actionable diagnostics", () => {
  const changes = [
    [{ maxFiles: 1 }, /selected source files/],
    [{ maxFileBytes: 50 }, /maxFileBytes/],
    [{ maxTotalBytes: 200 }, /maxTotalBytes/],
    [{ maxEntries: 1 }, /entries/],
  ] as const;
  for (const [change, expected] of changes) {
    assert.throws(() => snapshotLocal(fixture, { ...DEFAULT_SNAPSHOT_LIMITS, ...change }), expected);
  }
});

test("local traversal ignores symlinks, generated code, tests, and credentials", () => {
  const root = mkdtempSync(join(tmpdir(), "boid-local-"));
  try {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "src", "app.ts"), "export const value = 1;\n");
    writeFileSync(join(root, "src", "credentials.ts"), "export const password = 'secret';\n");
    writeFileSync(join(root, "src", "app.test.ts"), "throw Error('do not run');\n");
    writeFileSync(join(root, "node_modules", "ignored.js"), "ignored\n");
    symlinkSync(join(root, "node_modules"), join(root, "src", "linked-dir"));
    symlinkSync(join(root, "src", "app.ts"), join(root, "src", "linked.ts"));
    assert.deepEqual(snapshotLocal(root).files.map((file) => file.path), ["src/app.ts"]);
    symlinkSync(root, join(root, "root-link"));
    assert.throws(() => snapshotLocal(join(root, "root-link")), /symlink/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Git tree is commit pinned and excludes uncommitted changes and symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "boid-git-"));
  try {
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    }).trim();
    git("init", "-q");
    git("config", "user.name", "Boid Test");
    git("config", "user.email", "boid@example.test");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "app.ts"), "export const version = 1;\n");
    symlinkSync("app.ts", join(root, "src", "linked.ts"));
    git("add", ".");
    git("commit", "-qm", "first");
    const firstCommit = git("rev-parse", "HEAD");
    const source = { type: "github" as const, repository: "example/project", commit: firstCommit };
    const first = snapshotGitCommit(root, firstCommit, source);
    writeFileSync(join(root, "src", "app.ts"), "export const version = 2;\n");
    assert.deepEqual(snapshotGitCommit(root, firstCommit, source), first);
    git("add", ".");
    git("commit", "-qm", "second");
    const secondCommit = git("rev-parse", "HEAD");
    const second = snapshotGitCommit(root, secondCommit, { ...source, commit: secondCommit });
    assert.notEqual(second.snapshotHash, first.snapshotHash);
    assert.equal(first.files[0]?.content, "export const version = 1;\n");
    assert.deepEqual(first.files.map((file) => file.path), ["src/app.ts"]);
    assert.throws(() => snapshotGitCommit(root, "a".repeat(40), source), SnapshotError);
    assert.throws(() => snapshotGitCommit(root, firstCommit, { ...source, commit: secondCommit }), /metadata/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GitHub input requires an HTTPS repository and full commit pin", () => {
  const sha = "a".repeat(40);
  assert.deepEqual(parseGitHubPin(`https://github.com/example/project/tree/${sha}`),
    { repository: "example/project", commit: sha });
  for (const input of [
    "https://github.com/example/project", "https://github.com/example/project/tree/main",
    `https://evil.example/example/project/tree/${sha}`,
    `https://github.com/example/project/tree/${sha}/src`,
  ]) assert.throws(() => parseGitHubPin(input), /40-character-commit-SHA/);
  const unsupported = spawnSync(process.execPath, ["src/repository/snapshot-cli.ts", "https://github.com/example/project"], { encoding: "utf8" });
  assert.equal(unsupported.status, 1);
  assert.equal(unsupported.stdout, "");
  assert.match(unsupported.stderr, /40-character-commit-SHA/);
});
