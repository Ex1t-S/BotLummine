import CampaignsFeaturePage from '../features/campaigns/CampaignsFeaturePage.jsx';
import { useInternalDarkOverrides } from '../hooks/useInternalDarkOverrides.js';
import './CampaignsPage.css';

export default function CampaignsPage() {
	useInternalDarkOverrides();

	return <CampaignsFeaturePage />;
}
