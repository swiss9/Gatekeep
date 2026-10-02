import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { env } from './env.js';
import { HttpError } from './middleware/auth.js';
import { startBot, stopBot } from './bot.js';
import { authRoutes } from './routes/auth.js';
import { storeRoutes } from './routes/store.js';
import { productRoutes } from './routes/products.js';
import { categoryRoutes } from './routes/categories.js';
import { orderRoutes } from './routes/orders.js';
import { paymentRoutes } from './routes/payments.js';
import { adminRoutes } from './routes/admin.js';
import { teamRoutes } from './routes/team.js';

async function build(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: true,
  });

  // Preserve the raw JSON body for webhook signature verification.
  // Fastify's built-in JSON parser would discard it otherwise.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req: FastifyRequest, body: Buffer, done) => {
      (req as FastifyRequest & { rawBody?: Buffer }).rawBody = body;
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? env.CLIENT_ORIGIN : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'Validation failed',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.message });
    }
    app.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/health', async () => ({ ok: true, ts: Date.now() }));

  await app.register(authRoutes);
  await app.register(storeRoutes);
  await app.register(productRoutes);
  await app.register(categoryRoutes);
  await app.register(orderRoutes);
  await app.register(paymentRoutes);
  await app.register(adminRoutes);
  await app.register(teamRoutes);

  return app;
}

const app = await build();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Gatekeep Shop server listening on :${env.PORT}`);
  startBot();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`received ${signal}, shutting down`);
  stopBot();
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
