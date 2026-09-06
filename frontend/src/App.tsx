import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { routes } from './components/layout/navigation';
import { DashboardLayout } from './layouts/DashboardLayout';
import ComposePage from './pages/ComposePage';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import ScheduledEmailsPage from './pages/ScheduledEmailsPage';
import SearchPage from './pages/SearchPage';
import SentEmailsPage from './pages/SentEmailsPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <Routes>
      <Route path={routes.login} element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<Navigate to={routes.dashboard} replace />} />
          <Route path={routes.dashboard} element={<DashboardPage />} />
          <Route path={routes.scheduled} element={<ScheduledEmailsPage />} />
          <Route path={routes.sent} element={<SentEmailsPage />} />
        <Route path={routes.search} element={<SearchPage />} />
          <Route path={routes.compose} element={<ComposePage />} />
          <Route path={routes.settings} element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
