import { useState } from 'react';
import { Send, MoreVertical } from 'lucide-react';

export default function RigbyChat({ metrics: _metrics }: { metrics: any }) {
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Array<{role: 'user' | 'assistant', content: string}>>([
    {
      role: 'assistant',
      content: "Hey, I'm Rigby. Tell me how many trucks you're running and I'll tell you if the numbers make sense.",
    },
  ]);

  const send = () => {
    if (!input.trim()) return;
    setMsgs((m) => [...m, { role: 'user', content: input.trim() }]);
    setInput('');
    setTimeout(() => {
      setMsgs((m) => [
        ...m,
        {
          role: 'assistant',
          content: "Got it. With 0 trucks showing right now, let's add your first unit or upload a CSV.",
        },
      ]);
    }, 400);
  };

  return (
    <aside className="w-80 bg-slate-950/30 border-l border-slate-800 h-full flex flex-col">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">Rigby chat</p>
          <p className="text-sm text-white font-semibold">Fleet Advisor AI</p>
        </div>
        <button className="text-slate-400 hover:text-slate-100">
          <MoreVertical size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {msgs.map((m, idx) => (
          <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
              m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-slate-900/70 border border-slate-800 text-slate-100'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-slate-800 bg-slate-950">
        <div className="flex gap-2 rounded-xl bg-slate-900/60 border border-slate-700 px-2 py-1.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
            placeholder="Ask Rigby about CPM..."
          />
          <button onClick={send} className="text-blue-300 hover:text-blue-100">
            <Send size={17} />
          </button>
        </div>
      </div>
    </aside>
  );
}
