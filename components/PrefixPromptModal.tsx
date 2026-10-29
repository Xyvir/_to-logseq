import React, { useState } from 'react';

interface PrefixPromptModalProps {
  onConfirm: (prefix: string) => void;
  onCancel: () => void;
}

const PrefixPromptModal: React.FC<PrefixPromptModalProps> = ({ onConfirm, onCancel }) => {
  const [value, setValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanValue = value.trim().replace(/[^a-zA-Z0-9]/g, '').substring(0, 5).toUpperCase();
    onConfirm(cleanValue || 'DOC');
  };

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div
        className="bg-slate-800 rounded-xl max-w-md w-full overflow-hidden shadow-2xl border border-slate-700"
      >
        <div className="p-6">
          <h3 className="text-xl font-semibold text-slate-100 mb-2">Short Code Generation Failed</h3>
          <p className="text-slate-400 text-sm mb-6">
            The AI was unable to automatically generate a short code for these files. Please provide a 2 to 5 character code manually.
          </p>
          
          <form onSubmit={handleSubmit}>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. TIMQ"
              maxLength={5}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-6"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-slate-100 hover:bg-slate-700 transition-colors"
              >
                Skip (Use "DOC")
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors flex items-center gap-2"
              >
                Save Code
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default PrefixPromptModal;
