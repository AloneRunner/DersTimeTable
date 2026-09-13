import { getApiBaseUrl } from './authClient';
import { isNativeApp } from './fileSaver';

/**
 * Anonim kullanım sayımı.
 *
 * Rastgele bir cihaz kimliğiyle yalnız "uygulama açıldı" ve "program
 * oluşturuldu" olayları gönderilir. Okul, öğretmen, ders verisi, isim veya
 * e-posta gönderilmez. Her çağrı sessizce başarısız olabilir; kullanıcının
 * işini hiçbir zaman engellemez.
 */

declare const __APP_BUILD__: string;

type Platform = 'web' | 'windows' | 'android';

const DEVICE_KEY = 'ozarik.device.v1';
const PLATFORM_KEY = 'ozarik.platform.v1';
const LAST_OPEN_KEY = 'ozarik.lastAppOpen.v1';
const SESSION_KEY = 'ozarik.session';
const APP_OPEN_INTERVAL_MS = 12 * 60 * 60 * 1000;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

const safeGet = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Gizli pencere vb.: kimlik bu oturumla sınırlı kalır.
  }
};

const randomId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // aşağıdaki yedeğe düş
  }
  let hex = '';
  for (let i = 0; i < 32; i++) hex += Math.floor(Math.random() * 16).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const getDeviceId = (): string => {
  const existing = safeGet(DEVICE_KEY);
  if (existing && DEVICE_ID_PATTERN.test(existing)) return existing;
  const id = randomId();
  safeSet(DEVICE_KEY, id);
  return id;
};

const detectPlatform = (): Platform => {
  if (isNativeApp()) return 'android';
  try {
    // Microsoft Store paketinin başlangıç adresi bu parametreyle açılır; sonraki
    // gezinmelerde parametre kaybolduğu için ilk görüldüğünde hatırlanır.
    if (new URLSearchParams(window.location.search).get('source') === 'windows-app') {
      safeSet(PLATFORM_KEY, 'windows');
    }
  } catch {
    // yok say
  }
  return safeGet(PLATFORM_KEY) === 'windows' ? 'windows' : 'web';
};

const appBuild = (): string | undefined =>
  typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : undefined;

const isLocalDevelopment = (): boolean => {
  if (isNativeApp()) return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
};

const send = (body: Record<string, unknown>) => {
  if (typeof window === 'undefined' || isLocalDevelopment()) return;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = safeGet(SESSION_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
    void fetch(`${getApiBaseUrl()}/api/app/activity`, {
      method: 'POST',
      headers,
      keepalive: true,
      body: JSON.stringify({
        deviceId: getDeviceId(),
        platform: detectPlatform(),
        appBuild: appBuild(),
        ...body,
      }),
    }).catch(() => {
      // Sayım başarısız olabilir; önemli değil.
    });
  } catch {
    // yok say
  }
};

/** Uygulama açılışını en fazla 12 saatte bir bildirir. */
export const recordAppOpen = () => {
  if (typeof window === 'undefined') return;
  const last = Number(safeGet(LAST_OPEN_KEY) || 0);
  const now = Date.now();
  if (Number.isFinite(last) && last > 0 && now - last < APP_OPEN_INTERVAL_MS) return;
  safeSet(LAST_OPEN_KEY, String(now));
  send({ event: 'app_open' });
};

/**
 * Girişten hemen sonra çağrılır: oturum başlığıyla gönderilen olay, bu cihazın
 * geçmiş anonim sayımlarını hesaba bağlar. 12 saatlik açılış sınırını beklemez.
 */
export const recordSignIn = () => {
  if (typeof window === 'undefined') return;
  safeSet(LAST_OPEN_KEY, String(Date.now()));
  send({ event: 'app_open' });
};

export const recordSolve = (info: {
  solver: 'cpsat' | 'local';
  success: boolean;
  classrooms: number;
  teachers: number;
}) => {
  send({ event: 'solve', ...info });
};
