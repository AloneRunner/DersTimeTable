import React, { Component } from 'react';

type ErrorBoundaryState = { error: Error | null; info: React.ErrorInfo | null; showDetails: boolean };

/** Tarayici eklentisi / otomatik ceviri kaynakli DOM hatasi mi? */
function isDomInterferenceError(error: Error | null): boolean {
  const message = error?.message || '';
  return (
    message.includes('removeChild') ||
    message.includes('insertBefore') ||
    message.includes('not a child of this node') ||
    message.includes('alt ') // Turkce Chrome: "bu dugumun alt ogesi degil"
  );
}

export class ErrorBoundary extends Component<React.PropsWithChildren<{}>, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null, showDetails: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('App crashed:', error, info);
    (this as any).setState({ error, info });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleRetry = () => {
    (this as any).setState({ error: null, info: null, showDetails: false });
  };

  render() {
    const { error, info, showDetails } = this.state;
    if (!error) {
      return (this as any).props.children as React.ReactNode;
    }

    const domIssue = isDomInterferenceError(error);

    return (
      <div
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: 24,
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#b91c1c', margin: '0 0 8px' }}>
          Uygulama bir hatayla karşılaştı
        </h1>

        {domIssue ? (
          <div
            style={{
              background: '#fffbeb',
              border: '1px solid #fcd34d',
              borderRadius: 8,
              padding: 14,
              color: '#78350f',
              lineHeight: 1.6,
              margin: '0 0 16px',
            }}
          >
            <strong>Muhtemel sebep:</strong> Tarayıcınızın otomatik çeviri özelliği veya bir tarayıcı
            eklentisi (çevirmen, Grammarly, reklam engelleyici) sayfanın içeriğini değiştiriyor.
            <br />
            <br />
            <strong>Çözüm:</strong> Adres çubuğundaki çeviri simgesine tıklayıp
            <em> “Bu siteyi asla çevirme”</em> seçeneğini işaretleyin, sonra aşağıdaki
            <em> Sayfayı yenile</em> düğmesine basın. Sorun sürerse sayfayı Gizli Sekmede
            (Ctrl + Shift + N) açmayı deneyin.
          </div>
        ) : (
          <p style={{ color: '#334155', lineHeight: 1.6, margin: '0 0 16px' }}>
            Beklenmeyen bir sorun oluştu. Verileriniz tarayıcınızda saklandığı için kaybolmadı.
            Sayfayı yenilediğinizde kaldığınız yerden devam edebilirsiniz.
          </p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 16px' }}>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              background: '#0369a1',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sayfayı yenile
          </button>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              background: '#fff',
              color: '#0f172a',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Yeniden dene
          </button>
          <button
            type="button"
            onClick={() => (this as any).setState({ showDetails: !showDetails })}
            style={{
              background: 'transparent',
              color: '#64748b',
              border: 'none',
              padding: '10px 8px',
              fontSize: 13,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            {showDetails ? 'Teknik ayrıntıları gizle' : 'Teknik ayrıntıları göster'}
          </button>
        </div>

        {showDetails && (
          <>
            <p style={{ color: '#334155', fontSize: 13, margin: '0 0 6px' }}>{error.message}</p>
            {info?.componentStack && (
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  background: '#f8fafc',
                  padding: 12,
                  borderRadius: 8,
                  color: '#0f172a',
                  fontSize: 12,
                  maxHeight: 240,
                  overflow: 'auto',
                }}
              >
                {info.componentStack}
              </pre>
            )}
            <p style={{ color: '#64748b', fontSize: 12 }}>
              Sorun devam ederse bu ekranın görüntüsünü kaanozarik@gmail.com adresine gönderin.
            </p>
          </>
        )}
      </div>
    );
  }
}
