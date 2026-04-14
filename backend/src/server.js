import app from './app.js';
import { startCampaignDispatcher } from './services/campaigns/campaign-dispatcher.service.js';
import { startEnboxSyncScheduler } from './services/enbox/enbox-sync.service.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
	console.log(`Backend corriendo en http://localhost:${PORT}`);
	startCampaignDispatcher();
	startEnboxSyncScheduler();
});
