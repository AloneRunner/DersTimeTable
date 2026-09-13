import React, { useEffect, useRef, useState } from 'react';
import { renderGoogleButton, signInWithGoogleNative } from '../services/googleAuth';
import { isNativeApp } from '../services/fileSaver';

const GoogleLogo: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

const describeNativeError = (err: any): string | null => {
  const code = err?.code;
  const message = String(err?.message ?? '');
  if (code === 'canceled') return null; // kullanıcı pencereyi kapattı
  if (code === 'no-credential') {
    return 'Bu telefonda Google hesabı bulunamadı. Ayarlar → Hesaplar bölümünden bir Google hesabı ekleyip tekrar deneyin.';
  }
  if (/28444|not set up correctly|developer console/i.test(message)) {
    return 'Google girişi bu uygulama sürümü için henüz etkin değil (imza kaydı eksik). Lütfen destekle iletişime geçin.';
  }
  return `Google girişi başarısız: ${message || 'bilinmeyen hata'}`;
};

/**
 * "Google ile giriş" düğmesi.
 * Web/Windows: Google'ın resmî düğmesi. Android: yerel hesap seçiciyi açan düğme.
 */
const GoogleSignInButton: React.FC<{ onCredential: (credential: string) => void }> = ({ onCredential }) => {
  const native = isNativeApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const handlerRef = useRef(onCredential);
  handlerRef.current = onCredential;
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(native ? 'ready' : 'loading');
  const [nativeBusy, setNativeBusy] = useState(false);
  const [nativeError, setNativeError] = useState<string | null>(null);

  useEffect(() => {
    if (native) return;
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
  }, [native]);

  if (native) {
    const handleNativeSignIn = async () => {
      setNativeBusy(true);
      setNativeError(null);
      try {
        const idToken = await signInWithGoogleNative();
        handlerRef.current(idToken);
      } catch (err) {
        setNativeError(describeNativeError(err));
      } finally {
        setNativeBusy(false);
      }
    };
    return (
      <div className="w-full">
        <button
          type="button"
          onClick={handleNativeSignIn}
          disabled={nativeBusy}
          className="flex w-full items-center justify-center gap-3 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        >
          <GoogleLogo />
          {nativeBusy ? 'Google açılıyor…' : 'Google ile giriş yap'}
        </button>
        {nativeError && <p className="mt-2 text-center text-sm text-red-600">{nativeError}</p>}
      </div>
    );
  }

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
