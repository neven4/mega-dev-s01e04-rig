import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';
import { readNight } from './digest/reader.js';
import { DigestPage } from './views/digest.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/digest/:night', async (c) => {
    const night = c.req.param('night');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return c.text('Not found', 404);
    const digest = await readNight(config.runsDir, night);
    if (digest.state === 'missing') return c.text('Not found', 404);
    return c.html(<Layout title={`digest ${night}`} lane={lane()}><DigestPage night={night} digest={digest} /></Layout>);
  });

  app.get('/api/digest/:night', async (c) => {
    const night = c.req.param('night');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return c.json({ error: 'Not found' }, 404);
    const digest = await readNight(config.runsDir, night);
    if (digest.state === 'missing') return c.json({ error: 'Not found' }, 404);
    return c.json(digest);
  });

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  return app;
}
