import CampaignsFeaturePage from '../features/campaigns/CampaignsFeaturePage.jsx';
import { useLocation } from 'react-router-dom';
import { CampaignAudienceStudio, CampaignOsLayout, CampaignOverview } from '../features/campaigns/CampaignCommandCenter.jsx';
import { useInternalDarkOverrides } from '../hooks/useInternalDarkOverrides.js';
import './CampaignsPage.css';

export default function CampaignsPage() {
	useInternalDarkOverrides();
	const location = useLocation();
	const isOverview = location.pathname === '/campaigns' || location.pathname === '/campaigns/';
	const isAudienceStudio = location.pathname.startsWith('/campaigns/audiences');
	const isCreator = location.pathname.startsWith('/campaigns/segment');

	return (
		<CampaignOsLayout pathname={location.pathname}>
			{isOverview ? <CampaignOverview /> : null}
			{isAudienceStudio ? <CampaignAudienceStudio /> : null}
			{!isOverview && !isAudienceStudio ? (
				<div className={`campaign-os__legacy${isCreator ? ' campaign-os__legacy--creator' : ''}`}>
					<CampaignsFeaturePage />
				</div>
			) : null}
		</CampaignOsLayout>
	);
}
