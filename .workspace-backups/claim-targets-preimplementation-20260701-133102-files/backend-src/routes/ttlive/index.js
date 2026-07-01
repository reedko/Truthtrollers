/**
 * TruthTrollers Live Feed Routes Index
 */

import { Router } from 'express';
import createTTLiveRouter from './ttlive.routes.js';
import createArgumentsRouter from './arguments.routes.js';
import createConversationsRouter from './conversations.routes.js';

export default function createTTLiveSystemRouter({ query, pool }) {
  console.log('🔧 Creating TTLive system router...');
  const router = Router();

  console.log('📍 Mounting TTLive routes...');
  router.use('/api/ttlive', createTTLiveRouter({ query, pool }));

  console.log('📍 Mounting Arguments routes...');
  router.use('/api/ttlive/arguments', createArgumentsRouter({ query, pool }));

  console.log('📍 Mounting Conversations routes...');
  router.use('/api/ttlive/conversations', createConversationsRouter({ query, pool }));

  console.log('✅ TTLive system router created');
  return router;
}
