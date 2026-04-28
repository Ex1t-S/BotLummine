import {
	listAiLabFixtures,
	createAiLabSession,
	getAiLabSession,
	resetAiLabSession,
	sendAiLabMessage
} from '../services/ai/ai-lab.service.js';
import { requireRequestWorkspaceId } from '../services/workspaces/workspace-context.service.js';


export async function getAiLabFixtures(_req, res, next) {
	try {
		return res.json({ ok: true, fixtures: listAiLabFixtures() });
	} catch (error) {
		next(error);
	}
}

export async function postAiLabSession(req, res, next) {
	try {
		const session = await createAiLabSession({
			workspaceId: requireRequestWorkspaceId(req),
			fixtureKey: req.body?.fixtureKey || 'blank',
		});
		return res.status(201).json({ ok: true, session });
	} catch (error) {
		next(error);
	}
}

export async function getAiLabSessionById(req, res, next) {
	try {
		const session = await getAiLabSession(req.params.sessionId);
		if (!session) {
			return res.status(404).json({ ok: false, error: 'Sesión no encontrada' });
		}
		return res.json({ ok: true, session });
	} catch (error) {
		next(error);
	}
}

export async function postAiLabSessionReset(req, res, next) {
	try {
		const session = await resetAiLabSession(req.params.sessionId, {
			fixtureKey: req.body?.fixtureKey || null
		});
		return res.json({ ok: true, session });
	} catch (error) {
		next(error);
	}
}

export async function postAiLabSessionMessage(req, res, next) {
	try {
		const session = await sendAiLabMessage(req.params.sessionId, {
			body: req.body?.body || '',
			selectionId: req.body?.selectionId || '',
			action: req.body?.action || ''
		});
		return res.json({ ok: true, session });
	} catch (error) {
		next(error);
	}
}
