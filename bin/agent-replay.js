#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fork } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const server = join(__dirname, '..', 'build', 'index.js');

const port = process.env.PORT || '3000';
process.env.PORT = port;

console.log(`\n  Agent Replay`);
console.log(`  Starting on http://localhost:${port}\n`);

const child = fork(server, { env: { ...process.env, PORT: port } });

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
