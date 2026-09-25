"use client";

import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X, Bot, User, Loader2, Mic, MicOff, Volume2, PhoneOff, Sparkles, Undo2 } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

type VoiceTransport = 'idle' | 'realtime' | 'fallback';

type VoiceSessionPayload = {
  provider: 'openai-realtime' | 'xai-fallback';
  session?: any;
  realtimeApiBase?: string;
  reason?: string;
};

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [voiceTransport, setVoiceTransport] = useState<VoiceTransport>('idle');
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('Voice is off.');
  const [optimizationOriginal, setOptimizationOriginal] = useState<string>();
  const [optimizationStatus, setOptimizationStatus] = useState<string>();
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const assistantDraftRef = useRef('');
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      stopRealtimeConnection();
      if (typeof window !== 'undefined') {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function appendMessage(message: ChatMessage) {
    setMessages((prev) => [...prev, message]);
  }

  function activeJobId(): string | undefined {
    try { return JSON.parse(localStorage.getItem('vulpine.workspace.pointer.v1') || '{}').jobId; } catch { return undefined; }
  }

  async function optimizeInput() {
    const prompt = input.trim();
    const jobId = activeJobId();
    if (!prompt) { setOptimizationStatus('Enter a prompt before optimizing.'); return; }
    if (!jobId) { setOptimizationStatus('Open an active project before optimizing.'); return; }
    setOptimizationStatus('Building a grounded preview…');
    try {
      const response = await fetch('/api/assistant/optimize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId, prompt }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message || 'Prompt optimization failed.');
      setOptimizationOriginal(prompt);
      setInput(payload.data.revision.preview);
      setOptimizationStatus('Optimized preview shown. Review it before sending, or undo.');
    } catch (error) { setOptimizationStatus(error instanceof Error ? error.message : 'Prompt optimization failed.'); }
  }

  function safeJsonParse(raw: string): any | null {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function extractEphemeralKey(session: any): string | null {
    return (
      session?.client_secret?.value ||
      session?.client_secret?.token ||
      session?.client_secret ||
      session?.ephemeral_key ||
      null
    );
  }

  function sendRealtimeEvent(payload: Record<string, unknown>) {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== 'open') return;
    channel.send(JSON.stringify(payload));
  }

  function stopRealtimeConnection() {
    if (dataChannelRef.current) {
      try {
        dataChannelRef.current.close();
      } catch {}
      dataChannelRef.current = null;
    }

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch {}
      peerConnectionRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    assistantDraftRef.current = '';
    setRealtimeConnected(false);
    setMicMuted(false);
  }

  function handleRealtimeEvent(event: any) {
    const type = event?.type;
    if (!type) return;

    if (type === 'conversation.item.input_audio_transcription.completed') {
      const transcript = event?.transcript?.trim();
      if (transcript) {
        // Realtime is transport/transcription only. The project-authorized backend owns the answer.
        sendRealtimeEvent({ type: 'response.cancel' });
        void runAgenticTurn(transcript, true);
      }
      return;
    }

    if (type === 'response.audio_transcript.delta' || type === 'response.output_text.delta') {
      const delta = event?.delta || '';
      if (typeof delta === 'string' && delta) {
        assistantDraftRef.current += delta;
      }
      return;
    }

    if (type === 'response.audio_transcript.done' || type === 'response.output_text.done' || type === 'response.done') {
      const text = assistantDraftRef.current.trim() || event?.transcript?.trim() || '';
      if (text) {
        appendMessage({ role: 'model', text });
      }
      assistantDraftRef.current = '';
      return;
    }

    if (type === 'error') {
      const message = event?.error?.message || 'Realtime voice event error.';
      setVoiceStatus(`Realtime error: ${message}`);
    }
  }

  async function runAgenticTurn(userMsg: string, withVoiceOutput: boolean) {
    appendMessage({ role: 'user', text: userMsg });
    setIsLoading(true);

    try {
      const historySnapshot = messagesRef.current;
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: historySnapshot,
          message: userMsg,
          jobId: (() => {
            try { return JSON.parse(localStorage.getItem('vulpine.workspace.pointer.v1') || '{}').jobId; }
            catch { return undefined; }
          })(),
          // Agentic path: keep reasoning on backend workflow, not realtime model chat.
          mode: 'text',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get backend agent response.');
      }

      const data = await response.json();
      const responseText = data?.data?.text || data?.text || 'No response text returned.';
      appendMessage({ role: 'model', text: responseText });
      if (withVoiceOutput) {
        speakText(responseText);
      }
    } catch (error: any) {
      appendMessage({ role: 'model', text: 'Sorry, I encountered an error. Please try again later.' });
      setVoiceStatus(`Agent turn failed: ${error?.message || 'unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function startRealtimeConnection(payload: VoiceSessionPayload) {
    if (typeof window === 'undefined') {
      throw new Error('Realtime voice is only available in the browser.');
    }

    const session = payload.session || {};
    const realtimeApiBase = (payload.realtimeApiBase || 'https://api.openai.com/v1').replace(/\/$/, '');

    const ephemeralKey = extractEphemeralKey(session);
    if (!ephemeralKey) {
      throw new Error('Missing ephemeral key from OpenAI realtime session.');
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access is not supported in this browser.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;

    const peerConnection = new RTCPeerConnection();
    peerConnectionRef.current = peerConnection;

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      if (state === 'connected') {
        setRealtimeConnected(true);
        setVoiceTransport('realtime');
        setVoiceStatus('Realtime voice connected. Speak naturally.');
      } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        setRealtimeConnected(false);
        if (state !== 'closed') {
          setVoiceTransport('fallback');
          setVoiceStatus('Realtime connection dropped. Fallback voice mode is active.');
        }
      }
    };

    peerConnection.ontrack = (event) => {
      if (!remoteAudioRef.current) return;
      remoteAudioRef.current.srcObject = event.streams[0];
      remoteAudioRef.current
        .play()
        .catch(() => setVoiceStatus('Tap the widget once to allow audio playback.'));
    };

    stream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, stream);
    });

    const channel = peerConnection.createDataChannel('oai-events');
    dataChannelRef.current = channel;

    channel.onopen = () => {
      sendRealtimeEvent({
        type: 'session.update',
        session: {
          modalities: ['audio', 'text'],
          turn_detection: { type: 'server_vad' },
        },
      });
      setVoiceStatus('Realtime voice live. Listening...');
    };

    channel.onmessage = (messageEvent) => {
      const payload = safeJsonParse(messageEvent.data);
      if (payload) {
        handleRealtimeEvent(payload);
      }
    };

    channel.onerror = () => {
      setVoiceStatus('Realtime data channel error. Falling back if needed.');
    };

    const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
    await peerConnection.setLocalDescription(offer);

    if (!offer.sdp) {
      throw new Error('Failed to create a valid SDP offer for realtime voice.');
    }

    const model = session?.model || 'gpt-4o-realtime-preview';
    const realtimeUrl = `${realtimeApiBase}/realtime?model=${encodeURIComponent(model)}`;
    const sdpResponse = await fetch(realtimeUrl, {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        'Content-Type': 'application/sdp',
      },
    });

    if (!sdpResponse.ok) {
      const errorBody = await sdpResponse.text();
      throw new Error(`SDP negotiation failed (${sdpResponse.status}): ${errorBody.slice(0, 200)}`);
    }

    const answerSdp = await sdpResponse.text();
    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: answerSdp,
    });
  }

  function speakText(text: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || mode !== 'voice') {
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  }

  async function initVoiceSession() {
    try {
      stopListening();
      stopRealtimeConnection();
      const response = await fetch('/api/chat/voice/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: activeJobId() }),
      });
      if (!response.ok) {
        throw new Error('Voice session init failed.');
      }

      const data = await response.json();
      const voiceSession = (data?.data?.voiceSession || {}) as VoiceSessionPayload;
      const provider = voiceSession?.provider;
      if (provider === 'openai-realtime') {
        await startRealtimeConnection(voiceSession);
        return;
      }

      setVoiceTransport('fallback');
      const reason = voiceSession?.reason || 'OpenAI realtime unavailable.';
      setVoiceStatus(`xAI fallback active: ${reason}`);
    } catch (error: any) {
      setVoiceTransport('fallback');
      setVoiceStatus(`Realtime unavailable. Fallback active: ${error?.message || 'unknown error'}`);
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }

  function toggleRealtimeMute() {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextMuted = !micMuted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMicMuted(nextMuted);
    setVoiceStatus(nextMuted ? 'Realtime mic muted.' : 'Realtime mic live.');
  }

  function interruptRealtimeAssistant() {
    sendRealtimeEvent({ type: 'response.cancel' });
    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.currentTime = 0;
    }
    assistantDraftRef.current = '';
    setVoiceStatus('Assistant interrupted.');
  }

  function startListening() {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceStatus('Speech recognition is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      setVoiceStatus('Listening...');
    };

    recognition.onresult = (event: any) => {
      const transcript = event?.results?.[0]?.[0]?.transcript?.trim() || '';
      if (transcript) {
        setInput(transcript);
        void handleSend(transcript, 'voice');
      } else {
        setVoiceStatus('No speech detected.');
      }
    };

    recognition.onerror = (event: any) => {
      setVoiceStatus(`Speech error: ${event?.error || 'unknown error'}`);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  }

  const handleSend = async (forcedText?: string, forcedMode?: 'text' | 'voice') => {
    if (isLoading) return;
    const userMsg = (forcedText ?? input).trim();
    if (!userMsg) return;
    const sendMode = forcedMode || mode;
    setInput('');

    if (sendMode === 'voice' && realtimeConnected && dataChannelRef.current?.readyState === 'open') {
      void runAgenticTurn(userMsg, true);
      return;
    }

    appendMessage({ role: 'user', text: userMsg });
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: messages,
          message: userMsg,
          mode: sendMode,
          jobId: activeJobId(),
        })
      });

      if (!response.ok) {
        throw new Error('Failed to get chat response');
      }

      const data = await response.json();
      const responseText = data?.data?.text || data?.text || 'No response text returned.';
      setMessages(prev => [...prev, { role: 'model', text: responseText }]);
      if (sendMode === 'voice' && voiceTransport !== 'realtime') {
        speakText(responseText);
      }
    } catch (err: any) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'model', text: 'Sorry, I encountered an error. Please try again later.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-cyan-600 hover:bg-cyan-500 text-white rounded-full shadow-[0_0_15px_rgba(8,145,178,0.5)] flex items-center justify-center transition-transform hover:scale-110 z-50 focus:outline-none"
      >
        {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
      </button>

      {/* Chat Window */}
      <div className={`fixed bottom-24 right-6 w-80 sm:w-96 h-[500px] max-h-[calc(100vh-120px)] bg-slate-900 border border-slate-800 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] flex flex-col z-50 overflow-hidden transform transition-all duration-300 ${isOpen ? 'translate-y-0 opacity-100 visible' : 'translate-y-8 opacity-0 invisible pointer-events-none'}`}>
        <div className="px-4 py-3 bg-slate-950 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-cyan-400" />
              <h3 className="font-semibold text-slate-100 text-sm tracking-wide flex items-center gap-2">Project Assistant <span className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider">VOICE READY</span></h3>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
              <button
                onClick={() => {
                  setMode('text');
                  stopListening();
                  stopRealtimeConnection();
                  setVoiceTransport('idle');
                  setVoiceStatus('Voice is off.');
                }}
                className={`rounded px-2 py-1 border ${mode === 'text' ? 'border-cyan-500 text-cyan-300' : 'border-slate-700 text-slate-400'}`}
              >
                Text
              </button>
              <button
                onClick={async () => {
                  setMode('voice');
                  await initVoiceSession();
                }}
                className={`rounded px-2 py-1 border ${mode === 'voice' ? 'border-cyan-500 text-cyan-300' : 'border-slate-700 text-slate-400'}`}
              >
                Voice
              </button>
              {mode === 'voice' && realtimeConnected ? (
                <button
                  onClick={interruptRealtimeAssistant}
                  className="rounded px-2 py-1 border border-amber-500 text-amber-300"
                >
                  Interrupt
                </button>
              ) : null}
            </div>
            <p className="text-[10px] text-slate-500">{voiceStatus}</p>
          </div>
          <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-200 focus:outline-none transition-colors rounded hover:bg-slate-800 p-1 self-start">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 p-4 overflow-y-auto bg-slate-900/50 custom-scrollbar flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="text-center flex flex-col items-center justify-center h-full text-slate-500 gap-3 px-4">
              <Bot className="w-10 h-10 text-slate-700" />
              <p className="text-xs">Ask about the active project’s workflow, evidence, mappings, workbook rows, or QA blockers.</p>
            </div>
          )}
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-3 max-w-[90%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-slate-800 border border-slate-700 shadow-sm'}`}>
                {msg.role === 'user' ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-cyan-400" />}
              </div>
              <div className={`p-3 text-[13px] ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-sm shadow-sm' : 'bg-slate-800 text-slate-200 rounded-2xl rounded-tl-sm border border-slate-700 shadow-sm whitespace-pre-wrap leading-relaxed'}`}>
                {msg.text}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3 max-w-[90%] mr-auto">
              <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 shadow-sm flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="p-3 text-[13px] bg-slate-800 text-slate-400 rounded-2xl rounded-tl-sm border border-slate-700 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-500" />
                Processing request...
              </div>
            </div>
          )}
          <div ref={endOfMessagesRef} />
        </div>

        <div className="p-3 bg-slate-950 border-t border-slate-800 shrink-0">
          <div className="mb-2 flex items-center gap-2">
            <button type="button" onClick={optimizeInput} disabled={!input.trim() || isLoading} className="rounded px-2 py-1 border border-slate-700 text-[10px] text-cyan-300 disabled:text-slate-600 flex items-center gap-1"><Sparkles className="w-3 h-3"/> Optimize</button>
            {optimizationOriginal !== undefined ? <button type="button" onClick={() => { setInput(optimizationOriginal); setOptimizationOriginal(undefined); setOptimizationStatus('Original prompt restored.'); }} className="rounded px-2 py-1 border border-slate-700 text-[10px] text-slate-300 flex items-center gap-1"><Undo2 className="w-3 h-3"/> Undo</button> : null}
            {optimizationStatus ? <span className="text-[9px] text-slate-500 truncate" title={optimizationStatus}>{optimizationStatus}</span> : null}
          </div>
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl pl-3 pr-1 py-1 focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-500/50 transition-all shadow-inner">
            <input 
              type="text"
              placeholder="Ask me anything..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleSend(); }}
              className="flex-1 bg-transparent border-none outline-none text-slate-200 text-[13px] py-1.5 placeholder-slate-500"
            />
            {mode === 'voice' ? (
              <button
                onClick={() => {
                  if (realtimeConnected) {
                    toggleRealtimeMute();
                    return;
                  }
                  if (isListening) {
                    stopListening();
                  } else {
                    startListening();
                  }
                }}
                title={realtimeConnected ? (micMuted ? 'Unmute realtime mic' : 'Mute realtime mic') : isListening ? 'Stop listening' : 'Start listening'}
                className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors focus:outline-none shrink-0 ${realtimeConnected ? (micMuted ? 'bg-rose-600 border-rose-500 text-white' : 'bg-emerald-700 border-emerald-500 text-white') : isListening ? 'bg-rose-600 border-rose-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'}`}
              >
                {realtimeConnected ? (micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />) : isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            ) : null}
            <button 
              onClick={() => void handleSend()}
              disabled={isLoading || !input.trim()}
              className="w-8 h-8 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 border disabled:border-slate-700 border-cyan-500 text-white flex items-center justify-center transition-colors focus:outline-none shrink-0"
            >
              <Send className="w-4 h-4 ml-0.5" />
            </button>
            {mode === 'voice' ? <Volume2 className={`w-4 h-4 ${realtimeConnected ? 'text-emerald-400' : 'text-cyan-400'}`} /> : null}
            {mode === 'voice' && realtimeConnected ? (
              <button
                onClick={() => {
                  stopRealtimeConnection();
                  setVoiceTransport('fallback');
                  setVoiceStatus('Realtime disconnected. Fallback voice mode is active.');
                }}
                title="Disconnect realtime voice"
                className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 flex items-center justify-center"
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
    </>
  );
}
