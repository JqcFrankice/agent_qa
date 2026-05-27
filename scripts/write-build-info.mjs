#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const target = resolve(process.cwd(), "dist", "build-info.json");
const payload = {
  gitSha: gitSha(),
  buildTime: new Date().toISOString()
};

mkdirSync(resolve(process.cwd(), "dist"), { recursive: true });
writeFileSync(target, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`wrote ${target}: ${JSON.stringify(payload)}`);
