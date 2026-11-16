import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import morgan from 'morgan';
import { ROOT_DIR, config } from './config/env.js';
import { createSlackRouter } from './integrations/slack/app.js';
import { handleOAuthCallback } from './integrations/slack/oauth.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/common.js';
import { healthReport } from './utils/health.js';
import auditRoutes from './modules/audit/routes.js';
import authRoutes from './modules/auth/routes.js';
import publicRoutes from './modules/public/routes.js';
import briefRoutes from './modules/briefs/routes.js';
import dashboardRoutes from './modules/dashboard/routes.js';
import decisionRoutes from './modules/decisions/routes.js';
import integrationRoutes from './modules/integrations/routes.js';
import meetingRoutes from './modules/meetings/routes.js';
import { devRouter, metaRouter } from './modules/meta/routes.js';
import notificationRoutes from './modules/notifications/routes.js';
import organizationRoutes from './modules/organizations/routes.js';
import platformRoutes from './modules/platform/routes.js';
import profileRoutes from './modules/profiles/routes.js';
import reviewRoutes from './modules/reviews/routes.js';
import ruleRoutes from './modules/rules/routes.js';
import userRoutes from './modules/users/routes.js';
import { ah } from './utils/http.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({ origin: config.appUrl, credentials: true }));
  if (!config.isTest) app.use(morgan(config.isProd ? 'combined' : 'dev'));

  // Slack signs the raw request body, so its router goes before JSON parsing.
  const slackRouter = createSlackRouter();
  if (slackRouter) app.use(slackRouter);
  else app.post('/slack/events', (req, res) => res.status(503).json({ error: 'Slack is not configured on this server' }));
  app.get('/slack/oauth/callback', ah(handleOAuthCallback));

  app.use(express.json({ limit: '6mb' }));
  // For an external uptime monitor: 200 when the API and its database are working, 503 otherwise.
  app.get('/api/health', (req, res) => {
    const { status, body } = healthReport(mongoose.connection.readyState);
    res.status(status).json(body);
  });
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: config.isTest ? 10000 : 600, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use('/api/meta', metaRouter);
  if (!config.isProd) app.use('/api/dev', devRouter);
  app.use('/api/auth', authRoutes);
  // Pages that need no sign-in (the "request an account" form).
  app.use('/api/public', publicRoutes);

  app.use('/api', authenticate);
  app.use('/api/orgs', organizationRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/rules', ruleRoutes);
  app.use('/api/profiles', profileRoutes);
  app.use('/api/briefs', briefRoutes);
  app.use('/api/decisions', decisionRoutes);
  app.use('/api/reviews', reviewRoutes);
  app.use('/api/meetings', meetingRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/integrations', integrationRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/platform', platformRoutes);
  app.use('/api', notFoundHandler);

  // In production the built React app is served by the same server.
  const dist = path.join(ROOT_DIR, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => (req.path.startsWith('/slack') ? next() : res.sendFile(path.join(dist, 'index.html'))));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
