import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
const event = { at: '2026-10-28T23:00:00+02:00', job: 'zebra', owner: null };
const lines = [
  { ...event, status: 'retry', error: 'upstream down' },
  { ...event, at: '2026-10-28T23:01:00+02:00', status: 'retry' },
  { ...event, at: '2026-10-28T23:02:00+02:00', status: 'retry' },
  { ...event, at: '2026-10-28T23:03:00+02:00', status: 'fail' },
  { ...event, job: 'alpha', owner: 'rook', status: 'ok' },
].map(value => JSON.stringify(value));
const expected: NightDigest = {
  state: 'ready', badLines: 0, counts: { ok: 1, retry: 3, fail: 1 },
  rows: [
    { job: 'alpha', owner: 'rook', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
      firstTime: event.at, lastTime: event.at },
    { job: 'zebra', owner: null, runs: 4, retries: 3, lastStatus: 'fail', lastError: 'upstream down',
      firstTime: event.at, lastTime: '2026-10-28T23:03:00+02:00' },
  ],
};

function tableRows(html: string) {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(row =>
    [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1]),
  );
}

describe('digest routes', () => {
  let runsDir: string;
  let app: ReturnType<typeof createApp>;
  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), 'rig-routes-'));
    app = createApp({ adapter: 'shim', installed: event.at, beatEverySeconds: 60, runsDir });
  });
  afterEach(async () => { await rm(runsDir, { recursive: true, force: true }); });

  it('serves matching sorted HTML and JSON values with display warnings', async () => {
    await writeFile(join(runsDir, `${night}.jsonl`), lines.join('\n'));
    const page = await app.request(`/digest/${night}`);
    const api = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(api.headers.get('content-type')).toContain('application/json');
    const digest: NightDigest = await api.json();
    expect(digest).toEqual(expected);
    const html = await page.text();
    expect(tableRows(html)).toEqual(digest.rows.map(row => [
      row.job, row.owner ?? '—', String(row.runs), String(row.retries), row.lastStatus,
      row.lastError ?? '—', row.firstTime, row.lastTime,
    ]));
    expect(html).toContain('<td class="warn">3</td>');
    expect(html).toContain('<td class="warn">fail</td>');
  });

  it('returns 404 for a night without a file on both routes', async () => {
    expect((await app.request(`/digest/${night}`)).status).toBe(404);
    expect((await app.request(`/api/digest/${night}`)).status).toBe(404);
  });

  it('renders nothing ran and no JSON rows for an empty file', async () => {
    await writeFile(join(runsDir, `${night}.jsonl`), '');
    const page = await app.request(`/digest/${night}`);
    const api = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');
    expect(await api.json()).toEqual({
      state: 'empty', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts a malformed line and still serves all valid jobs', async () => {
    await writeFile(join(runsDir, `${night}.jsonl`), [lines[0], '{broken', ...lines.slice(1)].join('\n'));
    const page = await app.request(`/digest/${night}`);
    const api = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({ ...expected, badLines: 1 });
    const html = await page.text();
    expect(html).toContain('1 bad lines');
    expect(tableRows(html).map(row => row[0])).toEqual(['alpha', 'zebra']);
  });
});
