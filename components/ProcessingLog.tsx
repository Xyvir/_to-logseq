
import React, { useEffect, useRef } from 'react';

interface ProcessingLogProps {
  logs: string[];
}

const ProcessingLog: React.FC<ProcessingLogProps> = ({ logs }) => {
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      ref={logContainerRef}
      className="w-full bg-slate-950/70 border border-slate-700 rounded-lg p-4 h-48 overflow-y-auto font-mono text-xs text-slate-400 mt-4 animate-fade-in"
      aria-live="polite"
      aria-atomic="false"
      role="log"
    >
      {logs.map((log, index) => (
        <p key={index} className="whitespace-pre-wrap break-words leading-relaxed">
          <span className="text-indigo-400 mr-2 select-none">&gt;</span>{log}
        </p>
      ))}
    </div>
  );
};

export default ProcessingLog;
