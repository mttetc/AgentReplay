#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fork, exec } from 'child_process';
import { platform, homedir } from 'os';
import { createServer } from 'net';
import { readdir, stat, readFile, writeFile, mkdir, chmod } from 'fs/promises';

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
	// Handle --help
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		console.log(`
  Agent Replay — DevTools for AI Agent Sessions

  Usage:
    agent-replay              Start the dashboard
    agent-replay last         Open the most recent session directly
    agent-replay install-hook Install the smart post-session hook
    agent-replay config       Show hook configuration
    agent-replay config <key> <value>  Set a config value

  Options:
    --no-open                 Don't auto-open the browser
    --port <number>           Set the server port (default: 3000)
    -h, --help                Show this help message
    -v, --version             Show version number

  Providers:
    Claude Code               ~/.claude/projects/
    Cursor                    VS Code Cursor workspace storage
    Windsurf                  Codeium editor storage
    Aider                     ~/.aider.chat.history.md
    GitHub Copilot            VS Code Copilot chat storage

  Environment:
    PORT                      Server port (default: 3000)
    CLAUDE_DIR                Claude Code sessions directory
    DEMO_MODE                 Run with demo data (true/false)
`);
		process.exit(0);
	}

	// Handle --version
	if (process.argv.includes('--version') || process.argv.includes('-v')) {
		const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf-8'));
		console.log(`agent-replay v${pkg.version}`);
		process.exit(0);
	}

	// Handle --port
	const portArgIdx = process.argv.indexOf('--port');
	const portOverride = portArgIdx !== -1 ? parseInt(process.argv[portArgIdx + 1], 10) : null;

	// Read version for display
	const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf-8'));
	const version = pkg.version;

	// Handle `agent-replay last`
	if (subcommand === 'last') {
		const session = await findLastSession();
		if (!session) {
			console.error('  No sessions found');
			process.exit(1);
		}

		const preferredPort = portOverride || parseInt(process.env.PORT || '3000', 10);
		const port = await findFreePort(preferredPort);
		const url = `http://localhost:${port}/sessions/${session.sessionId}?project=${encodeURIComponent(session.project)}&file=${encodeURIComponent(session.filePath)}`;

		console.log(`\n  Agent Replay v${version} — opening last session`);
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

	// Handle `agent-replay install-hook`
	if (subcommand === 'install-hook') {
		const settingsPath = join(homedir(), '.claude', 'settings.json');
		const hookScript = join(__dirname, '..', 'hooks', 'post-session-summary.sh');

		// Ensure hook is executable
		await chmod(hookScript, 0o755);

		// Read or create settings
		let settings = {};
		try {
			settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
		} catch {
			// File doesn't exist yet, start fresh
		}

		// Add hook
		if (!settings.hooks) settings.hooks = {};
		if (!settings.hooks.Stop) settings.hooks.Stop = [];

		// Check if already installed
		const alreadyInstalled = settings.hooks.Stop.some(entry =>
			entry.hooks?.some(h => h.command?.includes('post-session-summary'))
		);

		if (alreadyInstalled) {
			console.log('\n  Hook already installed!\n');
		} else {
			settings.hooks.Stop.push({
				matcher: '',
				hooks: [{
					type: 'command',
					command: hookScript
				}]
			});

			await mkdir(dirname(settingsPath), { recursive: true });
			await writeFile(settingsPath, JSON.stringify(settings, null, 2));

			// Create default config
			const configDir = join(homedir(), '.agent-replay');
			await mkdir(configDir, { recursive: true });
			const configPath = join(configDir, 'hook-config.json');

			// Only write config if it doesn't exist
			try {
				await stat(configPath);
			} catch {
				await writeFile(configPath, JSON.stringify({
					costThreshold: 1.00,
					errorRateThreshold: 20,
					loopThreshold: 3
				}, null, 2));
			}

			console.log(`\n  Hook installed!`);
			console.log(`  Settings: ${settingsPath}`);
			console.log(`  Config: ${configDir}/hook-config.json`);
			console.log(`\n  You'll get notified when sessions have:`);
			console.log('    - Cost > $1.00');
			console.log('    - Error rate > 20%');
			console.log('    - Edit loops on files');
			console.log('\n  Customize thresholds in hook-config.json\n');
		}

		process.exit(0);
	}

	// Handle `agent-replay config [key] [value]`
	if (subcommand === 'config') {
		const configPath = join(homedir(), '.agent-replay', 'hook-config.json');
		const key = process.argv[3];
		const value = process.argv[4];

		// Read config
		let config = { costThreshold: 1.00, errorRateThreshold: 20, loopThreshold: 3 };
		try {
			config = JSON.parse(await readFile(configPath, 'utf-8'));
		} catch {
			// Use defaults
		}

		if (!key) {
			// Show config
			console.log('\n  Agent Replay Configuration\n');
			for (const [k, v] of Object.entries(config)) {
				console.log(`  ${k}: ${v}`);
			}
			console.log(`\n  Path: ${configPath}\n`);
		} else if (value !== undefined) {
			// Set value
			config[key] = isNaN(Number(value)) ? value : Number(value);
			await mkdir(dirname(configPath), { recursive: true });
			await writeFile(configPath, JSON.stringify(config, null, 2));
			console.log(`\n  ${key} = ${config[key]}\n`);
		} else {
			// Show single value
			if (key in config) {
				console.log(`\n  ${key}: ${config[key]}\n`);
			} else {
				console.error(`\n  Unknown key: ${key}`);
				console.error(`  Available: ${Object.keys(config).join(', ')}\n`);
				process.exit(1);
			}
		}

		process.exit(0);
	}

	const preferredPort = portOverride || parseInt(process.env.PORT || '3000', 10);
	const port = await findFreePort(preferredPort);

	console.log(`\n  Agent Replay v${version}`);
	console.log(`  Scanning for sessions...`);
	console.log(`  Providers: Claude Code, Cursor, Windsurf, Aider, Copilot`);
	const claudeDir = join(homedir(), '.claude', 'projects');
	console.log(`  Looking in ${claudeDir}`);

	if (port !== preferredPort) {
		console.log(`  Port ${preferredPort} is in use, using ${port} instead`);
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
