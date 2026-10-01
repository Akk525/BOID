import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { hashCanonical } from "../economic-model/canonical.ts";

export type SnapshotLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxEntries: number;
};
export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = {
  maxFiles: 100, maxFileBytes: 1_000_000, maxTotalBytes: 5_000_000, maxEntries: 10_000,
};
export type SnapshotFile = {
  path: string;
  sha256: string;
  bytes: number;
  lineCount: number;
  content: string;
};
export type RepositorySnapshot = {
  schemaVersion: 1;
  source: { type: "local"; path: string } | { type: "github"; repository: string; commit: string };
  selection: "js-ts-source-v1";
  limits: SnapshotLimits;
  files: SnapshotFile[];
  totalBytes: number;
  snapshotHash: string;
};
export type SourceSpan = {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  fileSha256: string;
};

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const EXCLUDED_SEGMENT = /^(?:node_modules|vendor|dist|build|coverage|\.git|\.next|\.cache|generated|__generated__|__tests__|test|tests|fixtures)$/i;
const SECRET_SEGMENT = /(?:^|[-_.])(?:secret|secrets|credential|credentials|private|key|keys|token|tokens)(?:$|[-_.])/i;
const EXCLUDED_FILE = /(?:\.min\.[cm]?js|\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?|\.generated\.[cm]?[jt]sx?|\.d\.[cm]?ts)$/i;
const GITHUB_PIN = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/tree\/([a-fA-F0-9]{40})\/?$/;

function validateLimits(limits: SnapshotLimits): void {
  const caps: SnapshotLimits = {
    maxFiles: 10_000, maxFileBytes: 10_000_000,
    maxTotalBytes: 100_000_000, maxEntries: 100_000,
  };
  for (const name of Object.keys(caps) as (keyof SnapshotLimits)[]) {
    const value = limits[name];
    if (!Number.isSafeInteger(value) || value < 1 || value > caps[name]) {
      throw new SnapshotError(`${name} must be a positive integer at most ${caps[name]}`);
    }
  }
}

function isSelected(path: string): boolean {
  const parts = path.split("/");
  if (parts.some((part) => part.startsWith(".") || EXCLUDED_SEGMENT.test(part) || SECRET_SEGMENT.test(part))) return false;
  const file = parts.at(-1) ?? "";
  return SOURCE_EXTENSION.test(file) && !EXCLUDED_FILE.test(file);
}

function assertPath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new SnapshotError(`Unsafe source path: ${path}`);
  }
}

function lineCount(content: string): number {
  if (!content) return 0;
  return content.split(/\r\n|\n|\r/).length - (/[\r\n]$/.test(content) ? 1 : 0);
}

function readLocalFile(path: string, limit: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new SnapshotError(`${path} is not a regular source file`);
    if (stat.size > limit) throw new SnapshotError(`${path} exceeds maxFileBytes (${limit})`);
    const output = Buffer.alloc(limit + 1);
    let used = 0;
    while (used < output.length) {
      const count = readSync(fd, output, used, output.length - used, null);
      if (!count) break;
      used += count;
    }
    if (used > limit) throw new SnapshotError(`${path} exceeds maxFileBytes (${limit})`);
    return output.subarray(0, used);
  } finally {
    closeSync(fd);
  }
}

function collect(
  source: RepositorySnapshot["source"], candidates: Iterable<{ path: string; read: () => Buffer }>,
  limits: SnapshotLimits,
): RepositorySnapshot {
  validateLimits(limits);
  const files: SnapshotFile[] = [];
  let totalBytes = 0;
  let entries = 0;
  for (const candidate of candidates) {
    entries++;
    if (entries > limits.maxEntries) throw new SnapshotError(`Repository has more than ${limits.maxEntries} entries; raise maxEntries or narrow the repository`);
    assertPath(candidate.path);
    if (!isSelected(candidate.path)) continue;
    if (files.length >= limits.maxFiles) throw new SnapshotError(`More than ${limits.maxFiles} selected source files; raise maxFiles or narrow the repository`);
    const bytes = candidate.read();
    if (bytes.length > limits.maxFileBytes) throw new SnapshotError(`${candidate.path} exceeds maxFileBytes (${limits.maxFileBytes})`);
    totalBytes += bytes.length;
    if (totalBytes > limits.maxTotalBytes) throw new SnapshotError(`Selected source exceeds maxTotalBytes (${limits.maxTotalBytes})`);
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new SnapshotError(`${candidate.path} is not UTF-8 source text`); }
    files.push({
      path: candidate.path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length, lineCount: lineCount(content), content,
    });
  }
  if (!files.length) throw new SnapshotError("No supported JS/TS source files found; check path, selection rules, or repository contents");
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const core = { schemaVersion: 1 as const, source, selection: "js-ts-source-v1" as const, limits, files, totalBytes };
  return { ...core, snapshotHash: hashCanonical(core) };
}

/** Walk source without following symlinks or executing repository files. */
export function snapshotLocal(inputPath: string, limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS): RepositorySnapshot {
  validateLimits(limits);
  const root = resolve(inputPath);
  let rootStat;
  try { rootStat = lstatSync(root); }
  catch { throw new SnapshotError(`Local source directory does not exist: ${root}`); }
  if (rootStat.isSymbolicLink()) throw new SnapshotError("Repository root must not be a symlink");
  if (!rootStat.isDirectory()) throw new SnapshotError("Local source must be a directory");
  const rootReal = realpathSync(root);
  let walkedEntries = 0;
  function* walk(directory: string): Generator<{ path: string; read: () => Buffer }> {
    for (const name of readdirSync(directory).sort()) {
      walkedEntries++;
      if (walkedEntries > limits.maxEntries) throw new SnapshotError(`Repository has more than ${limits.maxEntries} entries; raise maxEntries or narrow the repository`);
      const full = join(directory, name);
      const path = relative(rootReal, full).split(sep).join("/");
      assertPath(path);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (!name.startsWith(".") && !EXCLUDED_SEGMENT.test(name) && !SECRET_SEGMENT.test(name)) yield* walk(full);
      } else if (stat.isFile()) {
        yield { path, read: () => readLocalFile(full, limits.maxFileBytes) };
      }
    }
  }
  return collect({ type: "local", path: rootReal }, walk(rootReal), limits);
}

export function parseGitHubPin(input: string): { repository: string; commit: string } {
  const match = GITHUB_PIN.exec(input);
  if (!match) throw new SnapshotError("GitHub source must be https://github.com/OWNER/REPO/tree/<40-character-commit-SHA>");
  return { repository: `${match[1]}/${match[2]}`, commit: match[3]!.toLowerCase() };
}

function git(repo: string, args: string[], maxBuffer = 8_000_000): Buffer {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "buffer", maxBuffer, timeout: 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new SnapshotError(`Git could not read the pinned commit or source tree: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Read only regular blobs at one immutable commit. No checkout or submodule code runs. */
export function snapshotGitCommit(
  repositoryPath: string, commit: string, source: RepositorySnapshot["source"],
  limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS,
): RepositorySnapshot {
  validateLimits(limits);
  if (!/^[a-fA-F0-9]{40}$/.test(commit)) throw new SnapshotError("Commit pin must be a full 40-character SHA");
  if (source.type === "github" && source.commit !== commit.toLowerCase()) {
    throw new SnapshotError("GitHub source metadata must match the requested commit pin");
  }
  const actual = git(repositoryPath, ["rev-parse", "--verify", `${commit}^{commit}`]).toString("utf8").trim();
  if (actual !== commit.toLowerCase()) throw new SnapshotError("Resolved commit differs from the requested pin");
  const tree = git(repositoryPath, ["ls-tree", "-r", "-z", "--full-tree", commit], limits.maxEntries * 300);
  function* candidates(): Generator<{ path: string; read: () => Buffer }> {
    for (const record of tree.toString("utf8").split("\0")) {
      if (!record) continue;
      const tab = record.indexOf("\t");
      if (tab < 0) throw new SnapshotError("Malformed Git tree entry");
      const metadata = record.slice(0, tab).split(" ");
      const path = record.slice(tab + 1);
      const [mode, type, oid] = metadata;
      // 120000 symlink and 160000 submodule entries are never read.
      if (type !== "blob" || !["100644", "100755"].includes(mode ?? "")) continue;
      if (!oid || !/^[a-f0-9]{40,64}$/.test(oid)) throw new SnapshotError("Malformed Git blob ID");
      yield { path, read: () => {
        const size = Number(git(repositoryPath, ["cat-file", "-s", oid], 100).toString("utf8").trim());
        if (!Number.isSafeInteger(size) || size > limits.maxFileBytes) {
          throw new SnapshotError(`${path} exceeds maxFileBytes (${limits.maxFileBytes})`);
        }
        return git(repositoryPath, ["cat-file", "blob", oid], limits.maxFileBytes + 1);
      } };
    }
  }
  return collect(source, candidates(), limits);
}

export function snapshotGitHub(input: string, limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS): RepositorySnapshot {
  const pin = parseGitHubPin(input);
  const directory = mkdtempSync(join(tmpdir(), "boid-source-"));
  try {
    git(directory, ["init", "--bare"]);
    git(directory, ["remote", "add", "origin", `https://github.com/${pin.repository}.git`]);
    git(directory, ["fetch", "--filter=blob:none", "--depth=1", "origin", pin.commit]);
    return snapshotGitCommit(directory, pin.commit, { type: "github", ...pin }, limits);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function snapshotRepository(input: string, limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS): RepositorySnapshot {
  return /^(?:[a-z]+:\/\/|git@)/i.test(input) ? snapshotGitHub(input, limits) : snapshotLocal(input, limits);
}

export function resolveSourceSpan(snapshot: RepositorySnapshot, path: string, startLine: number, endLine: number): SourceSpan {
  assertPath(path);
  const file = snapshot.files.find((item) => item.path === path);
  if (!file) throw new SnapshotError(`Source file is absent from snapshot: ${path}`);
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine || endLine > file.lineCount) {
    throw new SnapshotError(`Invalid line span ${path}:${startLine}-${endLine}; file has ${file.lineCount} lines`);
  }
  const lines = file.content.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? [];
  const text = lines.slice(startLine - 1, endLine).join("").replace(/\r?\n$|\r$/, "");
  return { path, startLine, endLine, text, fileSha256: file.sha256 };
}
