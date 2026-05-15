import app from './app.js';
import { logger } from './lib/logger.js';
import { startCampaignDispatchScheduler } from './jobs/campaign-dispatch.scheduler.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
	logger.info('server.started', { port: PORT });
	startCampaignDispatchScheduler();
});
