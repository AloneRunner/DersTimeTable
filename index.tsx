
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

const AdminStats = React.lazy(() => import('./components/AdminStats'));

// /admin: yalnız sahibine açık kullanım istatistikleri. Tanıtım metni ve
// arama motoru indekslemesi bu sayfada istenmez.
const isAdminRoute = window.location.pathname.replace(/\/+$/, '') === '/admin';
if (isAdminRoute) {
  document.getElementById('hakkinda')?.remove();
  document.title = 'DersTimeTable — Kullanım İstatistikleri';
  const robots = document.createElement('meta');
  robots.name = 'robots';
  robots.content = 'noindex, nofollow';
  document.head.appendChild(robots);
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      {isAdminRoute ? (
        <React.Suspense fallback={<p style={{ padding: 24 }}>Yükleniyor…</p>}>
          <AdminStats />
        </React.Suspense>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </React.StrictMode>
);

// Microsoft Store ve tarayıcı kurulumu için gereken hafif PWA katmanı.
// Servis çalışanı uygulama dosyalarını önbelleğe almaz; yalnızca ağ tamamen
// kesildiğinde açıklayıcı çevrimdışı sayfasını gösterir.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('PWA servis çalışanı kaydedilemedi:', error);
    });
  });
}
