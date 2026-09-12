// Tiny .env loader so the runner has zero runtime dependencies besides the Daytona SDK.
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // no .env — rely on the real environment
}

export const env = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing env ${name} (see agent/.env.example)`);
  }
  return v;
};
export const has = (name) => Boolean(process.env[name]);
