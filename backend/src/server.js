import app from './app.js';
import { startCampaignDispatcher } from './services/campaign-dispatcher.service.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
	console.log(`Backend corriendo en http://localhost:${PORT}`);
	startCampaignDispatcher();
});
