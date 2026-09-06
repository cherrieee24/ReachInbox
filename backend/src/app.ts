import path from 'node:path';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { env, isProduction, staticConfig } from './config/env.js';
import { BULL_BOARD_PATH, createQueueDashboard } from './integrations/bullBoard.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { requireAdmin } from './middleware/requireAdmin.js';
import { requireAuth } from './middleware/requireAuth.js';
import routes from './routes/index.js';
import { asyncHandler } from './utils/asyncHandler.js';

/** Origins allowed to make credentialed requests, from CORS_ORIGIN (comma-separated). */
const allowedOrigins = env.corsOrigin
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export function createApp(): Express {
  const app = express();

  // Behind a proxy/load balancer, trust X-Forwarded-* so `secure` cookies work.
  if (isProduction) app.set('trust proxy', 1);

  // Bull Board ships its own inline styles and scripts, which the default CSP
  // blocks. Relaxing it for that one path keeps the strict policy everywhere
  // else rather than weakening the whole app.
  const defaultHelmet = helmet();
  const dashboardHelmet = helmet({ contentSecurityPolicy: false });
  app.use((req, res, next) =>
    req.path.startsWith(BULL_BOARD_PATH)
      ? dashboardHelmet(req, res, next)
      : defaultHelmet(req, res, next),
  );

  app.use(
    cors({
      // credentials:true forbids "*", so the origin is echoed only when allow-listed.
      // Anything else simply gets no CORS headers and is blocked by the browser —
      // rejecting with an error here would turn a blocked request into a 500.
      origin(origin, callback) {
        callback(null, !origin || allowedOrigins.includes(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  app.use(cookieParser());

  // Recipient lists are posted as a JSON string and can legitimately be large.
  // body-parser skips a request whose body is already parsed, so this
  // route-specific limit must be registered before the global one.
  app.use('/api/emails/validate-file', express.json({ limit: '6mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  // Logs the URL with OAuth codes and tokens redacted.
  app.use(requestLogger());

  // Queue monitoring. requireAuth first (who are you), then requireAdmin
  // (are you allowed) — the dashboard is never reachable without both.
  app.use(
    BULL_BOARD_PATH,
    asyncHandler(requireAuth),
    requireAdmin,
    createQueueDashboard(),
  );

  // Broad ceiling on API traffic; individual routes tighten it further.
  app.use('/api', apiLimiter(), routes);

  // Optionally serve the built SPA from this same process, so the app and the
  // API share an origin. Mounted after the API so a route collision can never
  // shadow an endpoint, and before notFoundHandler so unknown paths reach the
  // SPA's client-side router instead of returning a JSON 404.
  const staticSettings = staticConfig();
  if (staticSettings.enabled) {
    const distPath = path.resolve(process.cwd(), staticSettings.distPath);
    const indexHtml = path.join(distPath, 'index.html');

    app.use(express.static(distPath, { index: false }));
    app.get(/^(?!\/api\/).*/, (req, res, next) => {
      // Never hand the SPA shell to a dashboard path — that belongs to Bull Board.
      if (req.path.startsWith(BULL_BOARD_PATH)) return next();
      res.sendFile(indexHtml, (error) => (error ? next(error) : undefined));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
