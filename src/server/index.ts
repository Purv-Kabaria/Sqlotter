import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { triggers } from './routes/triggers';
import { schedulerRoutes } from './routes/scheduler';

const app      = new Hono();
const internal = new Hono();

// Store the subreddit name on install so the scheduler can look it up later
app.use('*', async (_, next) => {
  await next();
});

internal.route('/menu',      menu);
internal.route('/form',      forms);
internal.route('/triggers',  triggers);
internal.route('/scheduler', schedulerRoutes);

app.route('/api',      api);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
