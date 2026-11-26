import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'An unexpected application error occurred.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#07150f] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#0d2419] border border-amber-500/30 rounded-xl p-6 text-center space-y-4">
            <h1 className="font-display text-2xl font-bold text-amber-400">POOL MASTER ONLINE</h1>
            <p className="text-sm text-slate-300 break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-lg bg-amber-500 text-slate-950 font-semibold text-sm hover:bg-amber-400 transition-colors"
            >
              Reload Table
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
