// backend/src/db/redis.js
// Optional Redis client for caching
// Gracefully degrades if Redis is not available
import { createClient } from 'redis';
import logger from '../utils/logger.js';

let redisClient = null;

async function initRedis() {
  // Check if Redis URL is configured
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  // Skip if explicitly disabled
  if (redisUrl === 'disabled') {
    logger.log('⚠️  Redis disabled via REDIS_URL=disabled');
    redisClient = null;
    return null;
  }

  try {
    const client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            logger.log('❌ Redis connection failed after 3 retries, continuing without cache');
            return false; // Stop retrying
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    client.on('error', (err) => {
      logger.error('Redis Client Error:', err);
    });

    client.on('connect', () => {
      logger.log('✅ Redis connected');
    });

    client.on('ready', () => {
      logger.log('✅ Redis ready for commands');
    });

    await client.connect();
    redisClient = client;

    logger.log('✅ Redis cache enabled');
    return client;

  } catch (err) {
    logger.log('⚠️  Redis not available, caching disabled:', err.message);
    logger.log('💡 To enable Redis caching, set REDIS_URL environment variable');
    redisClient = null;
    return null;
  }
}

function getRedisClient() {
  return redisClient;
}

async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    logger.log('✅ Redis connection closed');
  }
}

export { initRedis, getRedisClient, closeRedis };
