import { onSessionChange } from '$lib/server/watcher';

export const GET = async () => {
	let unsubscribe: (() => void) | null = null;
	let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			controller.enqueue(encoder.encode(': connected\n\n'));

			unsubscribe = onSessionChange((event) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
				} catch {
					// Stream already closed
				}
			});

			keepaliveInterval = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': keepalive\n\n'));
				} catch {
					if (keepaliveInterval) clearInterval(keepaliveInterval);
				}
			}, 30_000);
		},
		cancel() {
			if (unsubscribe) unsubscribe();
			if (keepaliveInterval) clearInterval(keepaliveInterval);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive'
		}
	});
};
