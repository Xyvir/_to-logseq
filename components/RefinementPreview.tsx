import React, { useEffect, useRef } from 'react';

interface RefinementPreviewProps {
  content: string;
}

const RefinementPreview: React.FC<RefinementPreviewProps> = ({ content }) => {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    // Auto-scroll to the bottom as new content is added
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [content]);

  return (
    <div className="w-full max-w-2xl mx-auto mt-8 animate-fade-in">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-slate-300">Refining Document...</h2>
      </div>
      <pre
        ref={preRef}
        className="bg-slate-800 p-4 rounded-lg text-sm text-slate-300 h-80 overflow-y-auto whitespace-pre-wrap font-mono"
      >
        <code>
          {content}
          <span className="inline-block w-2 h-4 bg-green-400 animate-pulse ml-1" aria-hidden="true"></span>
        </code>
      </pre>
    </div>
  );
};

export default RefinementPreview;
