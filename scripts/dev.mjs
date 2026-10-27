#!/usr/bin/env node
/** Development: rebuilds the app on change and runs the sync server (http://localhost:8787). */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (args, env = {}) => spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

const build = run(['scripts/build.mjs', '--watch']);
const server = run(['server/src/index.ts'], { RATE_LIMIT: process.env.RATE_LIMIT ?? '0' });

const stop = () => {
  build.kill();
  server.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
