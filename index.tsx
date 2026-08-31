
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
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
