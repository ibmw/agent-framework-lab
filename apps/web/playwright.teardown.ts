import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_FILE_PREFIX } from "./playwright.config";

// Every run migrates a database named for itself under the system temporary directory, and left
// on its own the directory accumulates one per run forever. The suite holds fixed ports, so two
// runs cannot overlap and no file found here belongs to anyone else: the sweep removes the run's
// own database and any that a killed run left behind, journal and shared-memory files included.
export default async function removeRunDatabases(): Promise<void> {
  const directory = tmpdir();
  const entries = await readdir(directory);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(DATABASE_FILE_PREFIX))
      .map((entry) => rm(join(directory, entry), { force: true })),
  );
}
