import { createBrowserRouter } from 'react-router-dom';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { OrganizationPage } from '../features/organization/OrganizationPage';
import { Layout } from './Layout';
import { ReconciliationPage } from '../features/reconciliation/ReconciliationPage';
import { HomePage } from './HomePage';
import { PerformancePage } from '../features/performance/PerformancePage';
import { ApprovalsPage } from '../features/approvals/ApprovalsPage';
import { NotFoundPage } from './pages';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        element: <Layout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'organization', element: <OrganizationPage /> },
          { path: 'performance', element: <PerformancePage /> },
          { path: 'reconciliation', element: <ReconciliationPage /> },
          { path: 'approvals', element: <ApprovalsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
