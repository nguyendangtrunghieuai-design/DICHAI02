
import { useState, useEffect, useRef, useCallback } from 'react';
import { TranscriptionStatus, SpeechRecognition, SpeechRecognitionEvent, SpeechRecognitionErrorEvent } from '../types';

interface UseSpeechRecognitionReturn {
  status: TranscriptionStatus;
  text: string;
  interimText: string;
  error: string | null;
  velocity: number;
  startRecording: () => void;
  pauseRecording: () => void;
  stopRecording: () => void;
  clearTranscript: () => void;
  setText: (value: string | ((prev: string) => string)) => void;
  isSupported: boolean;
}

const ERROR_MAP: Record<string, { msg: string; recovery: string }> = {
  'no-speech': { msg: 'Không nghe thấy âm thanh.', recovery: 'Vui lòng kiểm tra Micro hoặc nói to hơn.' },
  'audio-capture': { msg: 'Lỗi thu âm Micro.', recovery: 'Đảm bảo Micro không bị ứng dụng khác chiếm dụng.' },
  'not-allowed': { msg: 'Quyền truy cập Micro bị từ chối.', recovery: 'Vui lòng cấp quyền Micro trong cài đặt trình duyệt.' },
  'network': { msg: 'Lỗi kết nối mạng.', recovery: 'Kiểm tra internet để Web Speech API hoạt động.' },
  'not-supported': { msg: 'Trình duyệt không hỗ trợ.', recovery: 'Vui lòng sử dụng Chrome hoặc Microsoft Edge.' },
  'aborted': { msg: 'Phiên ghi âm bị ngắt.', recovery: 'Đang tự động khởi động lại...' },
};

// Extremely aggressive segmentation for real-time interpretation
// Splitting at 15 characters or terminal punctuation to ensure immediate translation
const MAX_CHARS_PER_FRAGMENT = 15; 
const SILENCE_COMMIT_MS = 400; 

export const useSpeechRecognition = (): UseSpeechRecognitionReturn => {
  const [status, setStatus] = useState<TranscriptionStatus>(TranscriptionStatus.IDLE);
  const [text, setText] = useState<string>('');
  const [interimText, setInterimText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState<boolean>(true);
  
  const [velocity, setVelocity] = useState<number>(0);
  const velocityRef = useRef<number>(0);
  const lastLengthRef = useRef<number>(0);
  
  const language = 'en-US';
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const statusRef = useRef<TranscriptionStatus>(TranscriptionStatus.IDLE);
  const restartCount = useRef(0);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (status !== TranscriptionStatus.RECORDING) {
        setVelocity(0);
        velocityRef.current = 0;
        return;
    }

    const interval = setInterval(() => {
        const currentLength = text.length;
        const diff = Math.max(0, currentLength - lastLengthRef.current);
        velocityRef.current = diff;
        setVelocity(diff);
        lastLengthRef.current = currentLength;
    }, 1000);

    return () => clearInterval(interval);
  }, [status, text.length]);

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  useEffect(() => {
    if (status !== TranscriptionStatus.RECORDING || interimText) {
        if (silenceTimer.current) clearTimeout(silenceTimer.current);
        return;
    }

    if (silenceTimer.current) clearTimeout(silenceTimer.current);

    silenceTimer.current = setTimeout(() => {
        setText(prev => {
            let trimmed = prev.trimEnd();
            if (trimmed.length > 0 && !trimmed.endsWith('\n')) {
                return trimmed + '\n';
            }
            return prev;
        });
    }, SILENCE_COMMIT_MS);

  }, [text, interimText, status]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setIsSupported(false); return; }

    const init = () => {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = language;

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            restartCount.current = 0; 
            let finalChunk = '';
            let interimChunk = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) finalChunk += event.results[i][0].transcript;
                else interimChunk += event.results[i][0].transcript;
            }

            if (finalChunk) {
                setText(prev => {
                    let chunk = finalChunk.trim();
                    if (!chunk) return prev;
                    
                    // Priority 1: Split by terminal punctuation
                    const sentenceRegex = /([^.!?]+[.!?]\s*|[^.!?]+$)/g;
                    const initialSentences = chunk.match(sentenceRegex) || [chunk];
                    
                    // Priority 2: Force split fragments exceeding 15 characters
                    const processedSentences: string[] = [];
                    initialSentences.forEach(s => {
                      let str = s.trim();
                      while (str.length > MAX_CHARS_PER_FRAGMENT) {
                        // Attempt to split at space, fallback to hard character limit
                        let splitIndex = str.lastIndexOf(' ', MAX_CHARS_PER_FRAGMENT);
                        if (splitIndex === -1 || splitIndex < 5) splitIndex = MAX_CHARS_PER_FRAGMENT;
                        
                        processedSentences.push(str.substring(0, splitIndex).trim());
                        str = str.substring(splitIndex).trim();
                      }
                      if (str.length > 0) processedSentences.push(str);
                    });

                    let newFullText = prev.trimEnd();

                    processedSentences.forEach(s => {
                        let fragment = capitalize(s.trim());
                        if (!fragment) return;

                        // Ensure every fragment starts on a new line to trigger immediate AI translation
                        const separator = newFullText !== '' ? '\n' : '';
                        newFullText += separator + fragment;
                    });
                    
                    return newFullText;
                });
                setInterimText(''); 
            } else {
                setInterimText(interimChunk);
            }
        };

        recognition.onerror = (ev: SpeechRecognitionErrorEvent) => {
            const errInfo = ERROR_MAP[ev.error] || { msg: 'Lỗi ghi âm.', recovery: 'Đang khởi động lại...' };
            setError(`${errInfo.msg} ${errInfo.recovery}`);
            
            if (statusRef.current === TranscriptionStatus.RECORDING && restartCount.current < 5) {
                restartCount.current++;
                setTimeout(() => { try { recognition.start(); } catch(e) {} }, 250);
            }
        };

        recognition.onend = () => {
            if (statusRef.current === TranscriptionStatus.RECORDING) {
                try { recognition.start(); } catch (e) {}
            }
        };
        return recognition;
    };

    recognitionRef.current = init();
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }
    };
  }, []); 

  const startRecording = useCallback(() => {
    setError(null);
    restartCount.current = 0;
    if (recognitionRef.current) {
        try { recognitionRef.current.start(); setStatus(TranscriptionStatus.RECORDING); }
        catch (e) { setStatus(TranscriptionStatus.RECORDING); }
    }
  }, []);

  const pauseRecording = useCallback(() => { setStatus(TranscriptionStatus.PAUSED); recognitionRef.current?.stop(); }, []);
  const stopRecording = useCallback(() => { setStatus(TranscriptionStatus.STOPPED); recognitionRef.current?.stop(); setInterimText(''); }, []);
  const clearTranscript = useCallback(() => { setText(''); setInterimText(''); setError(null); lastLengthRef.current = 0; velocityRef.current = 0; }, []);

  return { status, text, interimText, error, velocity, startRecording, pauseRecording, stopRecording, clearTranscript, setText, isSupported };
};
