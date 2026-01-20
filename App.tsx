
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Mic, Clock, Zap, AlertTriangle, Hourglass, FileDown, Lock, LogIn, Headphones, X as CloseIcon, RefreshCcw, Layers, Cpu, Sparkles, Activity, FileAudio, Upload, BookOpen, FolderOpen, Save, Wand2, ArrowRightCircle, Download } from 'lucide-react';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useStopwatch } from './hooks/useStopwatch';
import { Controls } from './components/Controls';
import { TranscriptArea } from './components/TranscriptArea';
import { ContextPanel } from './components/ContextPanel';
import { NetworkStatus } from './components/NetworkStatus';
import { SessionVault } from './components/SessionVault';
import { TranscriptionStatus, SessionMetadata, SessionData } from './types';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

const VALID_PASSWORDS = ['Hieuai', 'Hieuai@'];
const AUTH_KEY = 'livescribe_auth_v1';
const SESSIONS_META_KEY = 'scribe_sessions_meta_v1';
const SESSION_DATA_PREFIX = 'scribe_session_data_v1_';

// Helpers
const generateId = () => Math.random().toString(36).substring(2, 11);

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = error => reject(error);
  });
};

async function retryWithBackoff<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try { return await fn(); } catch (error: any) {
    const isQuota = error?.status === 429 || error?.message?.includes('429');
    if (isQuota && retries > 0) {
      await new Promise(res => setTimeout(res, delay));
      return retryWithBackoff(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => sessionStorage.getItem(AUTH_KEY) === 'true');
  const [passwordInput, setPasswordInput] = useState('');
  
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [lastSaved, setLastSaved] = useState<number>(0);

  const {
    status, text, interimText, error: sttError, velocity,
    startRecording, pauseRecording, stopRecording, clearTranscript,
    setText, isSupported
  } = useSpeechRecognition();

  const isRecording = status === TranscriptionStatus.RECORDING;
  const { elapsedTime, formatTime, resetTimer } = useStopwatch(isRecording);
  
  const [aiError, setAiError] = useState<string | null>(null);
  const [contextDesc, setContextDesc] = useState('');
  const [contextFileName, setContextFileName] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchFileProcessing, setBatchFileProcessing] = useState(false);
  
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState<{user: string, ai: string}[]>([]);

  const refinedRef = useRef(0); 
  const processedRef = useRef(0); 
  
  const refiningInProgressRef = useRef(false);
  const translatingRef = useRef(false);
  const lastRequestTimeRef = useRef<number>(0);
  const minIntervalRef = useRef<number>(150); 
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refineTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [ttsEnabled, setTtsEnabled] = useState(false);
  const englishRef = useRef<HTMLDivElement>(null);
  const vietnameseRef = useRef<HTMLDivElement>(null);
  
  const scrollLockRef = useRef<string | null>(null);
  const scrollLockTimeoutRef = useRef<number | null>(null);
  const lastSyncPercentage = useRef<number>(0);

  useEffect(() => {
    const meta = localStorage.getItem(SESSIONS_META_KEY);
    if (meta) {
      const parsed = JSON.parse(meta);
      setSessions(parsed);
      if (parsed.length > 0) handleSelectSession(parsed[0].id);
      else createNewSession("Initial Session");
    } else {
      createNewSession("Untitled Meeting");
    }
  }, []);

  useEffect(() => {
    if (!activeSessionId || !isAuthenticated) return;
    const saveTimer = setTimeout(() => saveCurrentToStorage(), 5000);
    return () => clearTimeout(saveTimer);
  }, [text, translatedText, contextDesc, contextFileName, fileContent, activeSessionId, elapsedTime]);

  const saveCurrentToStorage = () => {
    if (!activeSessionId) return;
    const data: SessionData = {
      text,
      translatedText,
      contextDesc,
      fileContent,
      fileName: contextFileName,
      processedIndex: processedRef.current
    };
    localStorage.setItem(SESSION_DATA_PREFIX + activeSessionId, JSON.stringify(data));
    setSessions(prev => {
      const updated = prev.map(s => {
        if (s.id === activeSessionId) {
          return { ...s, updatedAt: Date.now(), durationSeconds: elapsedTime, wordCount: text.split(/\s+/).filter(Boolean).length };
        }
        return s;
      });
      localStorage.setItem(SESSIONS_META_KEY, JSON.stringify(updated));
      return updated;
    });
    setLastSaved(Date.now());
  };

  const createNewSession = (name: string) => {
    const id = generateId();
    const newMeta: SessionMetadata = { id, name, createdAt: Date.now(), updatedAt: Date.now(), durationSeconds: 0, wordCount: 0 };
    const updatedMeta = [newMeta, ...sessions];
    setSessions(updatedMeta);
    localStorage.setItem(SESSIONS_META_KEY, JSON.stringify(updatedMeta));
    handleSelectSession(id);
    setIsVaultOpen(false);
  };

  const handleSelectSession = (id: string) => {
    if (activeSessionId) saveCurrentToStorage();
    const dataRaw = localStorage.getItem(SESSION_DATA_PREFIX + id);
    if (dataRaw) {
      const data: SessionData = JSON.parse(dataRaw);
      setText(data.text || '');
      setTranslatedText(data.translatedText || '');
      setContextDesc(data.contextDesc || '');
      setContextFileName(data.fileName || '');
      setFileContent(data.fileContent || '');
      processedRef.current = data.processedIndex || 0;
      refinedRef.current = (data.text || '').length;
    } else {
      setText(''); setTranslatedText(''); setContextDesc(''); setContextFileName(''); setFileContent('');
      processedRef.current = 0; refinedRef.current = 0;
    }
    resetTimer();
    setActiveSessionId(id);
    setIsVaultOpen(false);
  };

  const handleDeleteSession = (id: string) => {
    const updated = sessions.filter(s => s.id !== id);
    setSessions(updated);
    localStorage.setItem(SESSIONS_META_KEY, JSON.stringify(updated));
    localStorage.removeItem(SESSION_DATA_PREFIX + id);
    if (activeSessionId === id) {
      if (updated.length > 0) handleSelectSession(updated[0].id);
      else createNewSession("Untitled Meeting");
    }
  };

  const exportSession = async () => {
    const sessionName = sessions.find(s => s.id === activeSessionId)?.name || "session";
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({ text: "HIEUAI TRANSLATE - SESSION ARCHIVE", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `Title: ${sessionName}\nDate: ${new Date().toLocaleString()}\nDuration: ${formatTime(elapsedTime)}` }),
          new Paragraph({ text: "Context & Objectives", heading: HeadingLevel.HEADING_2 }),
          new Paragraph({ text: contextDesc || "No context objectives provided." }),
          new Paragraph({ text: "Original Transcript (English)", heading: HeadingLevel.HEADING_2 }),
          ...text.split('\n').map(line => new Paragraph({ text: line })),
          new Paragraph({ text: "Interpretation (Vietnamese)", heading: HeadingLevel.HEADING_2 }),
          ...translatedText.split('\n').map(line => new Paragraph({ text: line })),
        ],
      }],
    });

    try {
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sessionName.replace(/\s+/g, '_')}_archive.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert("Export failed."); }
  };

  const refineEnglishTranscript = useCallback(async () => {
    if (!process.env.API_KEY || refiningInProgressRef.current) return;
    
    const raw = text;
    const unrefinedChunk = raw.slice(refinedRef.current).trim();
    
    // Low-latency Refiner: Commit as soon as any text fragment is finalized
    const minThreshold = velocity > 30 ? 10 : 5;
    if (unrefinedChunk.length < minThreshold) return; 

    refiningInProgressRef.current = true;
    setIsRefining(true);

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const sys = `Expert AI Transcriber. Polish speech to text transcript immediately.
                     CONTEXT: ${contextDesc}. 
                     REFERENCE MATERIALS: ${fileContent.slice(0, 1500)}. 
                     Match technical jargon found in the materials. 
                     Rules: Add punctuation, fix homophones, preserve exact meaning. Output English only.`;

        const res = await retryWithBackoff<GenerateContentResponse>(() => ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Refine: "${unrefinedChunk}"`,
            config: { systemInstruction: sys, temperature: 0.1 }
        }));

        if (res.text) {
            const refined = res.text.trim();
            setText(prev => {
                const head = prev.slice(0, refinedRef.current);
                const separator = (head.endsWith('\n') || head === '') ? '' : ' ';
                const newFullText = head + separator + refined;
                refinedRef.current = newFullText.length;
                return newFullText;
            });
        }
    } catch (e) { console.error("Refiner error", e); }
    finally {
        refiningInProgressRef.current = false;
        setIsRefining(false);
    }
  }, [text, contextDesc, fileContent, setText, velocity]);

  const performTranslation = useCallback(async (isBatchRequest: boolean = false) => {
    if (!process.env.API_KEY) return;
    if (translatingRef.current && !isBatchRequest) return;
    
    const now = Date.now();
    const elapsed = now - lastRequestTimeRef.current;
    
    if (!isBatchRequest && elapsed < minIntervalRef.current) {
        if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = setTimeout(() => performTranslation(), minIntervalRef.current - elapsed + 1);
        return;
    }
    
    const sourceText = text;
    const endPoint = isBatchRequest ? sourceText.length : refinedRef.current;
    const chunk = sourceText.slice(processedRef.current, endPoint);
    
    if (chunk.trim().length === 0) return;

    translatingRef.current = true;
    setIsTranslating(true);

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const activeModel = 'gemini-3-flash-preview';
        
        let sys = `Expert Professional Simultaneous Interpreter (EN -> VI).
                   CONTEXT: ${contextDesc}.
                   TECHNICAL GLOSSARY: ${fileContent.slice(0, 4000)}.
                   
                   RULES:
                   1. Output ONLY Vietnamese.
                   2. Use the TECHNICAL GLOSSARY to accurately translate specific terms and project names.
                   3. Zero-Latency flow: Translate immediately and concisely.
                   4. Tone: Professional and accurate.`;

        lastRequestTimeRef.current = Date.now();
        const res = await ai.models.generateContent({
            model: activeModel,
            contents: `Interpret to Vietnamese: "${chunk}"`,
            config: { systemInstruction: sys, temperature: 0.1 }
        });

        if (res.text) {
            const val = res.text.trim();
            if (val) {
                setTranslatedText(prev => {
                    const p = prev.trimEnd();
                    const sep = (p.length > 0 && !p.endsWith('\n')) ? '\n' : '';
                    return p + sep + val;
                });
                processedRef.current = endPoint;
                setAiError(null);
            }
        }
    } catch (e: any) { setAiError("Interpretation lag detected."); }
    finally {
        translatingRef.current = false;
        setIsTranslating(false);
    }
  }, [text, contextDesc, fileContent, refinedRef]);

  // Aggressive orchestration for near-zero latency experience
  useEffect(() => {
    if (!isAuthenticated || isLiveMode || isBatchMode) return;

    if (!refiningInProgressRef.current && text.length > refinedRef.current + 5) {
        if (refineTimeoutRef.current) clearTimeout(refineTimeoutRef.current);
        refineTimeoutRef.current = setTimeout(() => refineEnglishTranscript(), 250);
    }

    if (!translatingRef.current && refinedRef.current > processedRef.current) {
        if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
        const cycle = velocity > 40 ? 50 : 100; 
        retryTimeoutRef.current = setTimeout(() => performTranslation(), cycle);
    }

    return () => {
        if (refineTimeoutRef.current) clearTimeout(refineTimeoutRef.current);
        if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, [text, refineEnglishTranscript, performTranslation, isAuthenticated, isLiveMode, isBatchMode, velocity]);

  // Explicitly using React.ChangeEvent to fix the missing namespace error
  const handleAudioBatchUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !process.env.API_KEY) return;
    setBatchFileProcessing(true); setIsTranslating(true); setAiError(null);
    try {
        const base64 = await fileToBase64(file);
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const transcribeResponse = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { 
                parts: [
                    { inlineData: { data: base64, mimeType: file.type || 'audio/mpeg' } }, 
                    { text: `Transcribe this audio file verbatim. Use this context: ${contextDesc}` }
                ] 
            }
        });
        if (transcribeResponse.text) {
            setText(prev => prev + "\n[UPLOADED AUDIO]: " + transcribeResponse.text);
        }
    } catch (err) { setAiError("Audio processing failed."); }
    finally { setBatchFileProcessing(false); setIsTranslating(false); }
  };

  const handleContextChange = useCallback((desc: string, content: string, fileName: string) => {
    setContextDesc(desc);
    setFileContent(content);
    setContextFileName(fileName);
  }, []);

  const handleScrollSync = useCallback((source: 'english' | 'vietnamese', percentage: number) => {
    if (scrollLockRef.current && scrollLockRef.current !== source) return;
    if (Math.abs(lastSyncPercentage.current - percentage) < 0.0001) return;
    lastSyncPercentage.current = percentage;
    scrollLockRef.current = source;
    if (scrollLockTimeoutRef.current) window.clearTimeout(scrollLockTimeoutRef.current);
    requestAnimationFrame(() => {
        const targetRef = source === 'english' ? vietnameseRef : englishRef;
        if (targetRef.current) {
            const { scrollHeight, clientHeight } = targetRef.current;
            const maxScroll = scrollHeight - clientHeight;
            if (maxScroll <= 0) return;
            const targetScrollTop = Math.round(percentage * maxScroll);
            if (Math.abs(targetRef.current.scrollTop - targetScrollTop) > 1) {
                targetRef.current.scrollTop = targetScrollTop;
            }
        }
        scrollLockTimeoutRef.current = window.setTimeout(() => { scrollLockRef.current = null; }, 50);
    });
  }, []);

  const startLiveMode = async () => { setIsLiveMode(true); };
  const stopLiveMode = () => { setIsLiveMode(false); };

  if (!isAuthenticated) {
    return (
      <div className="h-[100dvh] w-full flex items-center justify-center bg-slate-900 overflow-hidden relative">
        <div className="bg-slate-800/40 backdrop-blur-2xl p-8 rounded-[48px] w-full max-w-md mx-4 border border-slate-700">
          <div className="flex flex-col items-center mb-10">
            <div className="w-16 h-16 bg-blue-600 rounded-3xl flex items-center justify-center mb-8 shadow-2xl shadow-blue-500/30"><Lock className="w-8 h-8 text-white" /></div>
            <h1 className="text-2xl font-black text-white uppercase tracking-tighter">HIEUAI <span className="text-blue-500">TRANSLATE</span></h1>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (VALID_PASSWORDS.includes(passwordInput)) { setIsAuthenticated(true); sessionStorage.setItem(AUTH_KEY, 'true'); } }} className="space-y-6">
            <input type="password" placeholder="Passphrase..." value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} className="w-full bg-slate-900/60 border border-slate-600 py-4 px-6 rounded-2xl text-white outline-none focus:border-blue-500 font-bold" autoFocus />
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl uppercase text-sm">Access</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-slate-50 text-slate-900 font-sans overflow-hidden">
      <SessionVault 
        isOpen={isVaultOpen} 
        onClose={() => setIsVaultOpen(false)} 
        sessions={sessions} 
        activeSessionId={activeSessionId}
        onSelect={handleSelectSession}
        onDelete={handleDeleteSession}
        onNew={createNewSession}
      />

      <header className="bg-white border-b border-slate-200 px-4 md:px-8 py-3 md:py-4 flex items-center justify-between shrink-0 z-30 shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={() => setIsVaultOpen(true)} className="w-10 h-10 md:w-12 md:h-12 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center hover:bg-blue-50 hover:text-blue-600 transition-all border border-slate-200">
            <FolderOpen className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
                <h1 className="text-sm md:text-lg font-black tracking-tighter text-slate-900 uppercase truncate max-w-[150px] sm:max-w-none">
                    {sessions.find(s => s.id === activeSessionId)?.name || "Session Hub"}
                </h1>
                <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                    <Save className="w-2.5 h-2.5" />
                    <span className="text-[8px] font-black uppercase tracking-tighter">Auto-Vault</span>
                </div>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-3 bg-slate-50 border border-slate-200 px-5 py-2 rounded-xl font-mono text-xl font-black tabular-nums">
                <Clock className={`w-4 h-4 ${isRecording ? 'text-red-500 animate-pulse' : 'text-slate-400'}`} /> {formatTime(elapsedTime)}
            </div>
            <button onClick={exportSession} className="p-2.5 md:px-5 md:py-2.5 bg-blue-600 text-white hover:bg-blue-700 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-all">
                <FileAudio className="w-4 h-4" />
                <span className="hidden sm:inline">Export</span>
            </button>
            <button onClick={isLiveMode ? stopLiveMode : startLiveMode} className={`p-2.5 md:px-5 md:py-2.5 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-all ${isLiveMode ? 'bg-red-500 text-white shadow-lg' : 'bg-slate-800 text-white'}`}>
                {isLiveMode ? 'Exit Live' : 'Intercom'}
            </button>
        </div>
      </header>

      {!isLiveMode && (
          <>
            <ContextPanel 
                initialDescription={contextDesc}
                initialFileName={contextFileName}
                initialFileContent={fileContent}
                onContextChange={handleContextChange} 
            />
            
            <div className="bg-slate-900 text-white px-8 py-2 flex items-center justify-center gap-6 shadow-xl z-20 overflow-hidden">
                <div className="flex items-center gap-2">
                    <Activity className={`w-3.5 h-3.5 ${isRecording ? 'text-blue-400' : 'text-slate-500'}`} />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Gemini 3 Flash Pulse</span>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Wand2 className={`w-3 h-3 ${isRefining ? 'text-blue-400 animate-spin' : 'text-slate-600'}`} />
                        <span className={`text-[9px] font-black uppercase ${isRefining ? 'text-blue-200' : 'text-slate-600'}`}>Refining</span>
                    </div>
                    <div className="flex items-center gap-2 border-l border-slate-800 pl-4">
                        <Sparkles className={`w-3 h-3 ${isTranslating ? 'text-emerald-400 animate-pulse' : 'text-slate-600'}`} />
                        <span className={`text-[9px] font-black uppercase ${isTranslating ? 'text-emerald-200' : 'text-slate-600'}`}>Interpreting</span>
                    </div>
                </div>
            </div>

            <main className="flex-1 flex flex-col md:flex-row min-h-0 w-full p-4 md:p-8 gap-4 md:gap-8 overflow-hidden">
                <TranscriptArea 
                    ref={englishRef} 
                    title="Source (Original)" 
                    text={text} 
                    interimText={interimText} 
                    onChange={setText} 
                    accentColor="blue" 
                    onSyncScroll={(p) => handleScrollSync('english', p)} 
                    badge={isRefining ? <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[8px] font-black uppercase animate-pulse">Syncing</span> : null}
                />
                <TranscriptArea 
                    ref={vietnameseRef} 
                    title="Interpretation (Archive)" 
                    text={translatedText} 
                    interimText={isTranslating ? "Streaming Translation..." : ""} 
                    onChange={setTranslatedText} 
                    accentColor="emerald" 
                    enableTTS={true} 
                    isTTSActive={ttsEnabled} 
                    onToggleTTS={() => setTtsEnabled(!ttsEnabled)} 
                    onSyncScroll={(p) => handleScrollSync('vietnamese', p)} 
                />
            </main>
            
            <footer className="bg-white border-t border-slate-200 p-4 shrink-0 z-30">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div className="hidden lg:flex items-center gap-3">
                        <div className="relative group">
                            <input type="file" onChange={handleAudioBatchUpload} className="absolute inset-0 opacity-0 cursor-pointer" accept="audio/*" />
                            <button className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase border border-slate-200 hover:bg-blue-50 transition-all flex items-center gap-2">
                                <Upload className="w-3.5 h-3.5" /> Audio Transcribe
                            </button>
                        </div>
                        <NetworkStatus />
                    </div>
                    
                    <Controls 
                      status={status} 
                      onStart={startRecording} 
                      onPause={pauseRecording} 
                      onStop={stopRecording} 
                      onClear={() => { clearTranscript(); refinedRef.current = 0; processedRef.current = 0; }} 
                      onSave={() => { saveCurrentToStorage(); alert("Session Saved."); }} 
                      onOptimize={() => performTranslation(true)} 
                      isOptimizing={isTranslating} 
                      hasText={text.length > 0} 
                    />
                    
                    <div className="hidden lg:flex flex-col items-end gap-1">
                      <div className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Velocity: {velocity} cps</div>
                      <div className="text-[9px] text-slate-300 font-bold uppercase tracking-tighter">Fidelity Guard Active</div>
                    </div>
                </div>
            </footer>
          </>
      )}
    </div>
  );
}

export default App;
