import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TimetableData } from '../types';
import { parseCommands, applyActions } from '../services/commandParser';
import { Modal } from './Modal';

/**
 * Hızlı komut kutusu: form doldurmadan, yazarak ya da mikrofonla veri girme.
 *
 * Komut çözümlemesi tamamen cihazda yapılır (services/commandParser.ts); hiçbir
 * yere istek gitmez. Çözümlenen her işlem önce liste hâlinde gösterilir,
 * kullanıcı "Uygula" demeden veri değişmez.
 */

interface Props {
  data: TimetableData;
  onApply: (next: TimetableData) => void;
}

const FEEDBACK_MAIL = 'kaanozarik@gmail.com';

/** Son uygulanan komutun geri alınabileceği süre. */
const UNDO_WINDOW_MS = 90_000;

const EXAMPLES = [
  '6. sınıf 4 şube',
  'Kaan Özarık fen bilimleri öğretmeni ekle',
  '6. sınıflara fen bilimleri 4 saat',
  '6/A fen dersine Kaan girsin',
  'Kaan salı günü gelmiyor',
  'Ayşe cuma öğleden sonra yok',
];

// Tarayıcı konuşma tanıma arayüzü (Chrome/Edge). Tipler kütüphanede yok, burada
// yalnız kullandığımız alanlar tanımlanıyor.
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

const getSpeechRecognition = (): (new () => SpeechRecognitionLike) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

export const QuickCommandBar: React.FC<Props> = ({ data, onApply }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** Uygula'ya basınca çıkan son onay ekranı. */
  const [confirming, setConfirming] = useState(false);
  /** Uygulamadan önceki veri; "Geri al" bunu geri yükler. */
  const [undoSnapshot, setUndoSnapshot] = useState<TimetableData | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const micSupported = useMemo(() => getSpeechRecognition() !== null, []);

  const result = useMemo(() => parseCommands(text, data), [text, data]);
  const understood = result.lines.filter(l => !l.problem);
  const failed = result.lines.filter(l => l.problem);

  useEffect(() => () => {
    // Bileşen kapanırsa mikrofon açık kalmasın, zamanlayıcı da düşsün.
    try { recognitionRef.current?.stop(); } catch { /* yoksay */ }
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
  }, []);

  const toggleMic = () => {
    setMicError(null);
    if (listening) {
      try { recognitionRef.current?.stop(); } catch { /* yoksay */ }
      setListening(false);
      return;
    }
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setMicError('Bu tarayıcı konuşma tanımayı desteklemiyor. Komutu yazabilirsiniz.');
      return;
    }
    const recognition = new Recognition();
    recognition.lang = 'tr-TR';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      const said = Array.from(event.results as ArrayLike<any>)
        .map((r: any) => r[0]?.transcript || '')
        .join(' ')
        .trim();
      if (said) setText(prev => (prev.trim() ? `${prev.trim()}\n${said}` : said));
    };
    recognition.onerror = (event: any) => {
      const code = event?.error;
      setMicError(
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'Mikrofon izni verilmedi. Tarayıcı adres çubuğundaki izin simgesinden açabilirsiniz.'
          : code === 'no-speech'
            ? 'Ses alınamadı, tekrar deneyin.'
            : 'Mikrofon çalışmadı, komutu yazabilirsiniz.',
      );
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setMicError('Mikrofon başlatılamadı.');
      setListening(false);
    }
  };

  const handleApply = () => {
    if (!result.hasActions) return;
    setConfirming(false);
    setUndoSnapshot(data);
    onApply(applyActions(data, result.actions));
    setDone(`${result.actions.length} işlem uygulandı.`);
    setText('');
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => {
      setUndoSnapshot(null);
      setDone(null);
    }, UNDO_WINDOW_MS);
  };

  const handleUndo = () => {
    if (!undoSnapshot) return;
    onApply(undoSnapshot);
    setUndoSnapshot(null);
    setDone('Geri alındı.');
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    window.setTimeout(() => setDone(null), 4000);
  };

  /** Anlaşılmayan cümleleri hazır bir e-postaya koyar; kullanıcı göndermeden görür. */
  const feedbackHref = () => {
    const lines = failed.map(l => `- ${l.text}  →  ${l.problem}`).join('\n');
    const body = [
      'Merhaba,',
      '',
      'Komut kutusuyla ilgili geri bildirimim:',
      '',
      lines || '(cümlenizi buraya yazın)',
      '',
      '---',
      'Beklediğim sonuç: ',
    ].join('\n');
    return `mailto:${FEEDBACK_MAIL}?subject=${encodeURIComponent('DersTimeTable — komut kutusu geri bildirimi')}&body=${encodeURIComponent(body)}`;
  };

  const undoBar = undoSnapshot ? (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-emerald-700">{done}</span>
      <button
        onClick={handleUndo}
        title="Komutun yaptığı değişiklikleri geri alır. Komuttan sonra formdan yaptığınız değişiklikler varsa onlar da geri gider."
        className="px-2 py-1 rounded border border-emerald-300 bg-white text-emerald-700 text-xs font-medium hover:bg-emerald-50"
      >
        ↩ Geri al
      </button>
    </div>
  ) : (done ? <p className="mt-2 text-sm text-emerald-700">{done}</p> : null);

  if (!open) {
    return (
      <div className="mt-4">
        <button
          onClick={() => setOpen(true)}
          className="w-full sm:w-auto px-4 py-2 rounded-md border border-sky-200 bg-sky-50 text-sky-700 text-sm font-medium hover:bg-sky-100"
        >
          ⌨️ Yazarak {micSupported ? 've konuşarak 🎤 ' : ''}ekle
          <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold align-middle">BETA</span>
        </button>
        {undoBar}
      </div>
    );
  }

  return (
    <div className="mt-4 border border-sky-200 rounded-lg bg-sky-50/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">
            Yazarak veya konuşarak ekle
            <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold align-middle">BETA</span>
          </h3>
          <p className="text-xs text-slate-600 mt-0.5">
            Cümleyi kendi kelimelerinizle yazın. Her satır ayrı bir işlemdir; hiçbir şey onayınız olmadan değişmez.
            Var olan kayıtlarınıza dokunulmaz, yalnız cümlede adı geçenler değişir.
          </p>
        </div>
        <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 text-sm px-2">Kapat</button>
      </div>

      <div className="mt-3 flex gap-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={3}
          placeholder={'Örnek:\n6. sınıf 4 şube\n6/A fen dersine Kaan Özarık girsin'}
          className="flex-1 p-2 border border-slate-300 rounded-md text-sm focus:ring-sky-500 focus:border-sky-500"
        />
        {micSupported && (
          <button
            onClick={toggleMic}
            title={listening ? 'Dinlemeyi durdur' : 'Konuşarak söyle'}
            aria-label={listening ? 'Dinlemeyi durdur' : 'Konuşarak söyle'}
            className={`px-3 rounded-md border text-xl ${listening ? 'bg-red-500 text-white border-red-500 animate-pulse' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
          >
            🎤
          </button>
        )}
      </div>

      {listening && (
        <p className="mt-2 text-xs text-red-600">
          Dinliyorum... Söyleyip bekleyin.
          <span className="block text-slate-500">
            Sesiniz, tarayıcınızın konuşma tanıma servisine gönderilip yazıya çevrilir; bu uygulamanın sunucusuna gitmez.
          </span>
        </p>
      )}
      {micError && <p className="mt-2 text-xs text-amber-700">{micError}</p>}
      {!micSupported && (
        <p className="mt-2 text-xs text-slate-500">
          Bu sürümde mikrofon yok (uygulamanın çalıştığı tarayıcı konuşma tanımayı desteklemiyor).
          Komutu yazarak girebilirsiniz; Chrome veya Edge'de siteyi açarsanız mikrofon düğmesi görünür.
        </p>
      )}

      {!text.trim() && (
        <div className="mt-3">
          <p className="text-xs font-medium text-slate-600 mb-1">Örnek komutlar (tıklayınca kutuya eklenir):</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                onClick={() => setText(prev => (prev.trim() ? `${prev.trim()}\n${ex}` : ex))}
                className="px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {text.trim() && (
        <div className="mt-3 space-y-2">
          {understood.length > 0 && (
            <div className="bg-white border border-emerald-200 rounded-md p-3">
              <p className="text-xs font-semibold text-emerald-800 mb-1">Yapılacaklar</p>
              <ul className="space-y-1">
                {understood.flatMap(line => [
                  ...line.summaries.map((summary, i) => (
                    <li key={`${line.text}-${i}`} className="text-sm text-slate-700 flex gap-2">
                      <span className="text-emerald-600">✓</span>
                      <span>{summary}</span>
                    </li>
                  )),
                  ...(line.warning ? [(
                    <li key={`${line.text}-uyari`} className="text-xs text-amber-700 flex gap-2 pl-5">
                      <span>⚠</span>
                      <span>{line.warning}</span>
                    </li>
                  )] : []),
                ])}
              </ul>
            </div>
          )}

          {failed.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-md p-3">
              <p className="text-xs font-semibold text-amber-800 mb-1">Anlaşılmayan satırlar</p>
              <ul className="space-y-1">
                {failed.map((line, i) => (
                  <li key={`${line.text}-${i}`} className="text-sm text-slate-700">
                    <span className="font-medium">"{line.text}"</span>
                    <span className="block text-xs text-amber-700">{line.problem}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirming(true)}
              disabled={!result.hasActions}
              className="px-4 py-2 rounded-md text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              Uygula ({result.actions.length})
            </button>
            <button
              onClick={() => setText('')}
              className="px-3 py-2 rounded-md text-sm font-medium border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
            >
              Temizle
            </button>
          </div>
        </div>
      )}

      {undoBar}

      <Modal isOpen={confirming} onClose={() => setConfirming(false)} title="Onaylıyor musunuz?">
        <p className="text-sm text-slate-600 mb-3">
          Aşağıdaki {result.actions.length} işlem verilerinize uygulanacak. Listede olmayan hiçbir kayda dokunulmaz.
        </p>
        <ul className="space-y-2">
          {understood.flatMap(line => line.summaries.map((summary, i) => (
            <li key={`onay-${line.text}-${i}`} className="text-sm text-slate-800 flex gap-2 border-b border-slate-100 pb-2">
              <span className="text-emerald-600">✓</span>
              <span>{summary}</span>
            </li>
          )))}
        </ul>
        {understood.some(l => l.warning) && (
          <div className="mt-3 text-xs text-amber-700">
            {understood.filter(l => l.warning).map((l, i) => <p key={`onay-uyari-${i}`}>⚠ {l.warning}</p>)}
          </div>
        )}
        {failed.length > 0 && (
          <p className="mt-3 text-xs text-amber-700">
            {failed.length} satır anlaşılmadı, onlar uygulanmayacak.
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={handleApply}
            className="px-4 py-2 rounded-md text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Evet, uygula
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="px-4 py-2 rounded-md text-sm font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
          >
            Vazgeç
          </button>
          <span className="w-full sm:w-auto sm:ml-auto text-xs text-slate-500 self-center">
            Uyguladıktan sonra "Geri al" ile dönebilirsiniz.
          </span>
        </div>
      </Modal>

      <p className="mt-3 pt-2 border-t border-sky-200 text-xs text-slate-600">
        Bu özellik yeni ve deneme aşamasında. Anlamadığı bir cümle olursa{' '}
        <a href={feedbackHref()} className="text-sky-700 underline font-medium">bize yazın</a>
        {failed.length > 0 ? ' — anlaşılmayan satırlar e-postaya hazır eklenir.' : '.'} Böyle böyle öğreniyor.
      </p>
    </div>
  );
};
