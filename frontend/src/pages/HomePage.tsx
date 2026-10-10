import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Database,
  FileText,
  Plus,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const features = [
  {
    icon: FileText,
    title: 'Notebooks',
    description:
      'Create and save SQL and browser-side Python notebooks, document analysis with Markdown, and rerun results against your selected dataset.',
    href: '/notebooks',
  },
  {
    icon: Database,
    title: 'Datasets',
    description:
      'Upload CSV datasets, inspect inferred schema and row previews, and use them from secure SQL, Python, and dashboard widgets.',
    href: '/datasets',
  },
  {
    icon: BarChart3,
    title: 'Dashboards',
    description:
      'Build private dashboards with validated SQL tables, KPI metrics, bar and line charts, pie or donut charts, and safe Markdown notes.',
    href: '/dashboards',
  },
];

const quickActions = [
  { label: 'New Notebook', icon: Plus, href: '/notebooks/new', color: 'blue' },
  { label: 'Upload Dataset', icon: Database, href: '/datasets', color: 'green' },
  { label: 'New Dashboard', icon: BarChart3, href: '/dashboards/new', color: 'purple' },
];

export function HomePage() {
  const { user } = useAuth();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Welcome back, {user?.full_name || user?.email?.split('@')[0]}!
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Your workspace for datasets, secure SQL, browser-side Python, and private analytical dashboards.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {quickActions.map((action) => {
          const Icon = action.icon;
          const colorClasses = {
            blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50',
            green:
              'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/50',
            purple:
              'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50',
          };

          return (
            <Link
              key={action.label}
              to={action.href}
              className={`flex items-center gap-4 rounded-xl border border-gray-200 p-6 transition-colors dark:border-gray-700 ${colorClasses[action.color as keyof typeof colorClasses]}`}
            >
              <div className="rounded-lg bg-white p-3 dark:bg-gray-800">
                <Icon className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium">{action.label}</p>
                <p className="text-sm opacity-75">Get started quickly</p>
              </div>
              <ArrowRight className="ml-auto h-5 w-5 opacity-50" aria-hidden="true" />
            </Link>
          );
        })}
      </div>

      <div>
        <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">
          Capabilities
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;

            return (
              <Link
                key={feature.title}
                to={feature.href}
                className="rounded-xl border border-gray-200 bg-white p-6 transition-colors hover:border-blue-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-700"
              >
                <div className="mb-4 rounded-lg bg-blue-50 p-3 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
                  {feature.title}
                </h3>
                <p className="mb-4 text-gray-600 dark:text-gray-400">
                  {feature.description}
                </p>
                <span className="flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400">
                  Explore <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
