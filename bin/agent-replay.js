#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fork, exec } from 'child_process';
import { platform, homedir } from 'os';
import { createServer } from 'net';
import { readdir, stat } from 'fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const server = join(__dirname, '..', 'build', 'index.js');
const noOpen = process.argv.includes('--no-open');
const subcommand = process.argv[2];

function isPortFree(port) {
	return new Promise((resolve) => {
		const srv = createServer();
		srv.once('error', () => resolve(false));
		srv.once('listening', () => { srv.close(() => resolve(true)); });
		srv.listen(port, '127.0.0.1');
	});
}

async function findFreePort(preferred) {
	for (let p = preferred; p < preferred + 20; p++) {
		if (await isPortFree(p)) return p;
	}
	throw new Error(`No free port found in range ${preferred}-${preferred + 19}`);
}

/** Find the most recent session file across all projects */
async function findLastSession() {
	const claudeDir = join(homedir(), '.claude', 'projects');
	let latest = { time: 0, sessionId: '', project: '', filePath: '' };

	let projectDirs;
	try { projectDirs = await readdir(claudeDir); } catch { return null; }

	for (const projectDir of projectDirs) {
		const projectPath = join(claudeDir, projectDir);
		const s = await stat(projectPath).catch(() => null);
		if (!s?.isDirectory()) continue;

		let files;
		try { files = await readdir(projectPath); } catch { continue; }

		for (const file of files) {
			if (!file.endsWith('.jsonl')) continue;
			const filePath = join(projectPath, file);
			const fileStat = await stat(filePath).catch(() => null);
			if (!fileStat) continue;
			if (fileStat.mtimeMs > latest.time) {
				latest = {
					time: fileStat.mtimeMs,
					sessionId: file.replace('.jsonl', ''),
					project: projectDir.replace(/-/g, '/').replace(/^\//, ''),
					filePath
				};
			}
		}
	}

	return latest.sessionId ? latest : null;
}

async function main() {
	// Handle `agent-replay last`
	if (subcommand === 'last') {
		const session = await findLastSession();
		if (!session) {
			console.error('  No sessions found');
			process.exit(1);
		}

		const preferredPort = parseInt(process.env.PORT || '3000', 10);
		const port = await findFreePort(preferredPort);
		const url = `http://localhost:${port}/sessions/${session.sessionId}?project=${encodeURIComponent(session.project)}&file=${encodeURIComponent(session.filePath)}`;

		console.log(`\n  Agent Replay — opening last session`);
		console.log(`  ${session.project} / ${session.sessionId.slice(0, 8)}`);
		console.log(`  ${url}\n`);

		const child = fork(server, { env: { ...process.env, PORT: String(port) } });
		const openCmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
		setTimeout(() => exec(`${openCmd} "${url}"`), 1500);

		child.on('exit', (code) => process.exit(code ?? 0));
		process.on('SIGINT', () => child.kill('SIGINT'));
		process.on('SIGTERM', () => child.kill('SIGTERM'));
		return;
	}

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
