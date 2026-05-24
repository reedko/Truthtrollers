/**
 * Discussion System Routes Index
 *
 * Combines discussion units and X auth routes
 */

import { Router } from 'express';
import createDiscussionRouter from './discussion.routes.js';
import createXAuthRouter from './x-auth.routes.js';

export default function createDiscussionSystemRouter({ query, pool }) {
  const router = Router();

  // Discussion units routes
  router.use('/api/discussion', createDiscussionRouter({ query, pool }));

  // X/Twitter auth routes
  router.use('/api/x-auth', createXAuthRouter({ query, pool }));

  return router;
}
