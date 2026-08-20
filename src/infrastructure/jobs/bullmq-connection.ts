import IORedis from "ioredis";

let sharedConnection: IORedis | null = null;

export function getSharedConnection(redisUrl: string): IORedis {
  if (!sharedConnection) {
    sharedConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });

    sharedConnection.on("error", (err) => {
      // Prevents unhandled rejection; publish-job.ts catches and logs the context.
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[redis] connection error: ${message}\n`);
    });
  }
  return sharedConnection;
}
