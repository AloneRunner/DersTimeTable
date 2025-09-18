import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TimetableData, Schedule } from '../types';
import QRCode from 'qrcode';
import QrScanner from 'qr-scanner';
// Vite bundling of worker
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import qrScannerWorkerUrl from 'qr-scanner/qr-scanner-worker.min.js?url';

QrScanner.WORKER_PATH = qrScannerWorkerUrl as string;

type QrToolsProps = {
  data: TimetableData;
  schedule: Schedule | null;
  onImportText: (text: string) => void;
};

type Mode = 'generate' | 'scan';
type Payload = 'dataOnly' | 'dataAndSchedule';

export const QrTools: React.FC<QrToolsProps> = ({ data, schedule, onImportText }) => {
  const [mode, setMode] = useState<Mode>('generate');
  const [payload, setPayload] = useState<Payload>('dataOnly');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const jsonString = useMemo(() => {
    try {
      if (payload === 'dataAndSchedule' && schedule) {
        return JSON.stringify({ data, schedule });
      }
      return JSON.stringify({ data });
    } catch (e) {
      return '';
    }
  }, [data, schedule, payload]);

  // Generate QR when data changes
  useEffect(() => {
    if (mode !== 'generate') return;
    setError(null);
    const generate = async () => {
      try {
        const text = jsonString;
        if (!text) {
          setQrDataUrl('');
          return;
        }
        // Warn if text is likely too large for reliable QR scanning
        if (text.length > 2000) {
          setError('Uyarı: Veri QR için oldukça büyük. Tarama güvenilirliği düşebilir. "Sadece Veriler" seçeneğini kullanın veya veriyi küçültün.');
        }
        const canvas = canvasRef.current;
        if (!canvas) return;
        await QRCode.toCanvas(canvas, text, { errorCorrectionLevel: 'M', width: 320, margin: 2 });
        const url = canvas.toDataURL('image/png');
        setQrDataUrl(url);
      } catch (e: any) {
        setError(e?.message || 'QR oluşturulamadı');
      }
    };
    generate();
  }, [mode, jsonString]);

  // Setup scanner
  useEffect(() => {
    if (mode !== 'scan') {
      if (scannerRef.current) {
        scannerRef.current.stop();
        scannerRef.current.destroy();
        scannerRef.current = null;
      }
      return;
    }
    setError(null);
    const video = videoRef.current;
    if (!video) return;
    const scanner = new QrScanner(
      video,
      (result) => {
        if (!result) return;
        try {
          onImportText(result.data || String(result));
        } catch (e: any) {
          setError(e?.message || 'Tanınan QR içeriği işlenemedi.');
        }
      },
      { highlightScanRegion: true, highlightCodeOutline: true }
    );
    scannerRef.current = scanner;
    scanner.start().catch((e) => setError('Kamera başlatılamadı: ' + (e?.message || String(e))));

    return () => {
      scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
    };
  }, [mode, onImportText]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMode('generate')}
          className={`px-3 py-1 rounded ${mode === 'generate' ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-700'}`}
        >
          QR Oluştur
        </button>
        <button
          onClick={() => setMode('scan')}
          className={`px-3 py-1 rounded ${mode === 'scan' ? 'bg-sky-600 text-white' : 'bg-slate-200 text-slate-700'}`}
        >
          QR Tara
        </button>
      </div>

      {mode === 'generate' && (
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 space-y-3">
            <label className="block text-sm text-slate-600">İçerik</label>
            <select
              className="border rounded px-2 py-1"
              value={payload}
              onChange={(e) => setPayload(e.target.value as Payload)}
            >
              <option value="dataOnly">Sadece Veriler</option>
              <option value="dataAndSchedule" disabled={!schedule}>Veriler + Program</option>
            </select>
            <p className="text-xs text-slate-500">
              Büyük veriler QR ile paylaşımda sorun yaratabilir. Gerekirse JSON indir seçeneğini kullanın.
            </p>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
          <div className="flex flex-col items-center gap-2">
            <canvas ref={canvasRef} className="border rounded shadow"/>
            {qrDataUrl && (
              <a
                href={qrDataUrl}
                download={payload === 'dataOnly' ? 'veri-qr.png' : 'veri-program-qr.png'}
                className="text-sm text-sky-600 hover:underline"
              >
                QR'ı indir (PNG)
              </a>
            )}
          </div>
        </div>
      )}

      {mode === 'scan' && (
        <div className="flex flex-col gap-3">
          <video ref={videoRef} className="w-full max-w-md rounded border shadow" />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <p className="text-xs text-slate-500">Kameraya erişim izni vermeniz gerekebilir.</p>
        </div>
      )}
    </div>
  );
};

