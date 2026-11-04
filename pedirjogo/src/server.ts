import express from 'express';
import cookieSession from 'cookie-session';
import { fileURLToPath } from 'node:url';
import type { Config } from './config.js';
import { authRouter } from './auth.js';
import { apiRouter, errorHandler } from './routes.js';
import type { RequestService } from './service.js';
import type { FetchLike } from './steam.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

export interface AppDeps {
  config: Config;
  service: RequestService;
  /** fetch usado no OAuth (injetável para testes). */
  fetch?: FetchLike;
}

export function createApp({ config, service, fetch }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1);

  app.use(
    cookieSession({
      name: 'pj_session',
      keys: [config.sessionSecret],
      httpOnly: true,
      sameSite: 'lax',
      secure: config.production,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    }),
  );
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(authRouter({ config, service, fetch }));
  app.use('/api', apiRouter({ config, service }));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  app.use(errorHandler);

  return app;
}
