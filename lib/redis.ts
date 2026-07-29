import Redis from "ioredis";

const globalRedis = globalThis as unknown as { mimicaRedis?: Redis };

function createRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  return new Redis(url, {
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  });
}

export const redis = globalRedis.mimicaRedis ?? createRedis();

if (redis && process.env.NODE_ENV !== "production") {
  globalRedis.mimicaRedis = redis;
}
