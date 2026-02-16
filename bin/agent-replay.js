#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fork, exec } from 'child_process';
import { platform } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const server = join(__dirname, '..', 'build', 'index.js');

const port = process.env.PORT || '3000';
process.env.PORT = port;
const noOpen = process.argv.includes('--no-open');

const url = `http://localhost:${port}`;

console.log(`\n  Agent Replay`);
console.log(`  Starting on ${url}\n`);

const child = fork(server, { env: { ...process.env, PORT: port } });

if (!noOpen) {
	const openCmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
	setTimeout(() => exec(`${openCmd} ${url}`), 1500);
}

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
