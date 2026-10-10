import { useState, type KeyboardEvent } from 'react';
import { Bell, Database, Info, Mail, Shield, User } from 'lucide-react';

import { useAuth } from '../contexts/AuthContext';

type SettingsTab = 'profile' | 'security' | 'notifications' | 'data';

const tabs = [
  { id: 'profile' as const, label: 'Profile', icon: User },
  { id: 'security' as const, label: 'Security', icon: Shield },
  { id: 'notifications' as const, label: 'Notifications', icon: Bell },
  { id: 'data' as const, label: 'Data', icon: Database },
];

function UnavailableCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="flex items-start gap-3">
        <Info
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400"
          aria-hidden="true"
        />
        <div>
          <h3 className="font-medium text-gray-900 dark:text-white">{title}</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex = index;

    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();

    const nextTab = tabs[nextIndex];
    if (!nextTab) {
      return;
    }

    setActiveTab(nextTab.id);
    document.getElementById(`settings-tab-${nextTab.id}`)?.focus();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Settings
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Account settings are read-only in this V1 interface. Unsupported controls
          are not simulated or presented as completed actions.
        </p>
      </div>

      <div
        role="status"
        className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-200"
      >
        <Info className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
        <span>
          Profile editing, password management, two-factor authentication,
          notification preferences, retention controls, data export, session
          management, and account deletion require backend support that is not
          available in this version.
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav
            className="flex overflow-x-auto"
            role="tablist"
            aria-label="Settings sections"
          >
            {tabs.map((tab, index) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  id={`settings-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`settings-panel-${tab.id}`}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 border-b-2 px-6 py-4 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div
          id={`settings-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeTab}`}
          tabIndex={0}
          className="p-6"
        >
          {activeTab === 'profile' && (
            <div className="space-y-6">
              <div className="flex items-center gap-6">
                <div
                  className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900"
                  aria-hidden="true"
                >
                  <span className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                    {user?.full_name?.[0] ||
                      user?.email?.[0]?.toUpperCase() ||
                      'U'}
                  </span>
                </div>
                <div>
                  <h2 className="text-lg font-medium text-gray-900 dark:text-white">
                    Profile
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Your current account information is shown below.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="settings-full-name"
                    className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Full Name
                  </label>
                  <input
                    id="settings-full-name"
                    type="text"
                    value={user?.full_name || ''}
                    readOnly
                    aria-describedby="settings-profile-readonly"
                    className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-900/40 dark:text-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor="settings-email"
                    className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Email
                  </label>
                  <div className="relative">
                    <Mail
                      className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
                      aria-hidden="true"
                    />
                    <input
                      id="settings-email"
                      type="email"
                      value={user?.email || ''}
                      readOnly
                      aria-describedby="settings-profile-readonly"
                      className="w-full rounded-lg border border-gray-300 bg-gray-50 py-2 pl-10 pr-4 text-gray-900 dark:border-gray-600 dark:bg-gray-900/40 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              <p
                id="settings-profile-readonly"
                className="text-sm text-gray-500 dark:text-gray-400"
              >
                Profile editing is not available in this V1 interface.
              </p>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-4">
              <UnavailableCard
                title="Password management"
                description="Changing your password is not exposed by the current V1 API, so this interface does not pretend to save a password change."
              />
              <UnavailableCard
                title="Two-factor authentication"
                description="Two-factor authentication has not been implemented in the current backend."
              />
              <UnavailableCard
                title="Session management"
                description="The current backend does not expose a session list or a sign-out-all-other-sessions operation."
              />
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="space-y-4">
              <UnavailableCard
                title="Notification preferences"
                description="Email and digest preferences are not stored by the current V1 backend."
              />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No notification preference shown here is persisted or applied.
              </p>
            </div>
          )}

          {activeTab === 'data' && (
            <div className="space-y-4">
              <UnavailableCard
                title="Retention controls"
                description="User-configurable retention policies are not available in the current V1 backend."
              />
              <UnavailableCard
                title="Data export"
                description="A full account export endpoint has not been implemented."
              />
              <UnavailableCard
                title="Account deletion"
                description="Account deletion is not exposed by the current V1 API."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
