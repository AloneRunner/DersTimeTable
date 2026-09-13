import React, { useEffect, useRef, useState } from 'react';
import { renderGoogleButton } from '../services/googleAuth';

/** Resmî "Google ile oturum aç" düğmesi. Yüklenemezse nedenini söyler. */
const GoogleSignInButton: React.FC<{ onCredential: (credential: string) => void }> = ({ onCredential }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlerRef = useRef(onCredential);
  handlerRef.current = onCredential;
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let cancelled = false;
    const measured = Math.floor(element.getBoundingClientRect().width || 320);
    const width = Math.min(360, Math.max(220, measured));
    renderGoogleButton(element, (credential) => handlerRef.current(credential), width)
      .then(() => {
        if (!cancelled) setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-full">
      <div ref={containerRef} className="flex min-h-[44px] w-full justify-center" />
      {state === 'loading' && (
        <p className="mt-1 text-center text-sm text-slate-500">Google girişi yükleniyor…</p>
      )}
      {state === 'error' && (
        <p className="mt-1 text-center text-sm text-red-600">
          Google girişi yüklenemedi. İnternet bağlantınızı ve reklam engelleyicinizi kontrol edip sayfayı yenileyin.
        </p>
      )}
    </div>
  );
};

export default GoogleSignInButton;
