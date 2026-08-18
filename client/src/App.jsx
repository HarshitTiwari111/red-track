import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { DateRangeProvider } from './components/DateRangePicker.jsx';
import { ViewAsProvider } from './context/ViewAsContext.jsx';
import Layout from './components/Layout.jsx';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Campaigns from './pages/Campaigns.jsx';
import Reports from './pages/Reports.jsx';
import CampaignDetail from './pages/CampaignDetail.jsx';
import Offers from './pages/Offers.jsx';
import Landers from './pages/Landers.jsx';
import Sources from './pages/Sources.jsx';
import Networks from './pages/Networks.jsx';
import ClicksLog from './pages/ClicksLog.jsx';
import Postbacks from './pages/Postbacks.jsx';
import ConversionsLog from './pages/ConversionsLog.jsx';
import ConversionTracking from './pages/ConversionTracking.jsx';
import CapiIntegrations from './pages/CapiIntegrations.jsx';
import PixelDetails from './pages/PixelDetails.jsx';
import Settings from './pages/Settings.jsx';
import Domains from './pages/Domains.jsx';
import FunnelTemplates from './pages/FunnelTemplates.jsx';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="loading-block" style={{ paddingTop: '30vh' }}>
        <span className="spinner" /> Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ViewAsProvider>
          <DateRangeProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/campaigns" element={<Campaigns />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/campaigns/:id" element={<CampaignDetail />} />
              <Route path="/offers" element={<Offers />} />
              <Route path="/landers" element={<Landers />} />
              <Route path="/sources" element={<Sources />} />
              <Route path="/networks" element={<Networks />} />
              <Route path="/clicks" element={<ClicksLog />} />
              <Route path="/conversions" element={<ConversionsLog />} />
              <Route path="/postbacks" element={<Postbacks />} />
              <Route path="/conversion-tracking" element={<ConversionTracking />} />
              <Route path="/capi" element={<CapiIntegrations />} />
              <Route path="/capi/:id" element={<PixelDetails />} />
              <Route path="/funnels" element={<FunnelTemplates />} />
              <Route path="/domains" element={<Domains />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </DateRangeProvider>
        </ViewAsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
