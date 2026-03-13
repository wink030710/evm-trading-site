/**
 * PM2 ecosystem file. Run from repo root.
 *
 * Dev (same as "npm run dev" in each app):
 *   pm2 start ecosystem.config.cjs              # both api + web
 *   pm2 start ecosystem.config.cjs --only api   # api only
 *   pm2 start ecosystem.config.cjs --only web  # web only
 *
 * Production API (after: cd apps/api && npm run build):
 *   pm2 start ecosystem.config.cjs --only api-production
 */

module.exports = {
  apps: [
    {
      name: 'api',
      cwd: './apps/api',
      script: './node_modules/.bin/tsx',
      args: 'watch src/index.ts',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
    },
    {
      name: 'web',
      cwd: './apps/web',
      script: './node_modules/.bin/vite',
      args: '--host',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
    },
    {
      name: 'api-production',
      cwd: './apps/api',
      script: 'dist/index.js',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
    },
  ],
}
