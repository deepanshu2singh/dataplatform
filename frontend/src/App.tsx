import { lazy, Suspense } from 'react';
import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
  useRouteError,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Layout } from './components/Layout';
import { UnsavedChangesProvider } from './components/UnsavedChangesProvider';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { HomePage } from './pages/HomePage';

// Keep the small, commonly used auth/home routes in the initial bundle.
// Feature-heavy protected routes are loaded only when the user navigates to
// them so Monaco, Recharts, notebook runtime helpers, and large page modules do
// not inflate the application's first JavaScript download.
const NotebookPage = lazy(() =>
  import('./pages/NotebookPageEntry').then((module) => ({
    default: module.NotebookPage,
  })),
);
const NotebooksPage = lazy(() =>
  import('./pages/NotebooksPage').then((module) => ({
    default: module.NotebooksPage,
  })),
);
const DatasetsPage = lazy(() =>
  import('./pages/DatasetsPage').then((module) => ({
    default: module.DatasetsPage,
  })),
);
const DashboardsPage = lazy(() =>
  import('./pages/DashboardsPage').then((module) => ({
    default: module.DashboardsPage,
  })),
);
const DashboardViewerPage = lazy(() =>
  import('./pages/DashboardViewerPage').then((module) => ({
    default: module.DashboardViewerPage,
  })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({
    default: module.SettingsPage,
  })),
);

function FullPageLoading() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      role="status"
      aria-live="polite"
      aria-label="Loading page"
    >
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      <span className="sr-only">Loading page...</span>
    </div>
  );
}

function RouteErrorPage() {
  useRouteError();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div
        role="alert"
        className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm dark:border-red-900 dark:bg-gray-800"
      >
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          This page could not be loaded
        </h1>

        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Reload the application and try again.
        </p>

        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Reload application
          </button>

          <button
            type="button"
            onClick={() => {
              window.location.href = '/';
            }}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Go home
          </button>
        </div>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <FullPageLoading />;
  }

  return user ? <>{children}</> : <Navigate to="/login" />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <FullPageLoading />;
  }

  return user ? <Navigate to="/" /> : <>{children}</>;
}

function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <UnsavedChangesProvider>
        <Layout />
      </UnsavedChangesProvider>
    </ProtectedRoute>
  );
}

const router = createBrowserRouter([
  {
    path: '/login',
    errorElement: <RouteErrorPage />,
    element: (
      <PublicRoute>
        <LoginPage />
      </PublicRoute>
    ),
  },
  {
    path: '/register',
    errorElement: <RouteErrorPage />,
    element: (
      <PublicRoute>
        <RegisterPage />
      </PublicRoute>
    ),
  },
  {
    path: '/dashboards/:id/view',
    errorElement: <RouteErrorPage />,
    element: (
      <ProtectedRoute>
        <DashboardViewerPage />
      </ProtectedRoute>
    ),
  },
  {
    element: <ProtectedLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/notebooks', element: <NotebooksPage /> },
      { path: '/notebooks/new', element: <NotebookPage /> },
      { path: '/notebooks/:id', element: <NotebookPage /> },
      { path: '/datasets', element: <DatasetsPage /> },
      { path: '/dashboards', element: <DashboardsPage /> },
      { path: '/dashboards/:id', element: <DashboardsPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
  {
    path: '*',
    errorElement: <RouteErrorPage />,
    element: <Navigate to="/" />,
  },
]);

function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<FullPageLoading />}>
        <RouterProvider router={router} />
      </Suspense>
    </AuthProvider>
  );
}

export default App;
