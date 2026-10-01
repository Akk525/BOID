# Repository snapshot v1

`snapshotRepository(source)` reads a local directory or a public GitHub repository at a full commit SHA. It returns a deterministic JSON snapshot with selected source text, SHA-256 per file, a snapshot hash, and 1-based line spans. It never imports, builds, checks out, or executes source files. Repository extraction in B08 will consume this snapshot.

## Commands

From the repository root, with Node 24 or newer:

```sh
npm run --silent snapshot -- fixtures/creator-marketplace > /tmp/boid-source.json
npm run --silent snapshot -- fixtures/creator-marketplace --span src/config.mjs 3 5
```

Public GitHub input must have this exact form, including a full 40-character commit SHA:

```text
https://github.com/OWNER/REPO/tree/FULL_COMMIT_SHA
```

The GitHub path uses a shallow, blob-filtered Git fetch into a temporary bare repository. It verifies that the requested commit resolves to the same SHA, reads regular blobs from that tree, then deletes the temporary repository. A branch name, tag, pull request URL, private repository, other host, or shortened SHA is unsupported. Network and Git access are required for GitHub inputs.

## Selection and bounds

The `js-ts-source-v1` selection includes UTF-8 `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, and `.tsx` files. It excludes hidden directories, `node_modules`, `vendor`, `dist`, `build`, `coverage`, `.next`, `.cache`, `generated`, `__generated__`, `tests`, `test`, `__tests__`, and `fixtures`. It also excludes `.test`, `.spec`, `.min`, `.generated`, and `.d.ts` style files and path segments named like secrets, credentials, private keys, or tokens. Symlinks and Git submodules are skipped. A supported repository must contain at least one selected file.

Default limits are 100 selected files, 1,000,000 bytes per file, 5,000,000 selected bytes total, and 10,000 scanned entries. Library callers may lower or raise those values within hard caps of 10,000 files, 10,000,000 bytes per file, 100,000,000 total bytes, and 100,000 entries. A breached bound fails with a diagnostic. Files are sorted by relative path before hashing. The snapshot hash covers source identity, selection version, limits, file paths, bytes, hashes, and content. Identical pinned input and limits produce identical JSON and snapshot hashes; local directories are content snapshots and may change between runs.

`resolveSourceSpan(snapshot, path, startLine, endLine)` returns the exact text at inclusive, 1-based lines and its file hash. Paths must be normalized relative paths present in the snapshot; traversal and out-of-range lines fail. The CLI `--span` option returns a compact JSON object with the span and snapshot hash.

Snapshotting records source text for review; it does not establish that source code is safe, that a cited rule has been interpreted correctly, or that a repository contains no secrets embedded in otherwise selected source files. Review an external snapshot before sharing its JSON.
