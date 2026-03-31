import { Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from './layout/DashboardLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import InboxPage from './pages/InboxPage.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import CampaignsPage from './pages/CampaignsPage.jsx';
import AbandonedCartsPage from './pages/AbandonedCartsPage.jsx';
import AiLabPage from './pages/AiLabPage.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';




export default function App() {
	return (
		<Routes>
			<Route path="/login" element={<LoginPage />} />

			<Route
				path="/"
				element={
					<ProtectedRoute>
						<DashboardLayout />
					</ProtectedRoute>
				}
			>
				<Route index element={<Navigate to="/catalog" replace />} />
				<Route path="inbox" element={<InboxPage />} />
				<Route path="catalog" element={<CatalogPage />} />
				<Route path="campaigns" element={<CampaignsPage />} />
				<Route path="abandoned-carts" element={<AbandonedCartsPage />} />
				<Route path="ai-lab" element={<AiLabPage />} />
			</Route>
		</Routes>
	);
}