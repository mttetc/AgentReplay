#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fork, exec } from 'child_process';
import { platform } from 'os';
import { createServer } from 'net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const server = join(__dirname, '..', 'build', 'index.js');
const noOpen = process.argv.includes('--no-open');

/** Check if a port is available by trying to listen on it */
function isPortFree(port) {
	return new Promise((resolve) => {
		const srv = createServer();
		srv.once('error', () => resolve(false));
		srv.once('listening', () => {
			srv.close(() => resolve(true));
		});
		srv.listen(port, '127.0.0.1');
	});
}

/** Find a free port starting from the preferred one */
async function findFreePort(preferred) {
	for (let p = preferred; p < preferred + 20; p++) {
		if (await isPortFree(p)) return p;
	}
	throw new Error(`No free port found in range ${preferred}-${preferred + 19}`);
}

async function main() {
	const preferredPort = parseInt(process.env.PORT || '3000', 10);
	const port = await findFreePort(preferredPort);

	if (port !== preferredPort) {
		console.log(`\n  Agent Replay`);
		console.log(`  Port ${preferredPort} is in use, using ${port} instead`);
	} else {
		console.log(`\n  Agent Replay`);
	}

	const url = `http://localhost:${port}`;
	console.log(`  Starting on ${url}\n`);

	const child = fork(server, { env: { ...process.env, PORT: String(port) } });

	if (!noOpen) {
		const openCmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
		setTimeout(() => exec(`${openCmd} ${url}`), 1500);
	}

	child.on('exit', (code) => process.exit(code ?? 0));
	process.on('SIGINT', () => child.kill('SIGINT'));
	process.on('SIGTERM', () => child.kill('SIGTERM'));
}

main().catch((err) => {
	console.error(`  Failed to start: ${err.message}`);
	process.exit(1);
});
