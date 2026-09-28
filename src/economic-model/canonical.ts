import { createHash } from "node:crypto";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
