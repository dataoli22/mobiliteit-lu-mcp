import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Walk up from this module so the lookup works from both src/ and dist/src/.
function readPackageVersion(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(directory, "package.json");
    if (existsSync(candidate)) {
      const { version } = JSON.parse(readFileSync(candidate, "utf8")) as {
        version?: unknown;
      };
      if (typeof version === "string") {
        return version;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Unable to locate package.json for the server version");
    }
    directory = parent;
  }
}

export const SERVER_NAME = "mobiliteit-lu-mcp";
export const SERVER_VERSION = readPackageVersion();
