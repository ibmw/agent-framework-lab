import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_FILE_PREFIX } from "./tests/e2e/support/stack";

// Every run migrates a database per worker under the system temporary directory, each named for
// the run and the worker it belongs to, and gives each worker a media root beside it; left on
// its own the directory accumulates them forever. The suite holds fixed ports, so two runs cannot
// overlap and nothing found here belongs to anyone else: the sweep removes the run's own
// databases and media roots and any that a killed run left behind, journal and shared-memory
// files included. Recursively, because a media root is a directory of directories.
export default async function removeRunDatabases(): Promise<void> {
  const directory = tmpdir();
  const entries = await readdir(directory);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(DATABASE_FILE_PREFIX))
      .map((entry) => rm(join(directory, entry), { force: true, recursive: true })),
  );
}
