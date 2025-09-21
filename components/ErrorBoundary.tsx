import React from 'react';

type ErrorBoundaryState = { error: Error | null; info: React.ErrorInfo | null };

export class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('App crashed:', error, info);
    this.setState({ error, info });
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, fontFamily: 'ui-sans-serif, system-ui, -apple-system' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#b91c1c' }}>Uygulama bir hatayla karşılaştı</h1>
          <p style={{ color: '#334155' }}>{this.state.error.message}</p>
          {this.state.info?.componentStack && (
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 12, borderRadius: 8, color: '#0f172a' }}>
              {this.state.info.componentStack}
            </pre>
          )}
          <p style={{ color: '#64748b' }}>Detaylar için tarayıcı konsoluna bakabilirsiniz.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

