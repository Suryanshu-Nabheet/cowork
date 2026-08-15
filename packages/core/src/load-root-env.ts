import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";

/**
 * Walk up from cwd looking for a repository-root `.env` and load it.
 * Does not override variables that are already set in the process environment.
 */
export function loadRootEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) {
      try {
        loadEnvFile(candidate);
      } catch {
        // ignore malformed or unreadable env files
      }
      if (process.env.DATA_DIR && !path.isAbsolute(process.env.DATA_DIR)) {
        process.env.DATA_DIR = path.resolve(dir, process.env.DATA_DIR);
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
