import React, { useState } from 'react';
import JSZip from 'jszip';
import { DownloadIcon, ClipboardIcon } from './icons';
import { ImageAsset } from '../types';

interface ResultPreviewProps {
  markdown: string;
  assets: ImageAsset[];
  onDownload: () => void;
  onClear: () => void;
  onReprocess: () => void;
  filename: string;
  onFilenameChange: (newFilename: string) => void;
}

const ResultPreview: React.FC<ResultPreviewProps> = ({
  markdown,
  assets,
  onDownload,
  onClear,
  onReprocess,
  filename,
  onFilenameChange,
}) => {
  const [isCopied, setIsCopied] = useState(false);
  
  if (!markdown) {
    return null;
  }
  
  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(markdown).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
      alert('Failed to copy markdown to clipboard.');
    });
  };
  
  const handleDownloadAssets = async () => {
    if (assets.length === 0) return;
    const zip = new JSZip();
    const assetsFolder = zip.folder("assets");

    if (assetsFolder) {
        assets.forEach(asset => {
            assetsFolder.file(asset.fileName, asset.data, { base64: true });
        });
    }
    
    const zipBlob = await zip.generateAsync({ type: "blob" });
    
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}-assets.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };


  return (
    <div className="w-full max-w-2xl mx-auto mt-8 animate-fade-in">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-slate-300">Processing Result</h2>
        <div className="flex items-center space-x-2">
            <button
                onClick={handleCopyToClipboard}
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-indigo-500 disabled:bg-indigo-400"
                disabled={isCopied}
            >
                <ClipboardIcon className="w-5 h-5 mr-2" />
                {isCopied ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={onReprocess}
              className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700 rounded-md hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-indigo-500"
            >
              Reprocess
            </button>
            <button
              onClick={onClear}
              className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700 rounded-md hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-indigo-500"
            >
              Start Over
            </button>
        </div>
      </div>

      <div className="bg-slate-800 p-4 rounded-lg mb-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
        <div className="flex-grow">
          <label htmlFor="filename-input" className="text-sm font-medium text-slate-400">Filename</label>
          <div className="flex rounded-md shadow-sm mt-1">
            <input
              type="text"
              id="filename-input"
              value={filename}
              onChange={(e) => onFilenameChange(e.target.value)}
              className="block w-full flex-1 rounded-none rounded-l-md bg-slate-700 border-slate-600 text-slate-200 sm:text-sm focus:ring-indigo-500 focus:border-indigo-500 px-3 py-2"
              placeholder="processing-title"
            />
            <span className="inline-flex items-center px-3 rounded-r-md border border-l-0 border-slate-600 bg-slate-600 text-slate-300 text-sm">
              .md
            </span>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:self-end">
            {assets.length > 0 && (
                <button
                    onClick={handleDownloadAssets}
                    className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-sky-600 border border-transparent rounded-md shadow-sm hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-sky-500 h-10"
                    >
                    <DownloadIcon className="w-5 h-5 mr-2" />
                    Download Assets ({assets.length})
                </button>
            )}
            <button
              onClick={onDownload}
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-indigo-500 h-10"
            >
              <DownloadIcon className="w-5 h-5 mr-2" />
              Download Markdown
            </button>
        </div>
      </div>

      <pre className="bg-slate-800 p-4 rounded-lg text-sm text-slate-300 max-h-96 overflow-y-auto whitespace-pre-wrap font-mono">
        <code>{markdown}</code>
      </pre>
    </div>
  );
};

export default ResultPreview;