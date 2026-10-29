
import React, { useEffect, useRef } from 'react';

interface ProcessingLogProps {
  logs: string[];
  streamContent?: string;
}

const ProcessingLog: React.FC<ProcessingLogProps> = ({ logs, streamContent }) => {
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, streamContent]);

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
      {streamContent && (
        <pre className="whitespace-pre-wrap break-words leading-relaxed mt-2 text-slate-300 font-mono text-xs">
          <code>
            {streamContent}
            <span className="inline-block w-2 h-3 bg-green-400 animate-pulse ml-1 align-middle" aria-hidden="true"></span>
          </code>
        </pre>
      )}
    </div>
  );
};

export default ProcessingLog;
