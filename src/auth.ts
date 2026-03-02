import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TELEX_DIR = join(homedir(), ".telex");
const AUTH_DIR = join(TELEX_DIR, "auth");

export function getAuthDir(): string {
  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
  return AUTH_DIR;
}

export function hasAuth(): boolean {
  return existsSync(join(AUTH_DIR, "session.txt"));
}
