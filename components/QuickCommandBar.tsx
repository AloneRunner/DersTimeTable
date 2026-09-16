import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TimetableData } from '../types';
import { parseCommands, applyActions } from '../services/commandParser';

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
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const micSupported = useMemo(() => getSpeechRecognition() !== null, []);

  const result = useMemo(() => parseCommands(text, data), [text, data]);
  const understood = result.lines.filter(l => !l.problem);
  const failed = result.lines.filter(l => l.problem);

  useEffect(() => () => {
    // Bileşen kapanırsa mikrofon açık kalmasın.
    try { recognitionRef.current?.stop(); } catch { /* yoksay */ }
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
    onApply(applyActions(data, result.actions));
    setDone(`${result.actions.length} işlem uygulandı.`);
    setText('');
    window.setTimeout(() => setDone(null), 4000);
  };

  if (!open) {
    return (
      <div className="mt-4">
        <button
          onClick={() => setOpen(true)}
          className="w-full sm:w-auto px-4 py-2 rounded-md border border-sky-200 bg-sky-50 text-sky-700 text-sm font-medium hover:bg-sky-100"
        >
          ⌨️ Yazarak / konuşarak ekle {micSupported ? '🎤' : ''}
        </button>
        {done && <p className="mt-2 text-sm text-emerald-700">{done}</p>}
      </div>
    );
  }

  return (
    <div className="mt-4 border border-sky-200 rounded-lg bg-sky-50/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Yazarak veya konuşarak ekle</h3>
          <p className="text-xs text-slate-600 mt-0.5">
            Cümleyi kendi kelimelerinizle yazın. Her satır ayrı bir işlemdir; hiçbir şey onayınız olmadan değişmez.
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

      {listening && <p className="mt-2 text-xs text-red-600">Dinliyorum... Söyleyip bekleyin.</p>}
      {micError && <p className="mt-2 text-xs text-amber-700">{micError}</p>}

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
                {understood.flatMap(line =>
                  line.summaries.map((summary, i) => (
                    <li key={`${line.text}-${i}`} className="text-sm text-slate-700 flex gap-2">
                      <span className="text-emerald-600">✓</span>
                      <span>{summary}</span>
                    </li>
                  )),
                )}
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
              onClick={handleApply}
              disabled={!result.hasActions}
              className="px-4 py-2 rounded-md text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              Uygula
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

      {done && <p className="mt-2 text-sm text-emerald-700">{done}</p>}
    </div>
  );
};
