import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBaseUrl } from '../services/authClient';

/**
 * Yalnız uygulama sahibine açık kullanım istatistikleri (/admin).
 * Erişim, Railway'de tanımlı ADMIN_STATS_KEY ile yapılır; anahtar yalnız bu
 * tarayıcıda saklanır.
 */

type Stats = {
  generatedAt: string;
  timezone: string;
  devices: {
    total: number;
    active_1d: number;
    active_7d: number;
    active_30d: number;
    linked_to_account: number;
    new_7d: number;
    new_30d: number;
  };
  platforms: Array<{ platform: string; devices: number }>;
  solves: {
    today: number;
    last_7d: number;
    last_30d: number;
    total: number;
    local_fallback_30d: number;
    failed_30d: number;
    devices_30d: number;
  };
  /** Son 30 günde program oluşturulamayan denemelerin sebep dağılımı. */
  failReasons?: Array<{ reason: string; count: number }>;
  topSolvers?: Array<{
    device_id: string;
    solves: number;
    failed: number;
    today: number;
    last_solve: string | null;
    email: string | null;
    schools: string;
  }>;
  daily: Array<{ day: string; devices: number; solves: number }>;
  accounts: {
    users: number;
    users_7d: number;
    users_30d: number;
    teacher_users: number;
    schools: number;
    schools_with_cloud_data: number;
    published_schedules: number;
    teacher_links: number;
  };
  schools?: Array<{
    id: number;
    name: string;
    created_at: string;
    members: Array<{ email: string; role: string | null }>;
    teachers: number;
    classrooms: number;
    subjects: number;
    data_updated_at: string | null;
    published: boolean;
  }>;
  recentUsers: Array<{
    id: number;
    email: string;
    name: string | null;
    role: string | null;
    created_at: string;
    schools: string;
    last_seen: string | null;
  }>;
};

const KEY_STORAGE = 'ozarik.adminKey';

// Grafik rolleri (dataviz referans paleti, açık yüzey)
const C = {
  surface: '#fcfcfb',
  page: '#f9f9f7',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  series: '#2a78d6',
  seriesHover: '#1c5cab',
  border: 'rgba(11,11,11,0.10)',
};

const nf = new Intl.NumberFormat('tr-TR');
const fmt = (n: number | null | undefined) => nf.format(Number(n) || 0);

const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const fmtDay = (isoDay: string, long = false) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return long
    ? date.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'long' })
    : `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
};

const PLATFORM_LABELS: Record<string, string> = {
  web: 'Web tarayıcı',
  windows: 'Windows (Microsoft Store)',
  android: 'Android (Google Play)',
};

const niceMax = (value: number): number => {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
};

// --- Parçalar ----------------------------------------------------------------

const Card: React.FC<{ title?: string; subtitle?: string; children: React.ReactNode; className?: string }> = ({
  title,
  subtitle,
  children,
  className = '',
}) => (
  <section
    className={`rounded-xl p-4 sm:p-5 ${className}`}
    style={{ background: C.surface, boxShadow: `0 0 0 1px ${C.border}` }}
  >
    {title && (
      <header className="mb-3">
        <h2 className="text-base font-semibold" style={{ color: C.ink }}>{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs" style={{ color: C.ink2 }}>{subtitle}</p>}
      </header>
    )}
    {children}
  </section>
);

/**
 * Sunucudaki teşhisin bulduğu engel türlerinin okunur karşılıkları.
 * Etiketler server/diagnose.py içindeki `blocker` değerleriyle birebir aynı.
 */
const FAIL_REASON_LABELS: Record<string, string> = {
  availability_teacher: 'Bir öğretmenin müsaitliği',
  availability: 'Öğretmen müsaitlikleri (birkaç öğretmen)',
  blocks: "2'li / 3'lü blok dersler",
  fixed: 'Saate sabitlenmiş dersler',
  pinned_teacher: 'Derse sabitlenen öğretmen',
  daily_max: 'Öğretmen günlük ders sınırı',
  max_consec: 'Art arda ders sınırı',
  weekly_max: 'Öğretmen haftalık ders sınırı',
  not_same_day: '"Aynı gün olamaz" kuralı',
  same_day_split: 'Ders aynı gün bölünemiyor',
  gap_limit: 'Öğretmen boşluk sınırı',
  unknown: 'Teşhis sebebi bulamadı',
  timeout: 'Süre doldu, engel bulunamadı',
  quota: 'Sunucu kotası doldu (yedek çözücüyle denendi)',
  crash: 'Beklenmeyen hata (istemci)',
  // Sebep yazılmamış eski kayıtlar: 16 Eylül 2026 öncesi denemeler VE o tarihten
  // sonraki süre aşımları (o zaman süre aşımında teşhis koşmuyordu).
  kaydedilmemis: 'Sebep kaydedilmemiş (eski kayıt; çoğu süre aşımı)',
};

const StatTile: React.FC<{ label: string; value: number; hint?: string }> = ({ label, value, hint }) => (
  <div
    className="rounded-xl px-4 py-3"
    style={{ background: C.surface, boxShadow: `0 0 0 1px ${C.border}` }}
  >
    <div className="text-xs" style={{ color: C.ink2 }}>{label}</div>
    <div className="mt-1 text-2xl font-semibold" style={{ color: C.ink }}>{fmt(value)}</div>
    {hint && <div className="mt-0.5 text-xs" style={{ color: C.muted }}>{hint}</div>}
  </div>
);

type ColumnDatum = { key: string; shortLabel: string; longLabel: string; value: number };

const ColumnChart: React.FC<{ data: ColumnDatum[]; unit: string; ariaLabel: string }> = ({ data, unit, ariaLabel }) => {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const ticks = max % 2 === 0 ? [0, max / 2, max] : [0, max];
  const plotHeight = 150;
  const n = data.length;
  const lastIndex = n - 1;

  return (
    <div role="group" aria-label={ariaLabel}>
      <div className="flex">
        {/* Y ekseni */}
        <div className="relative mr-2 w-7 shrink-0" style={{ height: plotHeight }}>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 text-[11px]"
              style={{ bottom: `${(t / max) * 100}%`, color: C.muted, fontVariantNumeric: 'tabular-nums', transform: 'translateY(50%)' }}
            >
              {fmt(t)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          {/* Izgara */}
          <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: plotHeight }}>
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute inset-x-0"
                style={{ bottom: `${(t / max) * 100}%`, height: 1, background: t === 0 ? C.axis : C.grid }}
              />
            ))}
          </div>

          {/* Sütunlar */}
          <div className="relative flex items-end" style={{ height: plotHeight, gap: 2 }}>
            {data.map((d, i) => {
              const pct = (d.value / max) * 100;
              const isActive = active === i;
              return (
                <div
                  key={d.key}
                  tabIndex={0}
                  aria-label={`${d.longLabel}: ${fmt(d.value)} ${unit}`}
                  className="relative flex h-full min-w-0 flex-1 cursor-default items-end justify-center outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive((cur) => (cur === i ? null : cur))}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive((cur) => (cur === i ? null : cur))}
                >
                  {d.value > 0 && (
                    <div
                      style={{
                        width: '100%',
                        maxWidth: 24,
                        height: `max(${pct}%, 2px)`,
                        background: isActive ? C.seriesHover : C.series,
                        borderRadius: '4px 4px 0 0',
                        transition: 'background 120ms',
                      }}
                    />
                  )}
                  {/* Uç etiketi: yalnız son gün */}
                  {i === lastIndex && d.value > 0 && !isActive && (
                    <span
                      className="pointer-events-none absolute whitespace-nowrap text-[11px] font-medium"
                      style={{ bottom: `calc(${pct}% + 4px)`, color: C.ink2 }}
                    >
                      {fmt(d.value)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Araç ipucu */}
          {active !== null && data[active] && (
            <div
              className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs shadow-lg"
              style={{
                left: `${((active + 0.5) / n) * 100}%`,
                bottom: plotHeight - (data[active].value / max) * plotHeight + 26,
                transform: `translateX(${active < n * 0.15 ? '-15%' : active > n * 0.85 ? '-85%' : '-50%'})`,
                background: C.ink,
                color: '#ffffff',
              }}
            >
              <div className="flex items-center gap-1.5">
                <span style={{ display: 'inline-block', width: 10, height: 2, background: C.series, borderRadius: 1 }} />
                <span className="font-semibold">{fmt(data[active].value)}</span>
                <span style={{ color: '#c3c2b7' }}>{unit}</span>
              </div>
              <div style={{ color: '#c3c2b7' }}>{data[active].longLabel}</div>
            </div>
          )}

          {/* X ekseni */}
          <div className="relative mt-1.5 h-4">
            {data.map((d, i) =>
              i % 5 === 0 || i === lastIndex ? (
                <span
                  key={d.key}
                  className="absolute -translate-x-1/2 whitespace-nowrap text-[11px]"
                  style={{ left: `${((i + 0.5) / n) * 100}%`, color: C.muted, fontVariantNumeric: 'tabular-nums' }}
                >
                  {i === lastIndex ? 'Bugün' : d.shortLabel}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const REVIEW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

const generatePassword = (length = 18): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => REVIEW_ALPHABET[b % REVIEW_ALPHABET.length]).join('');
};

/** Mağaza incelemecileri için Google'sız, e-posta + şifreli hesap. */
const ReviewAccountCard: React.FC<{ adminKey: string; onChanged: () => void }> = ({ adminKey, onChanged }) => {
  const [email, setEmail] = useState('inceleme@ozarik.org');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ email: string; password: string; schoolName: string; schoolId: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/admin/review-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const detail = typeof body?.detail === 'string' ? body.detail : '';
        setError(
          detail === 'email-in-use'
            ? 'Bu e-posta gerçek bir hesaba ait. İnceleme için ayrı, hayali bir e-posta kullanın.'
            : res.status === 422
              ? 'E-posta geçersiz ya da şifre 12 karakterden kısa.'
              : `Kaydedilemedi (${res.status}).`,
        );
        return;
      }
      const body = await res.json();
      setResult({ email: body.email, password, schoolName: body.schoolName, schoolId: body.schoolId });
      setPassword('');
      onChanged();
    } catch {
      setError('Sunucuya ulaşılamadı.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card title="İnceleme hesabı" subtitle="Google Play ve Microsoft incelemecileri için Google'sız giriş">
      <div className="space-y-3 text-sm">
        <p style={{ color: C.ink2 }}>
          E-posta hayali olabilir. Hesap yalnız kendi demo okuluna bağlanır. Kaydetmek önceki şifreyi ve açık inceleme
          oturumlarını geçersiz kılar.
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="inceleme@ozarik.org"
            className="rounded-md border border-slate-300 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Şifre (en az 12 karakter)"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button
              type="button"
              onClick={() => setPassword(generatePassword())}
              className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
            >
              Üret
            </button>
          </div>
          <button
            type="button"
            onClick={save}
            disabled={busy || password.length < 12 || !email.trim()}
            className="rounded-md bg-sky-600 px-4 py-1.5 font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        {result && (
          <div role="status" className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
            <p className="font-medium">Hesap hazır — bu bilgileri mağaza formlarına yapıştırın:</p>
            <p>E-posta: <span className="font-mono">{result.email}</span></p>
            <p className="flex flex-wrap items-center gap-2">
              Şifre: <span className="font-mono">{result.password}</span>
              <button type="button" onClick={() => copy(result.password)} className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-xs">
                {copied ? 'Kopyalandı' : 'Kopyala'}
              </button>
            </p>
            <p>Okul: {result.schoolName} (#{result.schoolId})</p>
            <p className="text-xs">Şifre bu sayfadan çıkınca tekrar gösterilmez; unutursanız yeni şifre kaydedin.</p>
          </div>
        )}
      </div>
    </Card>
  );
};

type QuotaRow = {
  key: string;
  total: number;
  bonus: number;
  requested_at: string | null;
  last_solve_at: string | null;
  email: string | null;
  schools: string;
  used_hour: number;
  used_day: number;
  free_left: number;
};
type QuotaInfo = { hourlyLimit: number; dailyLimit: number; freeTotal: number; rows: QuotaRow[] };

/** Kişi başı sunucu deneme kotası: durum, bekleyen istekler ve ek hak verme. */
const QuotaCard: React.FC<{ adminKey: string }> = ({ adminKey }) => {
  const [info, setInfo] = useState<QuotaInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/admin/solve-quota`, { headers: { 'X-Admin-Key': adminKey } });
      if (!res.ok) throw new Error(String(res.status));
      setInfo(await res.json());
      setError(null);
    } catch (err) {
      setError(`Kota durumu alınamadı (${err instanceof Error ? err.message : 'bağlantı hatası'}).`);
    }
  }, [adminKey]);

  useEffect(() => { void load(); }, [load]);

  const grant = async (row: QuotaRow, bonus: number) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/admin/solve-quota/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
        body: JSON.stringify({ key: row.key, bonus }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await load();
    } catch (err) {
      alert(`Ek hak verilemedi (${err instanceof Error ? err.message : 'bağlantı hatası'}).`);
    }
  };

  const waiting = info?.rows.filter((r) => r.requested_at).length ?? 0;
  return (
    <Card
      title="Sunucu deneme kotası"
      subtitle={info
        ? `İlk ${info.freeTotal} deneme sınırsız, sonra saatte ${info.hourlyLimit} · günde ${info.dailyLimit}${waiting ? ` · ${waiting} limit artışı isteği bekliyor` : ''}`
        : 'Yükleniyor…'}
    >
      {error && <p className="text-sm" style={{ color: C.ink2 }}>{error}</p>}
      {info && info.rows.length === 0 && <p className="text-sm" style={{ color: C.muted }}>Henüz kayıt yok.</p>}
      {info && info.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ color: C.ink2 }}>
                <th className="py-1 pr-4 font-medium">Hesap / cihaz</th>
                <th className="py-1 pr-4 font-medium">Okul</th>
                <th className="py-1 pr-4 font-medium text-right">Toplam</th>
                <th className="py-1 pr-4 font-medium text-right">Başlangıç hakkı</th>
                <th className="py-1 pr-4 font-medium text-right">Son 1 sa / 24 sa</th>
                <th className="py-1 pr-4 font-medium text-right">Ek hak</th>
                <th className="py-1 font-medium">Ek hak ver</th>
              </tr>
            </thead>
            <tbody>
              {info.rows.map((r) => (
                <tr key={r.key} className="border-t" style={{ borderColor: C.grid }}>
                  <td className="py-1.5 pr-4" style={{ color: C.ink }}>
                    {r.email ?? <span style={{ color: C.muted }}>hesapsız · {r.key.replace('device:', '').slice(0, 8)}</span>}
                    {r.requested_at && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900" title={fmtDateTime(r.requested_at)}>
                        artış istiyor
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4" style={{ color: C.ink2 }}>{r.schools || '—'}</td>
                  <td className="py-1.5 pr-4 text-right font-semibold tabular-nums">{fmt(r.total)}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{r.free_left > 0 ? `${fmt(r.free_left)} kaldı` : 'bitti'}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{r.used_hour} / {r.used_day}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{fmt(r.bonus)}</td>
                  <td className="py-1.5 whitespace-nowrap">
                    {[30, 100].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => void grant(r, r.bonus + n)}
                        className="mr-1 rounded border px-2 py-0.5 text-xs hover:bg-slate-50"
                        style={{ borderColor: C.border }}
                      >
                        +{n}
                      </button>
                    ))}
                    {(r.bonus > 0 || r.requested_at) && (
                      <button type="button" onClick={() => void grant(r, 0)} className="text-xs underline" style={{ color: C.ink2 }}>
                        {r.bonus > 0 ? 'sıfırla' : 'isteği kapat'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs" style={{ color: C.muted }}>
        Ek hak, kişinin saatlik/günlük sınırı dolduğunda birer birer harcanır. "Son 1 sa / 24 sa" sunucu yeniden başlayınca sıfırlanır.
      </p>
    </Card>
  );
};

type SchoolRow = NonNullable<Stats['schools']>[number];

const SchoolsCard: React.FC<{ schools: SchoolRow[]; adminKey: string; onChanged: () => void }> = ({
  schools,
  adminKey,
  onChanged,
}) => {
  const [query, setQuery] = useState('');
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr-TR');
    return schools.filter((school) => {
      if (onlyEmpty && school.teachers + school.classrooms + school.subjects > 0) return false;
      if (!needle) return true;
      const haystack = [String(school.id), school.name, ...school.members.map((m) => m.email)]
        .join(' ')
        .toLocaleLowerCase('tr-TR');
      return haystack.includes(needle);
    });
  }, [schools, query, onlyEmpty]);

  // Silinen okullar seçimde kalmasın.
  useEffect(() => {
    const existing = new Set(schools.map((school) => school.id));
    setSelected((prev) => new Set([...prev].filter((id) => existing.has(id))));
  }, [schools]);

  // Destek için salt-okunur dışa aktarma; sunucu her çağrıyı günlüğe yazar.
  const downloadSchool = async (schoolId: number) => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/admin/schools/${schoolId}/export`, {
        headers: { 'X-Admin-Key': adminKey },
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = new Blob([JSON.stringify(await res.json(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `okul-${schoolId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Okul verisi indirilemedi (${err instanceof Error ? err.message : 'bağlantı hatası'}).`);
    }
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((school) => selected.has(school.id));

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllFiltered = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((school) => (allFilteredSelected ? next.delete(school.id) : next.add(school.id)));
      return next;
    });

  const deleteSelected = async () => {
    const targets = schools.filter((school) => selected.has(school.id));
    if (!targets.length) return;
    const lines = targets
      .slice(0, 12)
      .map((school) => `#${school.id} ${school.name} — ${school.teachers} öğretmen, ${school.classrooms} sınıf, ${school.members.length} üye`);
    const more = targets.length > 12 ? `\n… ve ${targets.length - 12} okul daha` : '';
    const typed = window.prompt(
      `${targets.length} okul ve bu okullara ait TÜM veriler kalıcı olarak silinecek: öğretmenler, sınıflar, dersler, ` +
        `programlar, öğretmen bağlantıları ve üyelikler. Geri alınamaz.\n\n${lines.join('\n')}${more}\n\nOnaylamak için SİL yazın:`,
    );
    if ((typed ?? '').trim().toLocaleUpperCase('tr-TR').replace(/İ/g, 'I') !== 'SIL') {
      setMessage({ kind: 'error', text: 'Silme iptal edildi; hiçbir şey silinmedi.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    const failed: string[] = [];
    for (const school of targets) {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/admin/schools/${school.id}`, {
          method: 'DELETE',
          headers: { 'X-Admin-Key': adminKey },
        });
        if (!res.ok && res.status !== 404) failed.push(`#${school.id} (${res.status})`);
      } catch {
        failed.push(`#${school.id} (bağlantı hatası)`);
      }
    }
    setBusy(false);
    setSelected(new Set());
    setMessage(
      failed.length
        ? { kind: 'error', text: `Silinemeyenler: ${failed.join(', ')}` }
        : { kind: 'ok', text: `${targets.length} okul silindi.` },
    );
    onChanged();
  };

  return (
    <Card title="Okullar" subtitle={`Toplam ${fmt(schools.length)} okul · üyeler, bulut verisi ve son güncelleme`}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Okul adı, #numara veya e-posta ara"
          className="min-w-[14rem] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <label className="flex items-center gap-1.5 text-sm" style={{ color: C.ink2 }}>
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />
          Yalnız verisi olmayanlar
        </label>
        <button
          type="button"
          onClick={deleteSelected}
          disabled={busy || selected.size === 0}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Siliniyor…' : `Seçilenleri sil (${selected.size})`}
        </button>
      </div>

      {message && (
        <p
          role="status"
          className={`mb-3 rounded-md px-3 py-2 text-sm ${message.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}
        >
          {message.text}
        </p>
      )}

      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="sticky top-0" style={{ background: C.surface }}>
            <tr style={{ color: C.ink2 }}>
              <th className="py-1.5 pr-2">
                <input
                  type="checkbox"
                  aria-label="Listelenen tüm okulları seç"
                  checked={allFilteredSelected}
                  onChange={toggleAllFiltered}
                />
              </th>
              <th className="py-1.5 pr-3 font-medium">#</th>
              <th className="py-1.5 pr-3 font-medium">Okul</th>
              <th className="py-1.5 pr-3 font-medium">Üyeler</th>
              <th className="py-1.5 pr-3 font-medium">Bulut verisi</th>
              <th className="py-1.5 pr-3 font-medium">Son veri güncellemesi</th>
              <th className="py-1.5 font-medium">Oluşturulma</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3" style={{ color: C.muted }}>Eşleşen okul yok.</td>
              </tr>
            )}
            {filtered.map((school) => {
              const empty = school.teachers + school.classrooms + school.subjects === 0;
              return (
                <tr key={school.id} className="border-t align-top" style={{ borderColor: C.grid }}>
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      aria-label={`${school.name} okulunu seç`}
                      checked={selected.has(school.id)}
                      onChange={() => toggle(school.id)}
                    />
                  </td>
                  <td className="py-1.5 pr-3" style={{ color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{school.id}</td>
                  <td className="py-1.5 pr-3">
                    <span className="font-medium">{school.name}</span>
                    {school.members.length === 0 && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs" style={{ color: C.ink2 }}>üyesiz</span>
                    )}
                    {school.published && (
                      <span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-800">yayında</span>
                    )}
                    {!empty && (
                      <button
                        type="button"
                        onClick={() => void downloadSchool(school.id)}
                        className="ml-2 text-xs underline"
                        style={{ color: C.ink2 }}
                        title="Destek için: okulun verisini uygulamanın içe aktarabildiği JSON olarak indirir"
                      >
                        veriyi indir
                      </button>
                    )}
                  </td>
                  <td className="py-1.5 pr-3" style={{ color: C.ink2 }}>
                    {school.members.length
                      ? school.members.map((m) => (m.role === 'teacher' ? `${m.email} (öğretmen)` : m.email)).join(', ')
                      : '—'}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: empty ? C.muted : C.ink, fontVariantNumeric: 'tabular-nums' }}>
                    {empty ? 'boş' : `${school.teachers} öğretmen · ${school.classrooms} sınıf · ${school.subjects} ders`}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap" style={{ color: C.ink2, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtDateTime(school.data_updated_at)}
                  </td>
                  <td className="py-1.5 whitespace-nowrap" style={{ color: C.ink2, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtDateTime(school.created_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs" style={{ color: C.muted }}>
        Silme kalıcıdır: okulun öğretmen, sınıf, ders ve programları, öğretmen bağlantıları ve üyelikleri birlikte silinir.
      </p>
    </Card>
  );
};

// --- Sayfa -------------------------------------------------------------------

const AdminStats: React.FC = () => {
  const [key, setKey] = useState<string>(() => {
    try {
      return window.localStorage.getItem(KEY_STORAGE) || '';
    } catch {
      return '';
    }
  });
  const [keyInput, setKeyInput] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (adminKey: string) => {
    if (!adminKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/admin/stats`, { headers: { 'X-Admin-Key': adminKey } });
      if (res.status === 401) {
        setError('Anahtar yanlış. Railway\'deki ADMIN_STATS_KEY ile aynı olmalı.');
        setStats(null);
        return;
      }
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        setError(
          body?.detail === 'admin-stats-key-not-configured'
            ? 'Sunucuda ADMIN_STATS_KEY tanımlı değil. Railway → Variables bölümüne ekleyip yeniden dağıtın.'
            : 'İstatistikler için sunucu veritabanı gerekli.',
        );
        return;
      }
      if (!res.ok) {
        setError(`Sunucu hatası (${res.status}).`);
        return;
      }
      setStats((await res.json()) as Stats);
    } catch {
      setError('Sunucuya ulaşılamadı.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (key) void load(key);
  }, [key, load]);

  const saveKey = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    try {
      window.localStorage.setItem(KEY_STORAGE, trimmed);
    } catch {
      // yalnız bu oturum için geçerli olur
    }
    setKeyInput('');
    setKey(trimmed);
  };

  const forgetKey = () => {
    try {
      window.localStorage.removeItem(KEY_STORAGE);
    } catch {
      // yok say
    }
    setKey('');
    setStats(null);
    setError(null);
  };

  const deviceSeries = useMemo<ColumnDatum[]>(
    () => (stats?.daily ?? []).map((d) => ({ key: d.day, shortLabel: fmtDay(d.day), longLabel: fmtDay(d.day, true), value: d.devices })),
    [stats],
  );
  const solveSeries = useMemo<ColumnDatum[]>(
    () => (stats?.daily ?? []).map((d) => ({ key: d.day, shortLabel: fmtDay(d.day), longLabel: fmtDay(d.day, true), value: d.solves })),
    [stats],
  );
  const platformMax = Math.max(1, ...(stats?.platforms ?? []).map((p) => p.devices));

  if (!key) {
    return (
      <main className="min-h-screen px-4 py-10" style={{ background: C.page }}>
        <div className="mx-auto max-w-sm">
          <Card title="Kullanım istatistikleri" subtitle="Yalnız uygulama sahibine açıktır.">
            <form onSubmit={saveKey} className="space-y-3">
              <label className="block text-sm" style={{ color: C.ink2 }}>
                Yönetici anahtarı
                <input
                  type="password"
                  autoComplete="off"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  placeholder="Railway → ADMIN_STATS_KEY"
                />
              </label>
              <button type="submit" className="w-full rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700">
                Göster
              </button>
              <p className="text-xs" style={{ color: C.muted }}>Anahtar yalnız bu tarayıcıda saklanır.</p>
            </form>
          </Card>
        </div>
      </main>
    );
  }

  const s = stats;

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8" style={{ background: C.page, color: C.ink }}>
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Kullanım istatistikleri</h1>
            <p className="mt-1 text-sm" style={{ color: C.ink2 }}>
              {s ? `Son güncelleme: ${fmtDateTime(s.generatedAt)} · Saat dilimi: ${s.timezone}` : 'Yükleniyor…'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void load(key)}
              disabled={loading}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
            >
              {loading ? 'Yenileniyor…' : 'Yenile'}
            </button>
            <button type="button" onClick={forgetKey} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:text-slate-800">
              Anahtarı unut
            </button>
          </div>
        </header>

        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {s && (
          <div className="space-y-5" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 150ms' }}>
            {s.devices.total === 0 && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Sayım yeni başladı. Uygulama açıldıkça ve program oluşturuldukça veriler burada birikecek.
              </p>
            )}

            {/* Cihazlar */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="Bugün aktif cihaz" value={s.devices.active_1d} hint="son 24 saat" />
              <StatTile label="Son 7 gün aktif" value={s.devices.active_7d} hint={`${fmt(s.devices.new_7d)} yeni cihaz`} />
              <StatTile label="Son 30 gün aktif" value={s.devices.active_30d} hint={`${fmt(s.devices.new_30d)} yeni cihaz`} />
              <StatTile label="Toplam cihaz" value={s.devices.total} hint={`${fmt(s.devices.linked_to_account)} tanesi bir hesaba bağlı`} />
            </div>

            {/* Program oluşturma */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="Bugün oluşturulan program" value={s.solves.today} />
              <StatTile label="Son 7 gün" value={s.solves.last_7d} />
              <StatTile
                label="Son 30 gün"
                value={s.solves.last_30d}
                hint={`${fmt(s.solves.devices_30d)} farklı cihazdan`}
              />
              <StatTile
                label="Başarısız (30 gün)"
                value={s.solves.failed_30d}
                hint={`${fmt(s.solves.local_fallback_30d)} kez yedek çözücü devreye girdi`}
              />
            </div>

            {(s.failReasons?.length ?? 0) > 0 && (
              <Card
                title="Program neden oluşmadı"
                subtitle="Son 30 gün · başarısız denemelerde çözücüyü engelleyen kural"
              >
                <ul className="space-y-2">
                  {(s.failReasons ?? []).map((r) => (
                    <li key={r.reason} className="flex items-center justify-between gap-3 text-sm">
                      <span style={{ color: C.ink }}>{FAIL_REASON_LABELS[r.reason] ?? r.reason}</span>
                      <span className="font-semibold tabular-nums" style={{ color: C.ink }}>{fmt(r.count)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {(s.topSolvers?.length ?? 0) > 0 && (
              <Card
                title="En çok deneyen cihazlar"
                subtitle="Son 30 gün · sunucu masrafının kimden geldiği (hesapsız cihazlarda e-posta görünmez)"
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr style={{ color: C.ink2 }}>
                        <th className="py-1 pr-4 font-medium">Hesap / cihaz</th>
                        <th className="py-1 pr-4 font-medium">Okul</th>
                        <th className="py-1 pr-4 font-medium text-right">Deneme</th>
                        <th className="py-1 pr-4 font-medium text-right">Başarısız</th>
                        <th className="py-1 pr-4 font-medium text-right">Bugün</th>
                        <th className="py-1 font-medium">Son deneme</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(s.topSolvers ?? []).map((t) => (
                        <tr key={t.device_id} className="border-t" style={{ borderColor: C.grid }}>
                          <td className="py-1.5 pr-4" style={{ color: C.ink }}>
                            {t.email ?? <span style={{ color: C.muted }}>hesapsız · {t.device_id.slice(0, 8)}</span>}
                          </td>
                          <td className="py-1.5 pr-4" style={{ color: C.ink2 }}>{t.schools || '—'}</td>
                          <td className="py-1.5 pr-4 text-right font-semibold tabular-nums">{fmt(t.solves)}</td>
                          <td className="py-1.5 pr-4 text-right tabular-nums">{fmt(t.failed)}</td>
                          <td className="py-1.5 pr-4 text-right tabular-nums">{fmt(t.today)}</td>
                          <td className="py-1.5 whitespace-nowrap tabular-nums" style={{ color: C.ink2 }}>{fmtDateTime(t.last_solve)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Günlük aktif cihaz" subtitle="Son 30 gün, uygulamayı açan farklı cihaz sayısı">
                <ColumnChart data={deviceSeries} unit="cihaz" ariaLabel="Son 30 günde günlük aktif cihaz sayısı" />
              </Card>
              <Card title="Günlük program oluşturma" subtitle="Son 30 gün, 'Program Oluştur' sayısı">
                <ColumnChart data={solveSeries} unit="program" ariaLabel="Son 30 günde günlük program oluşturma sayısı" />
              </Card>
            </div>

            <details className="rounded-xl bg-white px-4 py-3 text-sm" style={{ boxShadow: `0 0 0 1px ${C.border}` }}>
              <summary className="cursor-pointer" style={{ color: C.ink2 }}>Günlük verileri tablo olarak göster</summary>
              <div className="mt-3 max-h-80 overflow-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr style={{ color: C.ink2 }}>
                      <th className="py-1 pr-4 font-medium">Gün</th>
                      <th className="py-1 pr-4 text-right font-medium">Aktif cihaz</th>
                      <th className="py-1 text-right font-medium">Program</th>
                    </tr>
                  </thead>
                  <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {[...s.daily].reverse().map((d) => (
                      <tr key={d.day} className="border-t" style={{ borderColor: C.grid }}>
                        <td className="py-1 pr-4">{fmtDay(d.day, true)}</td>
                        <td className="py-1 pr-4 text-right">{fmt(d.devices)}</td>
                        <td className="py-1 text-right">{fmt(d.solves)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <div className="grid gap-5 lg:grid-cols-3">
              <Card title="Platform" subtitle="Son 30 günde aktif cihaz">
                {s.platforms.length === 0 ? (
                  <p className="text-sm" style={{ color: C.muted }}>Henüz veri yok.</p>
                ) : (
                  <ul className="space-y-3">
                    {s.platforms.map((p) => (
                      <li key={p.platform}>
                        <div className="flex items-baseline justify-between text-sm">
                          <span style={{ color: C.ink2 }}>{PLATFORM_LABELS[p.platform] ?? p.platform}</span>
                          <span className="font-semibold">{fmt(p.devices)}</span>
                        </div>
                        <div className="mt-1 h-2 w-full rounded" style={{ background: C.grid }}>
                          <div
                            className="h-2"
                            style={{ width: `${(p.devices / platformMax) * 100}%`, background: C.series, borderRadius: '0 4px 4px 0' }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs" style={{ color: C.muted }}>
                  Android sayımı bir sonraki Play sürümüyle başlar.
                </p>
              </Card>

              <Card title="Hesaplar ve okullar" subtitle="Bulut tarafı" className="lg:col-span-2">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                  {[
                    ['Kayıtlı kullanıcı', s.accounts.users, `${fmt(s.accounts.users_7d)} bu hafta`],
                    ['Öğretmen hesabı', s.accounts.teacher_users, `${fmt(s.accounts.teacher_links)} bağlantı`],
                    ['Okul', s.accounts.schools, `${fmt(s.accounts.schools_with_cloud_data)} tanesinde veri var`],
                    ['Yayınlanan program', s.accounts.published_schedules, 'öğretmenlerle paylaşılan'],
                  ].map(([label, value, hint]) => (
                    <div key={String(label)}>
                      <dt style={{ color: C.ink2 }}>{label}</dt>
                      <dd className="mt-0.5 text-xl font-semibold">{fmt(Number(value))}</dd>
                      <dd className="text-xs" style={{ color: C.muted }}>{hint}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </div>

            <QuotaCard adminKey={key} />
            <ReviewAccountCard adminKey={key} onChanged={() => void load(key)} />

            <SchoolsCard schools={s.schools ?? []} adminKey={key} onChanged={() => void load(key)} />

            <Card title="Son kayıt olan kullanıcılar" subtitle="En yeni 25 hesap">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr style={{ color: C.ink2 }}>
                      <th className="py-1.5 pr-4 font-medium">E-posta</th>
                      <th className="py-1.5 pr-4 font-medium">Ad</th>
                      <th className="py-1.5 pr-4 font-medium">Rol</th>
                      <th className="py-1.5 pr-4 font-medium">Okul</th>
                      <th className="py-1.5 pr-4 font-medium">Kayıt</th>
                      <th className="py-1.5 font-medium">Son görülme</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.recentUsers.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-3" style={{ color: C.muted }}>Henüz kayıtlı kullanıcı yok.</td>
                      </tr>
                    )}
                    {s.recentUsers.map((u) => (
                      <tr key={u.id} className="border-t align-top" style={{ borderColor: C.grid }}>
                        <td className="py-1.5 pr-4">{u.email}</td>
                        <td className="py-1.5 pr-4">{u.name || '—'}</td>
                        <td className="py-1.5 pr-4" style={{ color: C.ink2 }}>{u.role === 'teacher' ? 'Öğretmen' : 'Yönetici'}</td>
                        <td className="py-1.5 pr-4" style={{ color: C.ink2 }}>{u.schools || '—'}</td>
                        <td className="py-1.5 pr-4 whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDateTime(u.created_at)}</td>
                        <td className="py-1.5 whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums', color: C.ink2 }}>
                          {fmtDateTime(u.last_seen)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs" style={{ color: C.muted }}>
                "Son görülme": son giriş ya da oturum açıkken uygulamanın son açılışı (5 dakika hassasiyetle).
              </p>
            </Card>

            <p className="text-xs" style={{ color: C.muted }}>
              Sayılanlar: rastgele cihaz kimliği, uygulamanın açılması ve program oluşturma (sınıf/öğretmen sayısı ve çözücü türüyle).
              IP adresi, okul/öğretmen verisi, isim veya e-posta sayım olaylarıyla gönderilmez.
            </p>
          </div>
        )}
      </div>
    </main>
  );
};

export default AdminStats;
