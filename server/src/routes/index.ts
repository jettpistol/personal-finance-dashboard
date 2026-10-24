import type { FastifyInstance } from 'fastify';
import authRoutes from './auth.js';
import coreRoutes from './core.js';
import transactionRoutes from './transactions.js';
import importRoutes from './imports.js';
import automationRoutes from './automation.js';
import planningRoutes from './planning.js';
import reportRoutes from './reports.js';
import exportRoutes from './exports.js';
import profileRoutes from './profiles.js';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(authRoutes);
  await app.register(coreRoutes);
  await app.register(transactionRoutes);
  await app.register(importRoutes);
  await app.register(automationRoutes);
  await app.register(planningRoutes);
  await app.register(reportRoutes);
  await app.register(exportRoutes);
  await app.register(profileRoutes);
  app.get('/health', async () => ({ ok: true }));
}
