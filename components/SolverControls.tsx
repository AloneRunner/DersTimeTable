import React from 'react';
import { Tooltip } from './Tooltip';

interface SolverControlsProps {
  solverStrategy: "repair" | "tabu" | "alns" | "cp";
  setSolverStrategy: (strategy: "repair" | "tabu" | "alns" | "cp") => void;
  classicMode: boolean;
  cpUseCustom: boolean;
  setCpUseCustom: (use: boolean) => void;
  cpAllowSplit: boolean;
  setCpAllowSplit: (split: boolean) => void;
  cpEdgeReduce: boolean;
  setCpEdgeReduce: (reduce: boolean) => void;
  cpGapReduce: boolean;
  setCpGapReduce: (reduce: boolean) => void;
  cpGapLimit: 'default' | '1' | '2';
  setCpGapLimit: (limit: 'default' | '1' | '2') => void;
  cpDailyMaxOn: boolean;
  setCpDailyMaxOn: (on: boolean) => void;
  cpDailyMaxVal: string;
  setCpDailyMaxVal: (val: string) => void;
  timeText: string;
  setTimeText: (text: string) => void;
  optTime: number;
  setOptTime: (time: number) => void;
  seedText: string;
  setSeedText: (text: string) => void;
  optSeedRatio: number;
  setOptSeedRatio: (ratio: number) => void;
  tenureText: string;
  setTenureText: (text: string) => void;
  optTabuTenure: number;
  setOptTabuTenure: (tenure: number) => void;
  iterText: string;
  setIterText: (text: string) => void;
  optTabuIter: number;
  setOptTabuIter: (iter: number) => void;
  rngText: string;
  setRngText: (text: string) => void;
  optRngSeed: number;
  setOptRngSeed: (seed: number) => void;
  useDeterministic: boolean;
  setUseDeterministic: (use: boolean) => void;
  optStopFirst: boolean;
  setOptStopFirst: (stop: boolean) => void;
  optDisableLNS: boolean;
  setOptDisableLNS: (disable: boolean) => void;
  optDisableEdge: boolean;
  setOptDisableEdge: (disable: boolean) => void;
  applyProfile: (profile: 'fast' | 'balanced' | 'max' | 'classic') => void;
  saveSettingsAsDefault: () => void;
  showAnalyzer: boolean;
  setShowAnalyzer: (show: boolean) => void;
  showTeacherLoadSummary: boolean;
  setShowTeacherLoadSummary: (show: boolean) => void;
  showTeacherActualLoad: boolean;
  setShowTeacherActualLoad: (show: boolean) => void;
  showHeatmapPanel: boolean;
  setShowHeatmapPanel: (show: boolean) => void;
  showDutyWarnings: boolean;
  setShowDutyWarnings: (show: boolean) => void;
  showDutyCoverage: boolean;
  setShowDutyCoverage: (show: boolean) => void;
}

const SolverControls: React.FC<SolverControlsProps> = ({
  solverStrategy,
  setSolverStrategy,
  classicMode,
  cpUseCustom,
  setCpUseCustom,
  cpAllowSplit,
  setCpAllowSplit,
  cpEdgeReduce,
  setCpEdgeReduce,
  cpGapReduce,
  setCpGapReduce,
  cpGapLimit,
  setCpGapLimit,
  cpDailyMaxOn,
  setCpDailyMaxOn,
  cpDailyMaxVal,
  setCpDailyMaxVal,
  timeText,
  setTimeText,
  optTime,
  setOptTime,
  seedText,
  setSeedText,
  optSeedRatio,
  setOptSeedRatio,
  tenureText,
  setTenureText,
  optTabuTenure,
  setOptTabuTenure,
  iterText,
  setIterText,
  optTabuIter,
  setOptTabuIter,
  rngText,
  setRngText,
  optRngSeed,
  setOptRngSeed,
  useDeterministic,
  setUseDeterministic,
  optStopFirst,
  setOptStopFirst,
  optDisableLNS,
  setOptDisableLNS,
  optDisableEdge,
  setOptDisableEdge,
  applyProfile,
  saveSettingsAsDefault,
  showAnalyzer,
  setShowAnalyzer,
  showTeacherLoadSummary,
  setShowTeacherLoadSummary,
  showTeacherActualLoad,
  setShowTeacherActualLoad,
  showHeatmapPanel,
  setShowHeatmapPanel,
  showDutyWarnings,
  setShowDutyWarnings,
  showDutyCoverage,
  setShowDutyCoverage,
}) => {
  return (
    <div className="space-y-3 text-xs sm:text-sm text-slate-600">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-600">Strateji</span>
        <select
          value={solverStrategy}
          onChange={(e) => setSolverStrategy(e.target.value as 'cp' | 'tabu')}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="cp">CP-SAT (Sunucu)</option>
          <option value="tabu">Tabu (Yerel)</option>
        </select>
      </div>

      {!classicMode && solverStrategy === 'cp' && (
        <div className="space-y-2 border border-slate-200 rounded-md bg-slate-50 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <input
              type="checkbox"
              checked={cpUseCustom}
              onChange={(e) => setCpUseCustom(e.target.checked)}
            />
            <span>CP-SAT özel ayarlar</span>
          </label>
          {cpUseCustom && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={cpAllowSplit}
                  onChange={(e) => setCpAllowSplit(e.target.checked)}
                />
                <Tooltip text="Ders aynı gün içinde araya boşluk girerek bölünebilir. Kapalı tutmak blok/bütünlüğü artırır.">
                  <span className="text-slate-600">Aynı gün parçalanabilir</span>
                </Tooltip>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={cpEdgeReduce}
                  onChange={(e) => setCpEdgeReduce(e.target.checked)}
                />
                <Tooltip text="Öğretmenlerin birinci ve son ders saatlerine yerleşmesini azaltmaya çalışır.">
                  <span className="text-slate-600">Kenar saat azalt</span>
                </Tooltip>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={cpGapReduce}
                  onChange={(e) => setCpGapReduce(e.target.checked)}
                />
                <Tooltip text="Öğretmenlerin gün içindeki boş saatlerini azaltmaya çalışır.">
                  <span className="text-slate-600">Boşlukları azalt</span>
                </Tooltip>
              </label>
              <label className="flex items-center gap-2">
                <Tooltip text="İki ders arasındaki en fazla boş saat. Aşıldığında ceza uygulanır.">
                  <span className="text-slate-600">Gap üst sınırı</span>
                </Tooltip>
                <select
                  value={cpGapLimit}
                  onChange={(e) => setCpGapLimit(e.target.value as 'default' | '1' | '2')}
                  className="border rounded px-2 py-1 text-sm"
                >
                  <option value="default">Varsayılan</option>
                  <option value="1">1 saat</option>
                  <option value="2">2 saat</option>
                </select>
              </label>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={cpDailyMaxOn}
                  onChange={(e) => setCpDailyMaxOn(e.target.checked)}
                />
                <Tooltip text="Öğretmene bir günde verilebilecek en fazla ders saati.">
                  <span className="text-slate-600">Günlük maksimum saat</span>
                </Tooltip>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={cpDailyMaxVal}
                  onChange={(e) => setCpDailyMaxVal(e.target.value)}
                  className="w-16 border rounded px-2 py-1 text-sm"
                />
              </label>
            </div>
          )}
        </div>
      )}

      {solverStrategy === 'tabu' && (
        <p className="text-xs text-slate-500 border border-slate-200 rounded-md p-3 bg-white">
          Tabu stratejisi mobilde varsayılan parametrelerle çalışır. Ayrıntılı seçenekler yakında eklenecek.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-medium text-slate-600">Süre (sn)</span>
          <input
            value={timeText}
            onChange={(e) => setTimeText(e.target.value)}
            onBlur={() => {
              const v = Math.max(10, Math.min(600, parseInt(timeText) || optTime));
              setOptTime(v);
              setTimeText(String(v));
            }}
            inputMode="numeric"
            pattern="[0-9]*"
            type="text"
            className="border rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-slate-600">Seed</span>
          <input
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            onBlur={() => {
              const v = Math.max(0.05, Math.min(0.5, parseFloat(seedText) || optSeedRatio));
              setOptSeedRatio(Number(v.toFixed(2)));
              setSeedText(String(Number(v.toFixed(2))));
            }}
            type="text"
            inputMode="decimal"
            className="border rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-slate-600">Tenure</span>
          <input
            value={tenureText}
            onChange={(e) => setTenureText(e.target.value)}
            onBlur={() => {
              const v = Math.max(5, Math.min(300, parseInt(tenureText) || optTabuTenure));
              setOptTabuTenure(v);
              setTenureText(String(v));
            }}
            type="text"
            inputMode="numeric"
            className="border rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-slate-600">Iter</span>
          <input
            value={iterText}
            onChange={(e) => setIterText(e.target.value)}
            onBlur={() => {
              const v = Math.max(100, Math.min(10000, parseInt(iterText) || optTabuIter));
              setOptTabuIter(v);
              setIterText(String(v));
            }}
            type="text"
            inputMode="numeric"
            className="border rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium text-slate-600">RNG</span>
          <input
            value={rngText}
            onChange={(e) => setRngText(e.target.value)}
            onBlur={() => {
              const v = parseInt(rngText);
              if (!Number.isNaN(v)) setOptRngSeed(v);
              setRngText(String(Number.isNaN(v) ? (rngText || '') : v));
            }}
            placeholder="seed"
            type="text"
            inputMode="numeric"
            className="border rounded px-2 py-1 text-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={useDeterministic} onChange={(e) => setUseDeterministic(e.target.checked)} />
          <Tooltip text="İşaretliyken randomSeed gönderilir; aynı parametrelerle aynı sonuçları üretir.">
            <span className="text-slate-600">Deterministik</span>
          </Tooltip>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={optStopFirst} onChange={(e) => setOptStopFirst(e.target.checked)} />
          <Tooltip text="İlk uygun çözüm bulunduğunda hemen durur (hızlı denemeler için).">
            <span className="text-slate-600">StopFirst</span>
          </Tooltip>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={optDisableLNS} onChange={(e) => setOptDisableLNS(e.target.checked)} />
          <Tooltip text="Ruin & Recreate iyileştirmesini kapatır; daha klasik davranış.">
            <span className="text-slate-600">LNS kapalı</span>
          </Tooltip>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={optDisableEdge} onChange={(e) => setOptDisableEdge(e.target.checked)} />
          <Tooltip text="Öğretmenin gün başı/sonu ve tekli saat cezalarını kapatır.">
            <span className="text-slate-600">Kenar cezası kapalı</span>
          </Tooltip>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tooltip text="45 sn, seed 0.12, tenure 60, iter 2500, StopFirst açık">
          <button onClick={() => applyProfile('fast')} className="px-2 py-1 border rounded text-slate-600 hover:bg-slate-50">Hızlı</button>
        </Tooltip>
        <Tooltip text="90 sn, seed 0.12, tenure 70, iter 3000">
          <button onClick={() => applyProfile('balanced')} className="px-2 py-1 border rounded text-slate-600 hover:bg-slate-50">Dengeli</button>
        </Tooltip>
        <Tooltip text="150 sn, seed 0.12, tenure 80, iter 3500">
          <button onClick={() => applyProfile('max')} className="px-2 py-1 border rounded text-slate-600 hover:bg-slate-50">Maks</button>
        </Tooltip>
        <Tooltip text="Ayarları başlangıçta otomatik yüklensin diye kaydeder.">
          <button onClick={saveSettingsAsDefault} className="px-2 py-1 border rounded text-emerald-600 hover:bg-emerald-50">Varsayılan Yap</button>
        </Tooltip>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showAnalyzer} onChange={(e) => setShowAnalyzer(e.target.checked)} />
          <span>Analiz aracı</span>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showTeacherLoadSummary} onChange={(e) => setShowTeacherLoadSummary(e.target.checked)} />
          <span>Öğretmen yük analizi</span>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showTeacherActualLoad} onChange={(e) => setShowTeacherActualLoad(e.target.checked)} />
          <span>Gerçekleşen yük</span>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showHeatmapPanel} onChange={(e) => setShowHeatmapPanel(e.target.checked)} />
          <span>Gün / saat analizi</span>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showDutyWarnings} onChange={(e) => setShowDutyWarnings(e.target.checked)} />
          <span>Paylaşılan ders uyarıları</span>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showDutyCoverage} onChange={(e) => setShowDutyCoverage(e.target.checked)} />
          <span>Nöbetçi yardımcısı</span>
        </label>
      </div>
    </div>
  );
};

export default SolverControls;
