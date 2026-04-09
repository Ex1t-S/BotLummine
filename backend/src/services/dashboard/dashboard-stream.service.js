import { randomUUID } from 'node:crypto';
import { publishEvent, subscribeEvent } from '../common/event-bus.service.js';

const clients = new Map();
let unsubscribeInbox = null;

function writeSse(res, event, payload) {
	res.write(`event: ${event}
`);
	res.write(`data: ${JSON.stringify(payload)}

`);
}

export function attachDashboardStream(res) {
	const clientId = randomUUID();
	clients.set(clientId, res);

	writeSse(res, 'ready', { ok: true, clientId });

	res.on('close', () => {
		clients.delete(clientId);
	});

	if (!unsubscribeInbox) {
		unsubscribeInbox = subscribeEvent('dashboard:inbox', (payload) => {
			broadcastDashboardEvent('inbox', payload);
		});
	}

	return clientId;
}

export function detachDashboardStream(clientId) {
	const res = clients.get(clientId);
	if (res) {
		try {
			res.end();
		} catch {
			// no-op
		}
	}
	clients.delete(clientId);
}

export function broadcastDashboardEvent(event, payload) {
	for (const [, res] of clients.entries()) {
		writeSse(res, event, payload);
	}
}

export function publishDashboardInboxEvent(payload) {
	publishEvent('dashboard:inbox', payload);
}
