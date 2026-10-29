import type { FastifyInstance } from 'fastify';
import authRoutes from './auth.js';
import coreRoutes from './core.js';
import transactionRoutes from './transactions.js';
import importRoutes from './imports.js';
import statementRoutes from './statements.js';
import automationRoutes from './automation.js';
import planningRoutes from './planning.js';
import reportRoutes from './reports.js';
import exportRoutes from './exports.js';
import profileRoutes from './profiles.js';
import loanRoutes from './loans.js';
import pendingRoutes from './pending.js';
import mercadoPagoRoutes from './mercadopago.js';
import auditRoutes from './audit.js';
import undoRoutes from './undo.js';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { appVersion } from '../lib/version.js';

function builtVersion(): string | null {
  try {
    return (JSON.parse(fs.readFileSync(path.join(config.webDir, 'build.json'), 'utf8')) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

export async function registerRoutes(app: FastifyInstance) {
  await app.register(authRoutes);
  await app.register(coreRoutes);
  await app.register(transactionRoutes);
  await app.register(importRoutes);
  await app.register(statementRoutes);
  await app.register(automationRoutes);
  await app.register(planningRoutes);
  await app.register(reportRoutes);
  await app.register(exportRoutes);
  await app.register(profileRoutes);
  await app.register(loanRoutes);
  await app.register(pendingRoutes);
  await app.register(mercadoPagoRoutes);
  await app.register(auditRoutes);
  await app.register(undoRoutes);
  // `build`: the version the served web app was compiled from (scripts/build-stamp.mjs). When it
  // differs from `version`, the code was updated but not compiled: reloading the page can't help.
  app.get('/health', async () => ({ ok: true, version: appVersion(), build: builtVersion() }));
}
