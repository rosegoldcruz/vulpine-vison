import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, X, Bot, User, Loader2 } from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [modelType, setModelType] = useState('gemini-3.5-flash');
  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: messages,
          message: userMsg,
          model: modelType
        })
      });

      if (!response.ok) {
        throw new Error('Failed to get chat response');
      }

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'model', text: data.text }]);
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
        className="fixed bottom-6 left-6 w-14 h-14 bg-cyan-600 hover:bg-cyan-500 text-white rounded-full shadow-[0_0_15px_rgba(8,145,178,0.5)] flex items-center justify-center transition-transform hover:scale-110 z-50 focus:outline-none"
      >
        {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
      </button>

      {/* Chat Window */}
      <div className={`fixed bottom-24 left-6 w-80 sm:w-96 h-[500px] max-h-[calc(100vh-120px)] bg-slate-900 border border-slate-800 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] flex flex-col z-50 overflow-hidden transform transition-all duration-300 ${isOpen ? 'translate-y-0 opacity-100 visible' : 'translate-y-8 opacity-0 invisible pointer-events-none'}`}>
        <div className="px-4 py-3 bg-slate-950 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-cyan-400" />
              <h3 className="font-semibold text-slate-100 text-sm tracking-wide flex items-center gap-2">Repo Assistant <span className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider">GEMINI AI</span></h3>
            </div>
            <select
              title="Select Capability Model"
              value={modelType}
              onChange={(e) => setModelType(e.target.value)}
              className="mt-1 bg-slate-900 border border-slate-700 text-xs text-slate-300 rounded px-2 py-1 outline-none focus:border-cyan-500"
            >
              <option value="gemini-3.1-flash-lite">Fast & Light (gemini-3.1-flash-lite)</option>
              <option value="gemini-3.5-flash">General Tasks (gemini-3.5-flash)</option>
              <option value="gemini-3.1-pro-preview">Complex Code/Math (gemini-3.1-pro-preview)</option>
            </select>
          </div>
          <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-200 focus:outline-none transition-colors rounded hover:bg-slate-800 p-1 self-start">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 p-4 overflow-y-auto bg-slate-900/50 custom-scrollbar flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="text-center flex flex-col items-center justify-center h-full text-slate-500 gap-3 px-4">
              <Bot className="w-10 h-10 text-slate-700" />
              <p className="text-xs">Hi! I'm a repository-aware chatbot using Google Gemini. I can assist you with your bidding pipeline tasks and structural blueprints processing.</p>
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
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-xl pl-3 pr-1 py-1 focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-500/50 transition-all shadow-inner">
            <input 
              type="text"
              placeholder="Ask me anything..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
              className="flex-1 bg-transparent border-none outline-none text-slate-200 text-[13px] py-1.5 placeholder-slate-500"
            />
            <button 
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="w-8 h-8 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 border disabled:border-slate-700 border-cyan-500 text-white flex items-center justify-center transition-colors focus:outline-none shrink-0"
            >
              <Send className="w-4 h-4 ml-0.5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
