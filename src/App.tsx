import React from 'react';
import { HostConsole } from './components/console/HostConsole';
import { AudienceApp } from './components/audience/AudienceApp';

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'Unexpected rendering error' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen min-h-[100dvh] bg-[#090B0E] text-slate-100 flex flex-col items-center justify-center p-6 text-center gap-4">
          <div className="max-w-md bg-[#12151B] border border-red-500/40 rounded-xl p-6 space-y-3">
            <div className="text-xs font-bold tracking-widest uppercase text-amber-400">LUMENLINK</div>
            <h1 className="text-lg font-semibold text-white">Display Recovery</h1>
            <p className="text-xs text-slate-300">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold uppercase tracking-wider"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const path = window.location.pathname;
  const joinMatch = path.match(/^\/join(?:\/([^/]+))?\/?$/);

  return (
    <AppErrorBoundary>
      {joinMatch ? (
        <AudienceApp showIdParam={joinMatch[1] ? decodeURIComponent(joinMatch[1]) : undefined} />
      ) : (
        <HostConsole />
      )}
    </AppErrorBoundary>
  );
}
