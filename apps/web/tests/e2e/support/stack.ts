import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The shape of the second stack Playwright brings up for itself: one whole stack per worker.
 *
 * It used to be one stack for the whole run, and that made the suite untrustworthy in parallel.
 * Every worker drove its browser against one FastAPI process holding one SQLite file, so every
 * write in every journey queued on that file's single writer lock. A long write — an arm answering a turn,
 * a judge scoring one — could hold it past SQLite's busy timeout, and the request that was
 * waiting failed with `database is locked`. The API answered 500, the Studio swallowed it into
 * its error banner, and the spec sat waiting for a reply its arm had never been given. Nothing
 * about that failure pointed at the code under test.
 *
 * A worker that owns its API and its database contends with nobody, and the fixture values its
 * specs invent — shop slugs, references, block names — cannot meet another worker's, because no
 * other worker can see them.
 */

/** How many workers the suite runs, and therefore how many stacks it declares. */
export const WORKER_COUNT = process.env.CI ? 2 : 4;

export const DATABASE_FILE_PREFIX = "agent-framework-lab-playwright-";

// Playwright's own ports (`AGENTS.md`), now a block of them: one API and one frontend per
// worker, counting up from the pair the suite already held. Nothing outside the suite serves
// from these, and anything found listening on one is a leftover to remove.
const API_PORT_BASE = 8001;
const WEB_PORT_BASE = 5174;

export const apiPort = (worker: number): number => API_PORT_BASE + worker;
export const webPort = (worker: number): number => WEB_PORT_BASE + worker;
export const apiOrigin = (worker: number): string => `http://localhost:${apiPort(worker)}`;
export const webOrigin = (worker: number): string => `http://localhost:${webPort(worker)}`;

/** Each worker's own Vite dependency-optimizer cache, kept between runs so it is warm. */
export const webCacheDir = (worker: number): string => `node_modules/.vite-e2e-w${worker}`;

/**
 * The frontend's readiness URL: the app's entry module rather than its HTML page.
 *
 * `index.html` is served before Vite has looked at a line of TypeScript, so a server that answers
 * it is not yet a server that can render anything. Asking for the entry module makes Vite optimize
 * its dependencies and transform the entry before the run starts, which puts a cold start where it
 * belongs — outside somebody's first navigation and its timeout.
 */
export const webReadyUrl = (worker: number): string => `${webOrigin(worker)}/src/main.tsx`;

/** Each worker's own database file, named for the run so a killed run's files are still sweepable. */
export const databaseUrl = (runId: string, worker: number): string =>
  `sqlite:///${join(tmpdir(), `${DATABASE_FILE_PREFIX}${runId}-w${worker}.db`)}`;

/** The worker indexes the run declares a stack for. */
export const stacks = (): number[] => Array.from({ length: WORKER_COUNT }, (_, index) => index);

/**
 * Which stack the calling worker process owns.
 *
 * `TEST_PARALLEL_INDEX` is Playwright's own numbering of the slots a run has, and it is what
 * keeps the count of stacks and the count of workers the same number.
 */
export const workerIndex = (): number => Number(process.env.TEST_PARALLEL_INDEX ?? "0");
