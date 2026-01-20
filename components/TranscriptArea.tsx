
import React, { useEffect, useRef, useState, memo, useMemo, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Copy, Check, ArrowDown, Pencil, Save, Languages, MessageSquareText, Volume2, VolumeX, ChevronsDown, MousePointer2 } from 'lucide-react';

interface TranscriptAreaProps {
  title: string;
  text: string;
  interimText?: string;
  onChange: (text: string) => void;
  accentColor?: 'blue' | 'indigo' | 'emerald';
  enableTTS?: boolean;
  isTTSActive?: boolean;
  onToggleTTS?: () => void;
  onSyncScroll?: (percentage: number) => void;
  badge?: React.ReactNode;
}

export const TranscriptArea = memo(forwardRef<HTMLDivElement, TranscriptAreaProps>(({ 
  title, 
  text, 
  interimText = '', 
  onChange,
  accentColor = 'blue',
  enableTTS = false,
  isTTSActive = false,
  onToggleTTS,
  onSyncScroll,
  badge
}, ref) => {
  const localScrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  const isUserScrollingRef = useRef(false);

  useImperativeHandle(ref, () => localScrollRef.current as HTMLDivElement);

  const paragraphs = useMemo(() => {
    return text.split('\n').filter(p => p.trim() !== '');
  }, [text]);

  const handleScroll = () => {
    if (!localScrollRef.current || isEditing) return;
    
    const { scrollTop, scrollHeight, clientHeight } = localScrollRef.current;
    const maxScroll = scrollHeight - clientHeight;
    
    if (maxScroll <= 0) return;
    
    const isAtBottom = maxScroll - scrollTop < 35;
    
    if (isAtBottom && isUserScrollingRef.current) {
        setIsUserScrolling(false);
        isUserScrollingRef.current = false;
        setShowScrollButton(false);
    } 
    else if (!isAtBottom && !isUserScrollingRef.current) {
        setIsUserScrolling(true);
        isUserScrollingRef.current = true;
        setShowScrollButton(true);
    }

    if (onSyncScroll) {
        const percentage = Math.max(0, Math.min(1, scrollTop / maxScroll));
        onSyncScroll(percentage);
    }
  };

  const scrollToBottom = useCallback(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      setIsUserScrolling(false);
      isUserScrollingRef.current = false;
      setShowScrollButton(false);
    }
  }, []);

  useEffect(() => {
    if (autoScrollEnabled && !isUserScrolling && !isEditing && bottomRef.current) {
      requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    }
  }, [text, interimText, isUserScrolling, isEditing, autoScrollEnabled]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) { console.error(err); }
  };

  const toggleAutoScroll = () => {
    const nextState = !autoScrollEnabled;
    setAutoScrollEnabled(nextState);
    if (nextState) scrollToBottom();
  };

  const headerStyles = {
    blue: 'bg-blue-50 border-blue-100 text-blue-700',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    indigo: 'bg-indigo-50 border-indigo-100 text-indigo-700',
  }[accentColor];

  const cursorStyles = {
    blue: 'bg-blue-500',
    emerald: 'bg-emerald-500',
    indigo: 'bg-indigo-500',
  }[accentColor];

  return (
    <div className="flex-1 w-full flex flex-col bg-white rounded-xl md:rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative transition-all duration-300 hover:shadow-md">
      
      <div className={`px-4 md:px-5 py-2.5 md:py-3 border-b flex items-center justify-between ${headerStyles} shrink-0`}>
        <div className="flex items-center gap-2 md:gap-2.5 min-w-0">
            {accentColor === 'blue' ? <MessageSquareText className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" /> : <Languages className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" />}
            <h2 className="text-[10px] md:text-xs font-black uppercase tracking-widest truncate">{title}</h2>
            {badge}
        </div>
        
        <div className="flex items-center gap-1 md:gap-2 shrink-0">
            <button
                onClick={toggleAutoScroll}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all ${autoScrollEnabled ? 'bg-blue-600/10 text-blue-600' : 'bg-slate-100 text-slate-400'}`}
                title={autoScrollEnabled ? 'Auto-scroll On' : 'Auto-scroll Off'}
            >
                {autoScrollEnabled ? <ChevronsDown className="w-3.5 h-3.5" /> : <MousePointer2 className="w-3.5 h-3.5" />}
                <span className="text-[9px] font-black uppercase hidden lg:inline">{autoScrollEnabled ? 'Auto' : 'Lock'}</span>
            </button>

            {enableTTS && onToggleTTS && (
                 <button
                 onClick={onToggleTTS}
                 className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all ${isTTSActive ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white/80 text-slate-500'}`}
                 title="Toggle Vietnamese Speaker"
                >
                 {isTTSActive ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                 <span className="text-[9px] font-black uppercase hidden xs:inline">{isTTSActive ? 'Reader On' : 'Silent'}</span>
               </button>
            )}

             <button
                onClick={() => setIsEditing(!isEditing)}
                className={`p-1.5 md:p-2 rounded-lg transition-all ${isEditing ? 'bg-blue-600 text-white' : 'hover:bg-white/80 text-slate-400'}`}
                title={isEditing ? 'Save Edits' : 'Edit Text'}
            >
                {isEditing ? <Save className="w-3.5 h-3.5 md:w-4 md:h-4" /> : <Pencil className="w-3.5 h-3.5 md:w-4 md:h-4" />}
            </button>
            <button
                onClick={handleCopy}
                className="p-1.5 md:p-2 text-slate-400 hover:text-slate-600 rounded-lg transition-all"
                title="Copy Transcript"
            >
                {copied ? <Check className="w-3.5 h-3.5 md:w-4 md:h-4 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 md:w-4 md:h-4" />}
            </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 relative">
        {isEditing ? (
           <textarea 
              value={text}
              onChange={(e) => onChange(e.target.value)}
              className="flex-1 w-full h-full p-4 md:p-6 resize-none outline-none border-none text-sm md:text-lg leading-relaxed text-slate-800 bg-slate-50/30 custom-scrollbar font-sans"
              spellCheck={false}
           />
        ) : (
          <div 
              ref={localScrollRef}
              onScroll={handleScroll}
              className="flex-1 p-4 md:p-6 overflow-y-auto custom-scrollbar bg-white scroll-smooth relative"
          >
              <div className="flex flex-col gap-3 md:gap-4 text-sm md:text-lg leading-relaxed text-slate-800 font-medium">
                  {paragraphs.map((para, index) => (
                      <p key={index} className="break-words animate-in fade-in duration-500 slide-in-from-bottom-1">
                          {para}
                      </p>
                  ))}
                  
                  {(interimText || paragraphs.length > 0) && (
                      <div className="min-h-[1.2em] relative">
                          {interimText && <span className="text-slate-400 italic break-words">{interimText}</span>}
                          <span className={`inline-block w-2 h-4 md:h-5 ${cursorStyles} ml-1 align-middle animate-cursor-blink rounded-full`}></span>
                      </div>
                  )}
                  <div ref={bottomRef} className="h-2 md:h-4" />
              </div>
          </div>
        )}

        {showScrollButton && !isEditing && (
          <button
            onClick={scrollToBottom}
            className={`absolute bottom-4 right-4 text-white p-2.5 rounded-xl shadow-xl transition-all hover:scale-110 active:scale-95 z-20 ${accentColor === 'blue' ? 'bg-blue-600' : 'bg-emerald-600'}`}
          >
            <ArrowDown className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}));

TranscriptArea.displayName = 'TranscriptArea';
