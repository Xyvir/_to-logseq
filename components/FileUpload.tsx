import React from 'react';
import { UploadIcon } from './icons';

interface FileUploadProps {
  onFilesSelected: (files: FileList | File[] | null) => void;
  disabled: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFilesSelected, disabled }) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFilesSelected(e.target.files);
    // Reset file input to allow re-uploading the same file
    if(fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    
    e.currentTarget.classList.remove('border-indigo-400', 'bg-slate-700/50');
    e.currentTarget.classList.add('border-slate-600');

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesSelected(e.dataTransfer.files);
      e.dataTransfer.clearData();
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };
  
  const handleDragEnter = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    e.currentTarget.classList.add('border-indigo-400', 'bg-slate-700/50');
    e.currentTarget.classList.remove('border-slate-600');
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    e.currentTarget.classList.remove('border-indigo-400', 'bg-slate-700/50');
    e.currentTarget.classList.add('border-slate-600');
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <label
        htmlFor="file-upload"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        className={`relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg transition-colors duration-200 ${
          disabled 
            ? 'cursor-not-allowed bg-slate-800/50 border-slate-700' 
            : 'cursor-pointer bg-slate-800 hover:bg-slate-700/50 hover:border-indigo-500 border-slate-600'
        }`}
      >
        <div className={`flex flex-col items-center justify-center pt-5 pb-6 ${disabled ? 'text-slate-500' : 'text-slate-400'}`}>
          <UploadIcon className="w-10 h-10 mb-3" />
          <p className="mb-2 text-sm"><span className={`font-semibold ${!disabled ? 'text-indigo-400' : ''}`}>Click to upload</span>, drag & drop, or paste</p>
          <p className="text-xs">MP3, WAV, PNG, JPG, PDF, TXT, MD, HTML, DOCX, EPUB, etc.</p>
          <p className="text-xs text-slate-500 mt-1">(Large files are limited to 2 GB)</p>
        </div>
        <input
          ref={fileInputRef}
          id="file-upload"
          type="file"
          multiple
          accept="audio/*,image/*,text/plain,.md,.txt,application/pdf,text/html,.html,.htm,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/epub+zip,.epub"
          className="opacity-0 absolute inset-0 w-full h-full"
          onChange={handleFileChange}
          disabled={disabled}
        />
      </label>
    </div>
  );
};

export default FileUpload;