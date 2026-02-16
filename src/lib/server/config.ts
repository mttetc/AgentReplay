import { env } from '$env/dynamic/private';
import { join } from 'path';
import { homedir } from 'os';

export const CLAUDE_DIR = env.CLAUDE_DIR || join(homedir(), '.claude', 'projects');
export const DEMO_MODE = env.DEMO_MODE === 'true';
