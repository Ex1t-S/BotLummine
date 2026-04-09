import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
	getAiLabFixtures,
	postAiLabSession,
	getAiLabSessionById,
	postAiLabSessionReset,
	postAiLabSessionMessage
} from '../controllers/ai-lab.controller.js';

const router = Router();

router.use(requireAuth, requireAdmin);
router.get('/fixtures', getAiLabFixtures);
router.post('/sessions', postAiLabSession);
router.get('/sessions/:sessionId', getAiLabSessionById);
router.post('/sessions/:sessionId/reset', postAiLabSessionReset);
router.post('/sessions/:sessionId/messages', postAiLabSessionMessage);

export default router;
