import { useState, useEffect, useCallback } from 'react';
import { SchoolLevel } from '../types';

interface SolverSettings {
    optTime: number;
    setOptTime: React.Dispatch<React.SetStateAction<number>>;
    optSeedRatio: number;
    setOptSeedRatio: React.Dispatch<React.SetStateAction<number>>;
    optTabuTenure: number;
    setOptTabuTenure: React.Dispatch<React.SetStateAction<number>>;
    optTabuIter: number;
    setOptTabuIter: React.Dispatch<React.SetStateAction<number>>;
    classicMode: boolean;
    setClassicMode: React.Dispatch<React.SetStateAction<boolean>>;
    timeText: string;
    setTimeText: React.Dispatch<React.SetStateAction<string>>;
    seedText: string;
    setSeedText: React.Dispatch<React.SetStateAction<string>>;
    tenureText: string;
    setTenureText: React.Dispatch<React.SetStateAction<string>>;
    iterText: string;
    setIterText: React.Dispatch<React.SetStateAction<string>>;
    optStopFirst: boolean;
    setOptStopFirst: React.Dispatch<React.SetStateAction<boolean>>;
    useDeterministic: boolean;
    setUseDeterministic: React.Dispatch<React.SetStateAction<boolean>>;
    optRngSeed: number;
    setOptRngSeed: React.Dispatch<React.SetStateAction<number>>;
    rngText: string;
    setRngText: React.Dispatch<React.SetStateAction<string>>;
    optDisableLNS: boolean;
    setOptDisableLNS: React.Dispatch<React.SetStateAction<boolean>>;
    solverStrategy: "repair" | "tabu" | "alns" | "cp";
    setSolverStrategy: React.Dispatch<React.SetStateAction<"repair" | "tabu" | "alns" | "cp">>;
    optDisableEdge: boolean;
    setOptDisableEdge: React.Dispatch<React.SetStateAction<boolean>>;
    cpUseCustom: boolean;
    setCpUseCustom: React.Dispatch<React.SetStateAction<boolean>>;
    cpAllowSplit: boolean;
    setCpAllowSplit: React.Dispatch<React.SetStateAction<boolean>>;
    cpEdgeReduce: boolean;
    setCpEdgeReduce: React.Dispatch<React.SetStateAction<boolean>>;
    cpGapReduce: boolean;
    setCpGapReduce: React.Dispatch<React.SetStateAction<boolean>>;
    cpGapLimit: 'default' | '1' | '2';
    setCpGapLimit: React.Dispatch<React.SetStateAction<'default' | '1' | '2'> hints: string[]>;
    cpDailyMaxOn: boolean;
    setCpDailyMaxOn: React.Dispatch<React.SetStateAction<boolean>>;
    cpDailyMaxVal: string;
    setCpDailyMaxVal: React.Dispatch<React.SetStateAction<string>>;
    cpHelpOpen: boolean;
    setCpHelpOpen: React.Dispatch<React.SetStateAction<boolean>>;
    defaultMaxConsec: number | undefined;
    setDefaultMaxConsec: React.Dispatch<React.SetStateAction<number | undefined>>;
    saveSettingsAsDefault: () => void;
    applyProfile: (p: 'fast' | 'balanced' | 'max' | 'classic') => void;
}

export const useSolverSettings = (): SolverSettings => {
    const [optTime, setOptTime] = useState<number>(150);
    const [optSeedRatio, setOptSeedRatio] = useState<number>(0.15);
    const [optTabuTenure, setOptTabuTenure] = useState<number>(50);
    const [optTabuIter, setOptTabuIter] = useState<number>(2000);
    const [classicMode, setClassicMode] = useState<boolean>(false);
    const [timeText, setTimeText] = useState<string>(String(optTime));
    const [seedText, setSeedText] = useState<string>(String(optSeedRatio));
    const [tenureText, setTenureText] = useState<string>(String(optTabuTenure));
    const [iterText, setIterText] = useState<string>(String(optTabuIter));
    const [optStopFirst, setOptStopFirst] = useState<boolean>(true);
    const [useDeterministic, setUseDeterministic] = useState<boolean>(false);
    const [optRngSeed, setOptRngSeed] = useState<number>(1337);
    const [rngText, setRngText] = useState<string>('1337');
    const [optDisableLNS, setOptDisableLNS] = useState<boolean>(true);
    const [solverStrategy, setSolverStrategy] = useState<"repair" | "tabu" | "alns" | "cp">("cp");
    const [optDisableEdge, setOptDisableEdge] = useState<boolean>(true);
    const [cpUseCustom, setCpUseCustom] = useState<boolean>(false);
    const [cpAllowSplit, setCpAllowSplit] = useState<boolean>(false);
    const [cpEdgeReduce, setCpEdgeReduce] = useState<boolean>(false);
    const [cpGapReduce, setCpGapReduce] = useState<boolean>(false);
    const [cpGapLimit, setCpGapLimit] = useState<'default' | '1' | '2'>('default');
    const [cpDailyMaxOn, setCpDailyMaxOn] = useState<boolean>(false);
    const [cpDailyMaxVal, setCpDailyMaxVal] = useState<string>('6');
    const [cpHelpOpen, setCpHelpOpen] = useState<boolean>(false);
    const [defaultMaxConsec, setDefaultMaxConsec] = useState<number | undefined>(3);

    // Load persisted CP-SAT toggles
    useEffect(() => {
        try {
            const raw = localStorage.getItem('cp_prefs');
            if (raw) {
                const p = JSON.parse(raw);
                if (typeof p.useCustom === 'boolean') setCpUseCustom(p.useCustom);
                if (typeof p.allowSplit === 'boolean') setCpAllowSplit(p.allowSplit);
                if (typeof p.edgeReduce === 'boolean') setCpEdgeReduce(p.edgeReduce);
                if (typeof p.gapReduce === 'boolean') setCpGapReduce(p.gapReduce);
                if (p.gapLimit === '1' || p.gapLimit === '2' || p.gapLimit === 'default') setCpGapLimit(p.gapLimit);
                if (typeof p.dailyMaxOn === 'boolean') setCpDailyMaxOn(p.dailyMaxOn);
                if (typeof p.dailyMaxVal === 'string') setCpDailyMaxVal(p.dailyMaxVal);
            }
        } catch {}
    }, []);

    // Persist CP-SAT toggles when changed
    useEffect(() => {
        try {
            const p = {
                useCustom: cpUseCustom,
                allowSplit: cpAllowSplit,
                edgeReduce: cpEdgeReduce,
                gapReduce: cpGapReduce,
                gapLimit: cpGapLimit,
                dailyMaxOn: cpDailyMaxOn,
                dailyMaxVal: cpDailyMaxVal,
            };
            localStorage.setItem('cp_prefs', JSON.stringify(p));
        } catch {}
    }, [cpUseCustom, cpAllowSplit, cpEdgeReduce, cpGapReduce, cpGapLimit, cpDailyMaxOn, cpDailyMaxVal]);

    // Load saved settings
    useEffect(() => {
        try {
            const raw = localStorage.getItem('solver_settings');
            if (raw) {
                const s = JSON.parse(raw);
                if (typeof s.time === 'number') { setOptTime(s.time); setTimeText(String(s.time)); }
                if (typeof s.seed === 'number') { setOptSeedRatio(s.seed); setSeedText(String(s.seed)); }
                if (typeof s.tenure === 'number') { setOptTabuTenure(s.tenure); setTenureText(String(s.tenure)); }
                if (typeof s.iter === 'number') { setOptTabuIter(s.iter); setIterText(String(s.iter)); }
                if (typeof s.stopFirst === 'boolean') { setOptStopFirst(s.stopFirst); }
                if (typeof s.disableLNS === 'boolean') { setOptDisableLNS(s.disableLNS); }
                if (typeof s.disableEdge === 'boolean') { setOptDisableEdge(s.disableEdge); }
                if (typeof s.defaultMaxConsec === 'number') { setDefaultMaxConsec(s.defaultMaxConsec); }
            }
        } catch {}
    }, []);

    const saveSettingsAsDefault = useCallback(() => {
        const s = { time: optTime, seed: optSeedRatio, tenure: optTabuTenure, iter: optTabuIter, stopFirst: optStopFirst, disableLNS: optDisableLNS, disableEdge: optDisableEdge, defaultMaxConsec };
        try { localStorage.setItem('solver_settings', JSON.stringify(s)); alert('Ayarlar varsayılan olarak kaydedildi.'); } catch {}
    }, [optTime, optSeedRatio, optTabuTenure, optTabuIter, optStopFirst, optDisableLNS, optDisableEdge, defaultMaxConsec]);

    const applyProfile = useCallback((p: 'fast' | 'balanced' | 'max' | 'classic') => {
        if (p === 'fast') {
            setOptTime(45); setTimeText('45');
            setOptSeedRatio(0.12); setSeedText('0.12');
            setOptTabuTenure(60); setTenureText('60');
            setOptTabuIter(2500); setIterText('2500');
            setOptStopFirst(true);
            setClassicMode(false);
            setSolverStrategy('tabu');
        } else if (p === 'balanced') {
            setOptTime(90); setTimeText('90');
            setOptSeedRatio(0.12); setSeedText('0.12');
            setOptTabuTenure(70); setTenureText('70');
            setOptTabuIter(3000); setIterText('3000');
            setOptStopFirst(false);
            setClassicMode(false);
            setSolverStrategy('alns');
        } else if (p === 'classic') {
            setOptStopFirst(true);
            setOptDisableLNS(true);
            setOptDisableEdge(true);
            setClassicMode(true);
            setSolverStrategy('repair');
        } else { // max
            setOptTime(150); setTimeText('150');
            setOptSeedRatio(0.12); setSeedText('0.12');
            setOptTabuTenure(80); setTenureText('80');
            setOptTabuIter(3500); setIterText('3500');
            setOptStopFirst(false);
            setClassicMode(false);
            setSolverStrategy('tabu');
        }
    }, []);

    return {
        optTime,
        setOptTime,
        optSeedRatio,
        setOptSeedRatio,
        optTabuTenure,
        setOptTabuTenure,
        optTabuIter,
        setOptTabuIter,
        classicMode,
        setClassicMode,
        timeText,
        setTimeText,
        seedText,
        setSeedText,
        tenureText,
        setTenureText,
        iterText,
        setIterText,
        optStopFirst,
        setOptStopFirst,
        useDeterministic,
        setUseDeterministic,
        optRngSeed,
        setOptRngSeed,
        rngText,
        setRngText,
        optDisableLNS,
        setOptDisableLNS,
        solverStrategy,
        setSolverStrategy,
        optDisableEdge,
        setOptDisableEdge,
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
        cpHelpOpen,
        setCpHelpOpen,
        defaultMaxConsec,
        setDefaultMaxConsec,
        saveSettingsAsDefault,
        applyProfile,
    };
};
