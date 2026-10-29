import React, { useState, useEffect, useRef } from 'react';
import { UploadedFile, ProcessingStatus } from '../types';
import { FileAudioIcon, SpinnerIcon, CheckCircleIcon, XCircleIcon, DragHandleIcon, TrashIcon, FileImageIcon, FileTextIcon, FileVideoIcon, CropIcon } from './icons';

interface FileListProps {
  files: UploadedFile[];
  onReorder: (files: UploadedFile[]) => void;
  isProcessing: boolean;
  onRemoveMultiple: (ids: string[]) => void;
  onUpdateFile: (id: string, updates: Partial<UploadedFile>) => void;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onOpenCropModal: (id: string) => void;
}

const StatusIndicator: React.FC<{ uploadedFile: UploadedFile }> = ({ uploadedFile }) => {
  const { status, processingStartTime, processingEndTime } = uploadedFile;
  switch (status) {
    case ProcessingStatus.PENDING:
      return <p className="text-xs text-slate-400">Queued</p>;
    case ProcessingStatus.PROCESSING:
      return <SpinnerIcon className="w-5 h-5 text-indigo-400" />;
    case ProcessingStatus.DONE:
      let durationText = '';
      if (processingStartTime && processingEndTime) {
        const seconds = Math.round((processingEndTime - processingStartTime) / 1000);
        durationText = `(${seconds}s)`;
      }
      return (
        <div className="flex flex-col items-center space-y-1">
          <CheckCircleIcon className="w-5 h-5 text-green-400" />
          {durationText && <span className="text-xs text-slate-400">{durationText}</span>}
        </div>
      );
    case ProcessingStatus.ERROR:
      return <XCircleIcon className="w-5 h-5 text-red-400" />;
    default:
      return null;
  }
};

const ProcessingPreview: React.FC<{ uploadedFile: UploadedFile }> = ({ uploadedFile }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const lastPhaseRef = useRef<string>('');
  const phaseStartTimeRef = useRef<number>(uploadedFile.processingStartTime || Date.now());

  useEffect(() => {
    const isWaitingPhase = uploadedFile.currentLogMessage?.trim().startsWith('Waiting on AI to process');
    if (isWaitingPhase && lastPhaseRef.current !== 'waiting') {
        lastPhaseRef.current = 'waiting';
        phaseStartTimeRef.current = Date.now();
    } else if (!uploadedFile.currentLogMessage && uploadedFile.status === ProcessingStatus.PROCESSING) {
        // Fresh start
        lastPhaseRef.current = 'uploading';
        phaseStartTimeRef.current = uploadedFile.processingStartTime || Date.now();
    }
  }, [uploadedFile.currentLogMessage, uploadedFile.processingStartTime, uploadedFile.status]);

  useEffect(() => {
    let intervalId: number | undefined;

    if (uploadedFile.status === ProcessingStatus.PROCESSING) {
      const updateElapsed = () => {
          const startTime = phaseStartTimeRef.current;
          const seconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
          setElapsedSeconds(seconds);
      };
      
      updateElapsed();
      intervalId = window.setInterval(updateElapsed, 1000);
    } else {
        setElapsedSeconds(0);
        lastPhaseRef.current = '';
    }

    return () => clearInterval(intervalId);
  }, [uploadedFile.status]);
  
  const defaultText = uploadedFile.type === 'audio' 
    ? `Processing transcription... (${elapsedSeconds}s)` 
    : `Processing image... (${elapsedSeconds}s)`;

  const statusText = uploadedFile.currentLogMessage ? `${uploadedFile.currentLogMessage} (${elapsedSeconds}s)` : defaultText;

  let progressPercentage: number | null = null;
  let displayText = statusText;
  let asciiBar = '';
  const progressMatch = statusText.match(/\[(\d+)%\]/);
  if (progressMatch) {
      progressPercentage = parseInt(progressMatch[1], 10);
      displayText = statusText.replace(/\[\d+%\]/, '').trim();
      const barLength = 25;
      const filledLength = Math.floor((progressPercentage / 100) * barLength);
      const emptyLength = barLength - filledLength;
      const barConfig = '#'.repeat(filledLength) + '-'.repeat(emptyLength);
      asciiBar = `[${barConfig}] ${progressPercentage}%`;
  }

  return (
    <div className="mt-2 text-xs text-slate-400 bg-slate-900 p-2 rounded-md h-24 overflow-hidden font-mono border border-slate-700 flex flex-col justify-between">
      <div>
        {uploadedFile.retryingMessage ? (
          <p className="text-yellow-400">{uploadedFile.retryingMessage}</p>
        ) : (
          <p className="text-slate-500">{displayText}</p>
        )}
        {progressPercentage !== null && (
          <p className="text-indigo-400 mt-1">{asciiBar}</p>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-right">
        {(uploadedFile.partialTranscription || '')
            .split('\n')
            .slice(-4)
            .join('\n')}
      </p>
    </div>
  );
};

const ImageFileDetails: React.FC<{ uploadedFile: UploadedFile; onUpdateFile: (id: string, updates: Partial<UploadedFile>) => void; isProcessing: boolean; onOpenCropModal: (id: string) => void; }> = ({ uploadedFile, onUpdateFile, isProcessing, onOpenCropModal }) => {
    const [thumbUrl, setThumbUrl] = useState<string | null>(null);
    const [previewSize, setPreviewSize] = useState<{ width: number, height: number } | null>(null);

    useEffect(() => {
        const url = URL.createObjectURL(uploadedFile.file);
        setThumbUrl(url);

        const img = new Image();
        img.onload = () => {
            const width = img.naturalWidth / 2;
            const height = img.naturalHeight / 2;
            setPreviewSize({ width, height });
        };
        img.src = url;

        return () => URL.revokeObjectURL(url);
    }, [uploadedFile.file]);

    const handleImageTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onUpdateFile(uploadedFile.id, { imageType: e.target.checked ? 'no-text' : 'text' });
    };
    
    const isCroppable = uploadedFile.status === ProcessingStatus.PENDING && !isProcessing;

    return (
        <div className="flex items-center space-x-4 flex-1 min-w-0">
            <div className="relative group flex-shrink-0">
                {thumbUrl ? (
                    <img src={thumbUrl} alt={uploadedFile.file.name} className="w-12 h-12 rounded-md object-cover bg-slate-700"/>
                ) : (
                    <div className="w-12 h-12 rounded-md bg-slate-700 flex items-center justify-center">
                        <FileImageIcon className="w-6 h-6 text-slate-400" />
                    </div>
                )}
                {/* --- Tooltip --- */}
                {thumbUrl && previewSize && (
                    <div className="absolute bottom-0 left-full ml-4 p-1.5 bg-slate-900/80 backdrop-blur-sm border border-slate-600 rounded-lg shadow-2xl 
                                   invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all duration-150 z-20
                                   transform group-hover:scale-100 scale-95 origin-bottom-left w-max">
                        <img 
                            src={thumbUrl} 
                            alt={`${uploadedFile.file.name} preview`} 
                            className="rounded"
                            style={{ width: `${previewSize.width}px`, height: `${previewSize.height}px` }}
                        />
                    </div>
                )}
            </div>
            
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate" title={uploadedFile.file.name}>
                    {uploadedFile.file.name}
                </p>
                {isCroppable && (
                    <div className="flex items-center mt-1.5 space-x-4">
                        {uploadedFile.imageAnalysisStatus === 'PENDING' && <SpinnerIcon className="w-4 h-4 mr-2 text-slate-400" />}
                        {uploadedFile.imageAnalysisStatus === 'DONE' && (
                            <>
                                <div className="flex items-center">
                                    <input
                                        id={`no-text-checkbox-${uploadedFile.id}`}
                                        type="checkbox"
                                        checked={uploadedFile.imageType === 'no-text'}
                                        onChange={handleImageTypeChange}
                                        className="h-4 w-4 rounded bg-slate-700 border-slate-500 text-indigo-500 focus:ring-indigo-600 focus:ring-offset-slate-800"
                                        aria-label="Mark image as containing no significant text"
                                    />
                                    <label htmlFor={`no-text-checkbox-${uploadedFile.id}`} className="ml-2 text-xs text-slate-300 select-none">No Text</label>
                                </div>
                                <button
                                    onClick={() => onOpenCropModal(uploadedFile.id)}
                                    className="flex items-center text-xs text-slate-400 hover:text-indigo-400 transition-colors"
                                    title="Manually crop this image"
                                >
                                    <CropIcon className="w-4 h-4 mr-1.5" />
                                    Crop
                                </button>
                            </>
                        )}
                        {uploadedFile.imageAnalysisStatus === 'ERROR' && <p className="text-xs text-red-400">Analysis failed</p>}
                    </div>
                )}
                 {uploadedFile.status === ProcessingStatus.PROCESSING && (
                    <ProcessingPreview uploadedFile={uploadedFile} />
                )}
                {uploadedFile.status === ProcessingStatus.ERROR && (
                    <p className="text-xs text-red-400 mt-1 break-words" title={uploadedFile.error}>{uploadedFile.error}</p>
                )}
            </div>
        </div>
    );
};

const AudioFileDetails: React.FC<{ uploadedFile: UploadedFile }> = ({ uploadedFile }) => {
    return (
        <div className="flex items-center space-x-4 flex-1 min-w-0">
            <FileAudioIcon className="w-6 h-6 text-slate-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate" title={uploadedFile.file.name}>
                    {uploadedFile.originalFileName && typeof uploadedFile.chunkIndex !== 'undefined' && uploadedFile.totalChunks
                        ? `${uploadedFile.originalFileName} (Part ${uploadedFile.chunkIndex}/${uploadedFile.totalChunks})`
                        : uploadedFile.file.name}
                </p>
                {uploadedFile.status === ProcessingStatus.PROCESSING && (
                    <ProcessingPreview uploadedFile={uploadedFile} />
                )}
                {uploadedFile.status === ProcessingStatus.ERROR && (
                    <p className="text-xs text-red-400 mt-1 break-words" title={uploadedFile.error}>{uploadedFile.error}</p>
                )}
            </div>
        </div>
    );
};

const TextFileDetails: React.FC<{ uploadedFile: UploadedFile }> = ({ uploadedFile }) => {
    const [textContent, setTextContent] = useState<string | null>(null);

    useEffect(() => {
        uploadedFile.file.text()
            .then(text => {
                const previewText = text.length > 5000 ? text.substring(0, 5000) + "\n\n... (file truncated for preview)" : text;
                setTextContent(previewText);
            })
            .catch(() => {
                setTextContent("Could not read file content for preview.");
            });
    }, [uploadedFile.file]);

    return (
        <div className="flex items-center space-x-4 flex-1 min-w-0">
            <div className="relative group flex-shrink-0">
                <FileTextIcon className="w-6 h-6 text-slate-400" />
                {/* --- Tooltip Preview --- */}
                {textContent && (
                    <div className="absolute bottom-0 left-full ml-4 p-2 bg-slate-900/80 backdrop-blur-sm border border-slate-600 rounded-lg shadow-2xl 
                                  invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all duration-150 z-20
                                  transform group-hover:scale-100 scale-95 origin-bottom-left w-max max-w-sm">
                        <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto p-1">
                            <code>{textContent}</code>
                        </pre>
                    </div>
                )}
            </div>

            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate" title={uploadedFile.originalFileName || uploadedFile.file.name}>
                    {uploadedFile.originalFileName || uploadedFile.file.name}
                </p>
                {uploadedFile.status === ProcessingStatus.PROCESSING && (
                    <p className="text-xs text-slate-400 mt-1">Processing...</p>
                )}
                {uploadedFile.status === ProcessingStatus.ERROR && (
                    <p className="text-xs text-red-400 mt-1 break-words" title={uploadedFile.error}>{uploadedFile.error}</p>
                )}
            </div>
        </div>
    );
};


const FileList: React.FC<FileListProps> = ({ files, onReorder, isProcessing, onRemoveMultiple, onUpdateFile, selectedIds, onSelectionChange, onOpenCropModal }) => {
  const dragItem = useRef<string | null>(null);
  const dragOverItem = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent<HTMLLIElement>, id: string) => {
    dragItem.current = id;
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnter = (e: React.DragEvent<HTMLLIElement>, id: string) => {
    e.preventDefault();
    if (dragItem.current !== id) {
      dragOverItem.current = id;
    }
  };

  const handleDragEnd = () => {
    if (dragItem.current && dragOverItem.current && dragItem.current !== dragOverItem.current) {
        const newFiles = [...files];
        const dragItemIndex = newFiles.findIndex(f => f.id === dragItem.current);
        const dragOverItemIndex = newFiles.findIndex(f => f.id === dragOverItem.current);
        
        if (dragItemIndex > -1 && dragOverItemIndex > -1) {
            const [draggedItem] = newFiles.splice(dragItemIndex, 1);
            newFiles.splice(dragOverItemIndex, 0, draggedItem);
            onReorder(newFiles);
        }
    }
    dragItem.current = null;
    dragOverItem.current = null;
    setDraggingId(null);
  };
  
  const handleToggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
        newSet.delete(id);
    } else {
        newSet.add(id);
    }
    onSelectionChange(newSet);
  };

  const handleDeleteSelected = () => {
      if (selectedIds.size > 0) {
          onRemoveMultiple(Array.from(selectedIds));
          onSelectionChange(new Set());
      }
  };

  if (files.length === 0) {
    return null;
  }
  
  const canReorder = !isProcessing && files.some(f => f.status === ProcessingStatus.PENDING);

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold text-slate-300">Chunk Queue</h2>
        {selectedIds.size > 0 && !isProcessing && (
            <button
                onClick={handleDeleteSelected}
                className="flex items-center px-3 py-1.5 text-sm font-medium text-red-400 bg-slate-700/50 rounded-md hover:bg-slate-700 hover:text-red-300 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-red-500"
                aria-label={`Delete ${selectedIds.size} selected items`}
            >
                <TrashIcon className="w-4 h-4 mr-2" />
                Delete ({selectedIds.size})
            </button>
        )}
      </div>
      <ul className="space-y-3">
        {files.map((uploadedFile) => {
            const isDraggable = canReorder && uploadedFile.status === ProcessingStatus.PENDING;
            const isSelectable = !isProcessing && uploadedFile.status === ProcessingStatus.PENDING;
            return (
              <li
                key={uploadedFile.id}
                className={`flex items-center bg-slate-800 p-3 rounded-lg shadow-md transition-opacity ${draggingId === uploadedFile.id ? 'opacity-50' : 'opacity-100'}`}
                draggable={isDraggable}
                onDragStart={(e) => isDraggable && handleDragStart(e, uploadedFile.id)}
                onDragEnter={(e) => isDraggable && handleDragEnter(e, uploadedFile.id)}
                onDragEnd={() => isDraggable && handleDragEnd()}
                onDragOver={(e) => e.preventDefault()}
              >
                <div className="flex items-center min-w-0 flex-grow">
                   {canReorder ? (
                        <div className={`flex-shrink-0 mr-3 text-slate-500 ${isDraggable ? 'hover:text-slate-300 cursor-grab active:cursor-grabbing' : 'opacity-30'}`}>
                            <DragHandleIcon className="w-5 h-5" />
                        </div>
                    ) : <div className="w-5 mr-3 flex-shrink-0"></div>}

                    {(() => {
                        switch (uploadedFile.type) {
                            case 'audio':
                                return <AudioFileDetails uploadedFile={uploadedFile} />;
                            case 'image':
                                return <ImageFileDetails uploadedFile={uploadedFile} onUpdateFile={onUpdateFile} isProcessing={isProcessing} onOpenCropModal={onOpenCropModal} />;
                            case 'text':
                                return <TextFileDetails uploadedFile={uploadedFile} />;
                            default:
                                return <p>Unsupported file type</p>;
                        }
                    })()}
                </div>
                
                <div className="ml-4 flex-shrink-0 w-24 flex justify-center items-center">
                  <StatusIndicator uploadedFile={uploadedFile} />
                </div>

                <div className="ml-2 flex-shrink-0 w-8 flex justify-end items-center">
                  {isSelectable && (
                    <input
                        type="checkbox"
                        checked={selectedIds.has(uploadedFile.id)}
                        onChange={() => handleToggleSelect(uploadedFile.id)}
                        className="h-5 w-5 rounded bg-slate-700 border-slate-500 text-indigo-500 focus:ring-indigo-600 focus:ring-offset-slate-800 focus:ring-offset-2 cursor-pointer"
                        aria-label={`Select ${uploadedFile.file.name}`}
                    />
                  )}
                </div>
              </li>
            )
        })}
      </ul>
    </div>
  );
};

export default FileList;