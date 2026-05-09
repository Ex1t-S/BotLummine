import app from './app.js';
import { startCampaignDispatchScheduler } from './jobs/campaign-dispatch.scheduler.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
	console.log(`Backend corriendo en http://localhost:${PORT}`);
	startCampaignDispatchScheduler();
});
