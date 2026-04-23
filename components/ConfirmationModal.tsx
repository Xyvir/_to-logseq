import React from 'react';

interface ConfirmationModalProps {
  onClose: () => void;
  onConfirm: () => void;
  onIgnore: () => void;
  count: number;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ onClose, onConfirm, onIgnore, count }) => {
  return (
    <div
      className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
      aria-modal="true"
      role="dialog"
      aria-labelledby="confirmation-title"
    >
      <div className="bg-slate-800 rounded-lg shadow-2xl p-6 w-full max-w-lg border border-slate-700">
        <h2 id="confirmation-title" className="text-xl font-semibold text-slate-200 mb-4">Confirm Action</h2>
        <p className="text-slate-300 mb-6">
          You have {count} item(s) marked for deletion.
          <br />
          Would you like to permanently delete these items before processing the rest of the queue?
        </p>
        <div className="flex flex-col sm:flex-row-reverse justify-start gap-3">
          <button
            onClick={onConfirm}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-indigo-500"
          >
            Confirm Delete & Process
          </button>
          <button
            onClick={onIgnore}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700 rounded-md hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-indigo-500"
          >
            Ignore & Process All
          </button>
          <button
            onClick={onClose}
            className="w-full sm:w-auto mt-2 sm:mt-0 px-4 py-2 text-sm font-medium text-slate-300 bg-slate-600/50 rounded-md hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-indigo-500"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;