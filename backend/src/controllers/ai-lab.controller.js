import {
	listAiLabFixtures,
	createAiLabSession,
	getAiLabSession,
	resetAiLabSession,
	sendAiLabMessage
} from '../services/ai-lab.service.js';

export async function getAiLabFixtures(_req, res, next) {
	try {
		res.json({ ok: true, fixtures: listAiLabFixtures() });
	} catch (error) {
		next(error);
	}
}

export async function postAiLabSession(req, res, next) {
	try {
		const session = await createAiLabSession({
			fixtureKey: req.body?.fixtureKey || req.query?.fixtureKey || 'blank'
		});

		res.status(201).json({ ok: true, session });
	} catch (error) {
		next(error);
	}
}

export async function getAiLabSessionById(req, res, next) {
	try {
		const session = getAiLabSession(req.params.sessionId);

		if (!session) {
			return res.status(404).json({ ok: false, error: 'Sesión de AI Lab no encontrada.' });
		}

		res.json({ ok: true, session });
	} catch (error) {
		next(error);
	}
}

export async function postAiLabSessionMessage(req, res, next) {
	try {
		const session = await sendAiLabMessage(req.params.sessionId, {
			body: req.body?.body || ''
		});

		res.json({ ok: true, session });
	} catch (error) {
		next(error);
	}
}

export async function postAiLabSessionReset(req, res, next) {
	try {
		const session = await resetAiLabSession(req.params.sessionId, {
			fixtureKey: req.body?.fixtureKey || req.query?.fixtureKey
		});

		res.json({ ok: true, session });
	} catch (error) {
		next(error);
	}
}
