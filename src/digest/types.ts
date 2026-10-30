export type RunStatus = 'ok' | 'retry' | 'fail';

export interface DigestRow {
  job: string;
  /** Owner of the latest event, including null. */
  owner: string | null;
  /** Number of valid events, including retries. */
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  /** Most recent supplied error, or null if none. */
  lastError: string | null;
  /** Chronological bounds, preserving the original timestamp strings. */
  firstTime: string;
  lastTime: string;
}

export interface NightDigest {
  /** Missing file versus existing file (which may have no valid events). */
  state: 'missing' | 'empty' | 'ready';
  /** Sorted by job using code-point order. */
  rows: DigestRow[];
  badLines: number;
  /** Counts of valid events, not final job statuses. */
  counts: Record<RunStatus, number>;
}

/** Implemented as readNight in ./reader; night must be YYYY-MM-DD.
 * Blank lines are ignored. Invalid events count as bad lines.
 * Equal timestamps use file order, with the later line winning.
 * Only ENOENT means missing; other filesystem errors propagate.
 */
export type ReadNight = (runsDir: string, night: string) => Promise<NightDigest>;
