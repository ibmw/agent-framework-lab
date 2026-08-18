import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const schemaPath = join(packageRoot, "openapi/v1/openapi.yaml");
const outputPath = join(packageRoot, "src/generated/v1.ts");
const checkOnly = process.argv.includes("--check");
const targetPath = checkOnly ? join(dirname(outputPath), `.v1-${randomUUID()}.ts`) : outputPath;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

mkdirSync(dirname(outputPath), { recursive: true });

try {
  run("pnpm", ["exec", "openapi-typescript", schemaPath, "-o", targetPath]);
  run("pnpm", ["exec", "biome", "format", "--write", targetPath]);

  if (checkOnly) {
    const matches =
      existsSync(outputPath) && readFileSync(targetPath).equals(readFileSync(outputPath));
    if (!matches) {
      console.error("Generated TypeScript contracts are stale. Run `make contracts`.");
      process.exitCode = 1;
    }
  }
} finally {
  if (checkOnly) {
    rmSync(targetPath, { force: true });
  }
}
