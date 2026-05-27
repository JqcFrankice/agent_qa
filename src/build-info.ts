import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

interface BuildInfo {
  gitSha: string;
  buildTime: string;
}

const FALLBACK: BuildInfo = { gitSha: "unknown", buildTime: "unknown" };

export function loadBuildInfo(): BuildInfo {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, "build-info.json");
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as BuildInfo;
  } catch {
    return FALLBACK;
  }
}
