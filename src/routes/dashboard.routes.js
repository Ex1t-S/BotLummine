import { Router } from 'express';
import { attachUser, requireAuth } from '../middleware/auth.js';
import {
	getDashboard,
	getConversation,
	sendManualReply,
	toggleConversationAi,
	getAiLab,
	testAi,
	simulateInbound
} from '../controllers/dashboard.controller.js';

const router = Router();

router.use(attachUser, requireAuth);

router.get('/', getDashboard);
router.get('/ai-lab', getAiLab);
router.post('/ai-lab/test', testAi);

router.get('/conversations/:id', getConversation);
router.post('/conversations/:id/reply', sendManualReply);
router.post('/conversations/:id/toggle-ai', toggleConversationAi);

router.post('/simulate-inbound', simulateInbound);

export default router;