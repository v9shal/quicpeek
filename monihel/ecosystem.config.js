/**
 * PM2 Ecosystem File — run all processes with one command:
 *
 *   pm2 start ecosystem.config.js
 *   pm2 logs                       # tail all logs
 *   pm2 monit                      # real-time dashboard
 *   pm2 stop all && pm2 delete all # tear down
 *
 * For production, build first:  npm run build
 * Then point script paths to dist/ (already configured below).
 */
module.exports = {
  apps: [
    {
      name: 'monihel-api',
      script: 'dist/api/src/index.js',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
    {
      name: 'monihel-worker-ping',
      script: 'dist/workers/ping/index.js',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PING_WORKER_PORT: 4101,
      },
    },
    {
      name: 'monihel-worker-dbwrite',
      script: 'dist/workers/dbWrite/index.js',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        DBWRITE_WORKER_PORT: 4102,
      },
    },
    {
      name: 'monihel-worker-alert',
      script: 'dist/workers/alert/index.js',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        ALERT_WORKER_PORT: 4103,
      },
    },
    {
      name: 'monihel-worker-digest',
      script: 'dist/workers/digest/index.js',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        DIGEST_WORKER_PORT: 4104,
      },
    },
  ],
}
