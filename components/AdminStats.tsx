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
                "Son görülme" yalnız oturum açıkken uygulamayı kullananlar için dolar.
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
