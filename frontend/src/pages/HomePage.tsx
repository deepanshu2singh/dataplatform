import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, Database, FileText, Loader2, Plus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { getApiErrorMessage } from '../lib/apiError';
import { isCanceledRequest, useLatestRequest } from '../hooks/useLatestRequest';
interface RecentNotebook { id: number; name: string; description: string | null; created_at: string; updated_at: string | null; }
export function HomePage() {
  const { user } = useAuth();
  const [notebooks, setNotebooks] = useState<RecentNotebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestController = useLatestRequest();
  const [retry, setRetry] = useState(0);
  const loadRecent = () => { setLoading(true); setError(''); setRetry(value => value + 1); };
  useEffect(() => {
    const request = requestController.begin();
    void (async () => {
    try {
      const response = await api.get<RecentNotebook[]>('/notebooks', { signal: request.signal });
      if (request.isCurrent()) setNotebooks([...response.data].sort((a,b) => Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at)).slice(0, 4));
    } catch (err: unknown) {
      if (request.isCurrent() && !isCanceledRequest(err)) setError(getApiErrorMessage(err, 'Could not load recent notebooks.'));
    } finally { if (request.isCurrent()) setLoading(false); request.finish(); }
    })();
  }, [requestController, retry]);
  return <div className="workspace-enter mx-auto max-w-6xl space-y-7">
    <div className="brand-home-panel">
      <img className="brand-home-art" src="/homepage-logo-dark.png" alt="Data Platform — Analytics, data and insights" width="1600" height="500" decoding="async" />
    </div>
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div><p className="eyebrow mb-2">Your workspace</p>
        <h1 className="text-3xl font-semibold leading-tight text-gray-900 dark:text-white sm:text-4xl">Welcome back, {user?.full_name || user?.email?.split('@')[0]}.</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-gray-600 dark:text-gray-300">A clear space for your data, your questions, and your next discovery.</p>
      </div>
      <Link to="/notebooks/new" className="primary-action"><Plus className="h-4 w-4" aria-hidden="true" />New Notebook</Link>
    </div>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section className="workspace-panel overflow-hidden" aria-labelledby="recent-notebooks-heading">
        <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-6 py-5 dark:border-gray-700">
          <div><p className="eyebrow mb-1">Continue your work</p><h2 id="recent-notebooks-heading" className="text-lg font-semibold">Recent notebooks</h2></div>
          <Link to="/notebooks" className="text-sm font-medium text-blue-700 dark:text-blue-300">View all <span aria-hidden="true">↗</span></Link>
        </div>
        {loading ? <div role="status" className="flex min-h-72 items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-300"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading your notebooks…</div>
          : error ? <div role="alert" className="p-6"><p className="text-sm text-red-700 dark:text-red-300">{error}</p><button className="mt-3 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600" onClick={() => void loadRecent()}>Retry recent notebooks</button></div>
          : notebooks.length === 0 ? <div className="flex min-h-72 flex-col items-center justify-center px-6 py-10 text-center"><FileText className="mb-4 h-8 w-8 text-blue-600 dark:text-blue-300" aria-hidden="true" /><h3 className="text-base font-semibold">Your next analysis starts here</h3><p className="mt-2 max-w-sm text-sm leading-6 text-gray-600 dark:text-gray-300">Upload a CSV, then explore it with SQL and browser-side Python in a notebook.</p><Link to="/notebooks" className="mt-5 text-sm font-medium text-blue-700 dark:text-blue-300">Explore notebooks →</Link></div>
          : <div className="divide-y divide-gray-200 dark:divide-gray-700">{notebooks.map(notebook => <Link key={notebook.id} to={`/notebooks/${notebook.id}`} className="flex items-center gap-4 px-6 py-5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"><FileText className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{notebook.name}</h3><p className="mt-1 truncate text-xs text-gray-600 dark:text-gray-300">{notebook.description || 'SQL, Python and notes in one place'}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-gray-600 dark:text-gray-300" aria-hidden="true" />
          </Link>)}</div>}
      </section>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
        <Link to="/datasets" className="group rounded-[20px] border border-gray-200 bg-blue-100 p-6 text-gray-900 transition-transform hover:-translate-y-0.5 dark:border-gray-700 dark:bg-blue-900 dark:text-white">
          <div className="flex items-center justify-between"><Database className="h-6 w-6" aria-hidden="true" /><ArrowRight className="h-5 w-5" aria-hidden="true" /></div>
          <p className="mt-5 text-lg font-semibold">Upload Dataset</p><p className="mt-2 text-sm leading-6 text-gray-700 dark:text-gray-200">Bring in a CSV. Inspect its columns and preview the rows before you begin.</p>
          <span className="mt-5 block text-xs font-semibold">Open datasets</span>
        </Link>
        <Link to="/dashboards/new" className="group rounded-[20px] border border-gray-200 p-6 transition-transform hover:-translate-y-0.5 dark:border-gray-700" style={{ background: 'var(--lavender)', color: '#11120d' }}>
          <div className="flex items-center justify-between"><BarChart3 className="h-6 w-6" aria-hidden="true" /><ArrowRight className="h-5 w-5" aria-hidden="true" /></div>
          <p className="mt-5 text-lg font-semibold">New Dashboard</p><p className="mt-2 text-sm leading-6">Give your findings a home with tables, metrics and charts.</p><span className="mt-5 block text-xs font-semibold">Build a dashboard</span>
        </Link>
      </div>
    </div>
    <section className="workspace-panel flex flex-wrap items-center justify-between gap-5 px-6 py-5">
      <div><h2 className="text-base font-semibold">From a question to an insight</h2><p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">CSV datasets → SQL & browser-side Python → private dashboards.</p></div>
      <Link to="/dashboards" className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">Explore dashboards <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
    </section>
  </div>;
}
