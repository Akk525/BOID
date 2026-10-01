import { canonicalJson } from "../economic-model/canonical.ts";
import { resolveSourceSpan, snapshotRepository } from "./snapshot.ts";

try {
  const [source, option, path, first, last, ...extra] = process.argv.slice(2);
  if (!source || extra.length || (option !== undefined &&
    (option !== "--span" || !path || !first || !last))) {
    throw new Error("Usage: npm run --silent snapshot -- <local-directory|pinned-GitHub-URL> [--span <path> <start-line> <end-line>]");
  }
  const snapshot = snapshotRepository(source);
  if (option === "--span") {
    process.stdout.write(canonicalJson({
      snapshotHash: snapshot.snapshotHash,
      span: resolveSourceSpan(snapshot, path!, Number(first), Number(last)),
    }));
  } else {
    process.stdout.write(canonicalJson(snapshot));
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
