import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Deliberately avoid dumping arbitrary runtime values to the browser console.
    // Backend/API failures are correlated with X-Request-ID; rendering crashes use
    // this safe recovery screen until a client-side telemetry service is added.
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
        <div role="alert" className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm dark:border-red-900 dark:bg-gray-800">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-500" aria-hidden="true" />
          <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">
            This page ran into an unexpected problem
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Reload the application and try again. If the problem continues, retry the action from the previous page.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Reload application
          </button>
        </div>
      </div>
    );
  }
}
