import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './fileSaver';

/**
 * Google ile giriş.
 *
 * Web ve Windows: Google Identity Services betiği, yalnız giriş ekranı
 * gösterildiğinde yüklenir.
 * Android: Google gömülü WebView içinden girişe izin vermediği için yerel
 * GoogleSignInPlugin (Credential Manager) kullanılır. İkisi de sunucuya aynı
 * web istemci kimliğine yazılmış bir Google ID tokeni verir.
 */

interface NativeGoogleSignInPlugin {
  signIn(options: { webClientId: string; nonce?: string }): Promise<{ idToken: string; email?: string; name?: string }>;
  signOut(): Promise<void>;
}

const NativeGoogleSignIn = registerPlugin<NativeGoogleSignInPlugin>('GoogleSignIn');

const DEFAULT_CLIENT_ID = '138011207344-nb82m06verjm5jmfdfr1unnsbcqg2o1v.apps.googleusercontent.com';

export const GOOGLE_CLIENT_ID: string =
  ((import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || DEFAULT_CLIENT_ID;

type CredentialResponse = { credential?: string };

declare global {
  interface Window {
    google?: any;
  }
}

let loader: Promise<void> | null = null;
let initialized = false;
let currentHandler: ((credential: string) => void) | null = null;

export const loadGoogleIdentity = (): Promise<void> => {
  if (typeof window === 'undefined') return Promise.reject(new Error('no-window'));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.id) resolve();
      else {
        loader = null;
        reject(new Error('google-identity-unavailable'));
      }
    };
    script.onerror = () => {
      loader = null;
      reject(new Error('google-identity-load-failed'));
    };
    document.head.appendChild(script);
  });
  return loader;
};

/** Google düğmesini verilen öğeye çizer. Geri çağırma her çizimde güncellenir. */
export const renderGoogleButton = async (
  element: HTMLElement,
  onCredential: (credential: string) => void,
  width: number,
): Promise<void> => {
  await loadGoogleIdentity();
  currentHandler = onCredential;
  if (!initialized) {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response: CredentialResponse) => {
        if (response?.credential) currentHandler?.(response.credential);
      },
      auto_select: false,
      cancel_on_tap_outside: true,
      ux_mode: 'popup',
      itp_support: true,
    });
    initialized = true;
  }
  element.innerHTML = '';
  window.google.accounts.id.renderButton(element, {
    type: 'standard',
    theme: 'filled_blue',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    logo_alignment: 'left',
    locale: 'tr',
    width,
  });
};

/** Android: yerel hesap seçiciyi açar ve Google ID tokenini döndürür. */
export const signInWithGoogleNative = async (): Promise<string> => {
  const result = await NativeGoogleSignIn.signIn({ webClientId: GOOGLE_CLIENT_ID });
  if (!result?.idToken) throw Object.assign(new Error('Google kimlik bilgisi alınamadı'), { code: 'invalid-response' });
  return result.idToken;
};

/** Çıkışta Google'ın bir sonraki girişte hesabı kendiliğinden seçmesini engeller. */
export const disableGoogleAutoSelect = () => {
  try {
    window.google?.accounts?.id?.disableAutoSelect?.();
  } catch {
    // Betik yüklenmemiş olabilir.
  }
  if (isNativeApp()) {
    void NativeGoogleSignIn.signOut().catch(() => {
      // Temizlenecek oturum yoksa sorun değil.
    });
  }
};
