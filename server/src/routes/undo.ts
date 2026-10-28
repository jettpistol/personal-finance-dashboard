import type { FastifyInstance } from 'fastify';
import { undoAction } from '../lib/undo.js';

// Deshacer: the toast's button sends the token the action's response carried (x-undo-token).
export default async function undoRoutes(app: FastifyInstance) {
  app.post('/undo/:token', async (req) => undoAction(String((req.params as { token: string }).token), req.userId));
}
