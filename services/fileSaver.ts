/**
 * Platform-aware dosya kaydetme/paylasma katmani.
 *
 * Tarayicida <a download> ile indirme calisir; Android WebView'de (Capacitor)
 * download attribute'u, blob:/data: indirmeleri ve window.print() sessizce
 * hicbir sey yapmaz. Native tarafta dosyayi Cache dizinine yazip sistem
 * paylasim sayfasini aciyoruz (kaydet / yazdir / gonder oradan secilir).
 */

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const cap: any = (window as any).Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') {
    try {
      return cap.isNativePlatform();
    } catch {
      return Boolean(cap.isNative);
    }
  }
  if (typeof cap.getPlatform === 'function') {
    const platform = cap.getPlatform();
    return platform === 'ios' || platform === 'android';
  }
  return Boolean(cap.isNative);
}

export type SaveResult = 'shared' | 'downloaded';

type SaveOptions = {
  /** Dosya icerigi. */
  blob: Blob;
  /** Uzantisiyla birlikte dosya adi, orn. "ders-programi.pdf". */
  fileName: string;
  /** Paylasim sayfasinda gorunen baslik. */
  title?: string;
};

function base64FromBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Dosya hazirlanamadi.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/** Dosya adini Android dosya sisteminde guvenli hale getirir. */
function sanitizeFileName(name: string): string {
  return name.replace(/[\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'dosya';
}

function downloadInBrowser(blob: Blob, fileName: string): SaveResult {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Safari indirmeyi baslatmadan URL'i geri almamak icin kisa gecikme.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

async function shareOnNative(blob: Blob, fileName: string, title?: string): Promise<SaveResult> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);

  const safeName = sanitizeFileName(fileName);
  const data = await base64FromBlob(blob);

  await Filesystem.writeFile({
    path: safeName,
    data,
    directory: Directory.Cache,
    recursive: true,
  });

  const { uri } = await Filesystem.getUri({ path: safeName, directory: Directory.Cache });

  await Share.share({
    title: title ?? safeName,
    dialogTitle: title ?? 'Dosyayi kaydet veya paylas',
    files: [uri],
  });

  return 'shared';
}

/**
 * Dosyayi calisilan platforma uygun sekilde teslim eder.
 * Web'de indirir, native uygulamada sistem paylasim sayfasini acar.
 */
export async function saveOrShareFile({ blob, fileName, title }: SaveOptions): Promise<SaveResult> {
  if (!isNativeApp()) {
    return downloadInBrowser(blob, fileName);
  }

  try {
    return await shareOnNative(blob, fileName, title);
  } catch (err: any) {
    // Kullanici paylasim sayfasini kapattiysa bu bir hata degil.
    const message = String(err?.message ?? err ?? '');
    if (/cancel/i.test(message) || /abort/i.test(message)) {
      return 'shared';
    }
    throw new Error(`Dosya kaydedilemedi: ${message || 'bilinmeyen hata'}`);
  }
}

/** Metin tabanli disa aktarimlar (JSON vb.) icin kisayol. */
export function saveTextFile(text: string, fileName: string, mimeType = 'application/json'): Promise<SaveResult> {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  return saveOrShareFile({ blob, fileName });
}
