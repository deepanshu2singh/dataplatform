import { PrivacyLink } from './PrivacyLink';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  FileText,
  Database,
  BarChart3,
  Settings,
  LogOut,
  Plus,
  Menu,
  X,
  AlertCircle,
} from 'lucide-react';
import { useState } from 'react';
import { ThemeControl } from './ThemeControl';
import { BrandLogo } from './BrandLogo';
import { getApiErrorMessage } from '../lib/apiError';
import { useUnsavedChangesController } from '../hooks/useUnsavedChanges';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pageTitle = pathname.startsWith('/notebooks') ? 'Notebooks' : pathname.startsWith('/datasets') ? 'Datasets' : pathname.startsWith('/dashboards') ? 'Dashboards' : pathname.startsWith('/settings') ? 'Settings' : 'Workspace';
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const {
    allowNextNavigation,
    cancelNavigationBypass,
    confirmDiscardChanges,
  } = useUnsavedChangesController();

  const handleLogout = async () => {
    setLogoutError('');

    if (!confirmDiscardChanges()) {
      return;
    }

    // Logout mutates the session before navigation. Once the user has explicitly
    // agreed to discard editor changes, permit the redirect without a second
    // unsaved-changes prompt. Restore the guard if logout itself fails.
    allowNextNavigation();

    try {
      await logout();
      navigate('/login');
    } catch (error: unknown) {
      cancelNavigationBypass();
      setLogoutError(getApiErrorMessage(error, 'Logout failed. Please try again.'));
    }
  };

  const navItems = [
    { path: '/', label: 'Home', icon: LayoutDashboard },
    { path: '/notebooks', label: 'Notebooks', icon: FileText },
    { path: '/notebooks/new', label: 'New Notebook', icon: Plus },
    { path: '/datasets', label: 'Datasets', icon: Database },
    { path: '/dashboards', label: 'Dashboards', icon: BarChart3 },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-md bg-white px-3 py-2 text-sm font-medium text-blue-700 shadow focus:not-sr-only focus:fixed focus:left-4 focus:top-4 dark:bg-gray-800 dark:text-blue-300"
      >
        Skip to main content
      </a>
      <aside id="primary-navigation" className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 dark:border-gray-700">
            <NavLink to="/" aria-label="Data Platform home" onClick={() => setSidebarOpen(false)}><BrandLogo /></NavLink>
            <button
              type="button"
              className="lg:hidden p-2 rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation menu"
              aria-controls="primary-navigation"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          <nav className="flex-1 p-4 space-y-1 overflow-y-auto" aria-label="Primary navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/' || item.path === '/notebooks'}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`
                  }
                  onClick={() => setSidebarOpen(false)}
                >
                  <Icon className="w-5 h-5" aria-hidden="true" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            <div className="px-3 pb-2 text-gray-600 dark:text-gray-300"><PrivacyLink /></div>
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  {user?.full_name?.[0] || user?.email?.[0]?.toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {user?.full_name || user?.email}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {user?.email}
                </p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800"
                title="Logout"
                aria-label="Logout"
              >
                <LogOut className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-40 h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between h-full px-4 sm:px-6">
            <button
              type="button"
              className="lg:hidden p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={sidebarOpen}
              aria-controls="primary-navigation"
            >
              <Menu className="w-6 h-6" aria-hidden="true" />
            </button>

            <div className="flex-1 lg:flex-none">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white hidden sm:block">
                {pageTitle}
              </h2>
            </div>
            <ThemeControl />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-8">
          {logoutError && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>{logoutError}</span>
            </div>
          )}
          <Outlet />
        </main>
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
