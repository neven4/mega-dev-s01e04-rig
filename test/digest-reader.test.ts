import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader';

const night = '2026-10-28';
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'rig-reader-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
const event = { at: '2026-10-28T23:00:00+01:00', job: 'a', status: 'ok', owner: null };
async function log(values: unknown[]) {
  await writeFile(join(dir, `${night}.jsonl`), values.map(value => JSON.stringify(value)).join('\n'));
}

describe('readNight', () => {
  it('reads the real fixture without modifying it', async () => {
    const result = await readNight('runs', night);
    expect(result.state).toBe('ready');
    expect(result.badLines).toBe(1);
    expect(result.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(result.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(result.rows[0].owner).toBeNull();
    expect(result.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503',
      firstTime: '2026-10-29T01:30:00+01:00', lastTime: '2026-10-29T01:37:00+01:00',
    });
  });

  it('distinguishes missing, empty and malformed-only nights', async () => {
    expect((await readNight(dir, night)).state).toBe('missing');
    await writeFile(join(dir, `${night}.jsonl`), ' \n\r\n');
    expect(await readNight(dir, night)).toEqual({
      state: 'empty', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
    await writeFile(join(dir, `${night}.jsonl`), '{broken\n');
    expect(await readNight(dir, night)).toMatchObject({ state: 'empty', badLines: 1 });
  });

  it('validates every event field and continues after bad lines', async () => {
    await log([null, [], {}, { ...event, at: 'yesterday' }, { ...event, job: '' },
      { ...event, status: 'unknown' }, { ...event, owner: 1 },
      { ...event, owner: undefined }, { ...event, error: null }, event]);
    const result = await readNight(dir, night);
    expect(result.badLines).toBe(9);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ runs: 1, owner: null, lastError: null });
  });

  it('uses chronological bounds across offsets and file order for ties', async () => {
    await log([
      { ...event, at: '2026-10-29T01:00:00+02:00', status: 'fail', error: 'latest', owner: 'x' },
      { ...event, at: '2026-10-28T22:30:00Z', status: 'retry', error: 'older' },
      { ...event, at: '2026-10-28T23:00:00Z' },
    ]);
    expect((await readNight(dir, night)).rows[0]).toEqual({
      job: 'a', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'latest',
      firstTime: '2026-10-28T22:30:00Z', lastTime: '2026-10-28T23:00:00Z',
    });
  });

  it('rejects path traversal and propagates filesystem errors', async () => {
    await expect(readNight(dir, '../secret')).rejects.toThrow('Invalid night');
    await mkdir(join(dir, `${night}.jsonl`));
    await expect(readNight(dir, night)).rejects.toThrow();
  });
});
