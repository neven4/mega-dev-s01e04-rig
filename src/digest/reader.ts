import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types';

interface RunEvent {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
}

function isEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  return typeof event.at === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(event.at)
    && Number.isFinite(Date.parse(event.at))
    && typeof event.job === 'string' && event.job.trim().length > 0
    && (event.status === 'ok' || event.status === 'retry' || event.status === 'fail')
    && (event.owner === null || typeof event.owner === 'string')
    && (event.error === undefined || typeof event.error === 'string');
}

export const readNight: ReadNight = async (runsDir, night) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) throw new Error('Invalid night: expected YYYY-MM-DD');
  const result: NightDigest = {
    state: 'empty', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
  };
  let contents: string;
  try {
    contents = await readFile(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return { ...result, state: 'missing' };
    }
    throw error;
  }
  const jobs = new Map<string, DigestRow>();
  const errorTimes = new Map<string, number>();
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      result.badLines++;
      continue;
    }
    if (!isEvent(event)) {
      result.badLines++;
      continue;
    }
    result.counts[event.status]++;
    const time = Date.parse(event.at);
    let row = jobs.get(event.job);
    if (!row) {
      row = {
        job: event.job, owner: event.owner, runs: 0, retries: 0,
        lastStatus: event.status, lastError: null, firstTime: event.at, lastTime: event.at,
      };
      jobs.set(event.job, row);
    }
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (time < Date.parse(row.firstTime)) row.firstTime = event.at;
    if (time >= Date.parse(row.lastTime)) {
      row.lastTime = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
    }
    if (event.error !== undefined && time >= (errorTimes.get(event.job) ?? -Infinity)) {
      row.lastError = event.error;
      errorTimes.set(event.job, time);
    }
  }
  result.rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  if (result.rows.length) result.state = 'ready';
  return result;
};
