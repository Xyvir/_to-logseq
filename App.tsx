import React, { useState, useCallback, useEffect, useRef } from 'react';
import { UploadedFile, ProcessingStatus, ImageAsset } from './types';
import { transcribeAudioStream, classifyImageType, processImage } from './services/geminiService';
import { processPdfFile } from './services/pdfService';
import { processVideoFile } from './services/videoService';
import { chunkAudioFile } from './services/audioService';
import FileUpload from './components/FileUpload';
import FileList from './components/FileList';
import ResultPreview from './components/TranscriptionPreview';
import ProcessingLog from './components/ProcessingLog';
import ApiUsageCounter from './components/ApiUsageCounter';
import { SpinnerIcon } from './components/icons';
import JSZip from 'jszip';


// --- React Component ---

const calculateTotalSize = (files: UploadedFile[]): number => {
    const processedOriginals = new Set<string>();
    let total = 0;

    files.forEach(file => {
        // If it's a chunk of a larger file, only count the original's size once
        if (file.originalFileName) {
            if (!processedOriginals.has(file.originalFileName)) {
                total += file.originalFileSize || 0;
                processedOriginals.add(file.originalFileName);
            }
        } 
        // If it's a standalone file
        else {
            total += file.originalFileSize || file.file.size;
        }
    });
    return total;
};


const App: React.FC = () => {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [markdown, setMarkdown] = useState('');
  const [allAssets, setAllAssets] = useState<ImageAsset[]>([]);
  const [finalFilename, setFinalFilename] = useState('logseq-export');
  const [logs, setLogs] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [autoStartProcessing, setAutoStartProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState({ completed: 0, total: 0 });

  const prevIsPreparingRef = useRef<boolean>(isPreparing);
  
  const MAX_SESSION_SIZE = 4 * 1024 * 1024 * 1024; // 4 GB
  const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
  
  const totalSize = calculateTotalSize(uploadedFiles);

  const addLog = useCallback((message: string, replaceLast = false) => {
    setLogs(prevLogs => {
      const newLogs = replaceLast ? prevLogs.slice(0, -1) : prevLogs;
      return [...newLogs, message];
    });
  }, []);

  const handleClear = () => {
    setUploadedFiles([]); setIsProcessing(false); setMarkdown(''); setAllAssets([]);
    setFinalFilename('logseq-export'); setLogs([]);
    setUploadError(null); setAutoStartProcessing(false);
  };
  
  const handleReprocess = () => {
    setUploadedFiles(prevFiles => 
        prevFiles.map(file => ({
            ...file,
            status: ProcessingStatus.PENDING,
            transcription: undefined,
            partialTranscription: undefined,
            error: undefined,
            assets: undefined,
            processingStartTime: undefined,
            processingEndTime: undefined,
            retryingMessage: undefined,
        }))
    );
    setMarkdown('');
    setAllAssets([]);
    setProcessingProgress({ completed: 0, total: 0 });
  };
  
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
  
    setIsPreparing(true); setUploadError(null); setLogs(['Preparing uploaded files...']);
    const existingOriginalFilenames = new Set(uploadedFiles.map(f => f.originalFileName || f.file.name));
    const newFilesToQueue: UploadedFile[] = [];
    
    const currentSize = calculateTotalSize(uploadedFiles);
    let sizeOfNewFiles = 0;

    for (const file of Array.from(fileList)) {
        let newName = file.name;
        if (existingOriginalFilenames.has(newName)) {
            const namePart = newName.substring(0, newName.lastIndexOf('.'));
            const extPart = newName.substring(newName.lastIndexOf('.'));
            let counter = 2;
            do { newName = `${namePart}_${counter++}${extPart}`; } while (existingOriginalFilenames.has(newName));
        }
        existingOriginalFilenames.add(newName);
        const uniqueFile = new File([file], newName, { type: file.type, lastModified: file.lastModified });
        const fileId = `${uniqueFile.name}-${Date.now()}`;
        
        if (currentSize + sizeOfNewFiles + uniqueFile.size > MAX_SESSION_SIZE) {
            setUploadError(`Session quota full. Adding "${uniqueFile.name}" would exceed the 4 GB session limit.`);
            addLog(`[${uniqueFile.name}] Error: Adding file would exceed the 4 GB session quota.`);
            break;
        }

        if (uniqueFile.type.startsWith('audio/')) {
            try {
                if (uniqueFile.size > MAX_FILE_SIZE) {
                  setUploadError(`Error: "${uniqueFile.name}" (${formatSize(uniqueFile.size)}) exceeds the file limit of ${formatSize(MAX_FILE_SIZE)}.`);
                  addLog(`[${uniqueFile.name}] Error: File size exceeds the 2 GB limit.`);
                  continue;
                }
                const { chunkData } = await chunkAudioFile(uniqueFile, addLog);
                const isChunked = chunkData.length > 1;
                newFilesToQueue.push(...chunkData.map((chunk, index): UploadedFile => ({
                    id: `${fileId}-${index}`,
                    type: 'audio',
                    file: chunk.file,
                    duration: chunk.duration,
                    status: ProcessingStatus.PENDING,
                    originalFileName: isChunked ? uniqueFile.name : undefined,
                    originalFileSize: isChunked ? uniqueFile.size : undefined,
                    chunkIndex: isChunked ? index + 1 : undefined,
                    totalChunks: isChunked ? chunkData.length : undefined,
                })));
                sizeOfNewFiles += uniqueFile.size;
                addLog(`[${uniqueFile.name}] Successfully processed and added to queue.`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                addLog(`[${uniqueFile.name}] Error: ${errorMessage}`);
                setUploadError(`Error with "${uniqueFile.name}": ${errorMessage}`);
            }
        } else if (uniqueFile.type.startsWith('video/')) {
            try {
                if (uniqueFile.size > MAX_FILE_SIZE) {
                  setUploadError(`Error: "${uniqueFile.name}" (${formatSize(uniqueFile.size)}) exceeds the file limit of ${formatSize(MAX_FILE_SIZE)}.`);
                  addLog(`[${uniqueFile.name}] Error: File size exceeds the 2 GB limit.`);
                  continue;
                }
                const processedVideoFiles = await processVideoFile(uniqueFile, addLog);
                newFilesToQueue.push(...processedVideoFiles);
                sizeOfNewFiles += uniqueFile.size;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                addLog(`[${uniqueFile.name}] Error processing video: ${errorMessage}`);
                setUploadError(`Error with "${uniqueFile.name}": ${errorMessage}`);
            }
        } else if (uniqueFile.type === 'application/pdf') {
            try {
                const processedPdfFiles = await processPdfFile(uniqueFile, addLog);
                newFilesToQueue.push(...processedPdfFiles);
                sizeOfNewFiles += uniqueFile.size;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                addLog(`[${uniqueFile.name}] Error processing PDF: ${errorMessage}`);
                setUploadError(`Error with "${uniqueFile.name}": ${errorMessage}`);
            }
        } else if (uniqueFile.type.startsWith('image/')) {
            const imageFile: UploadedFile = {
                id: fileId, file: uniqueFile, type: 'image', status: ProcessingStatus.PENDING,
                imageAnalysisStatus: 'PENDING', imageType: 'text',
                originalFileSize: uniqueFile.size,
            };
            newFilesToQueue.push(imageFile);
            sizeOfNewFiles += uniqueFile.size;
            
            classifyImageType(uniqueFile)
              .then(imageType => {
                setUploadedFiles(prev => prev.map(f => f.id === fileId ? { ...f, imageAnalysisStatus: 'DONE', imageType } : f));
              })
              .catch(err => {
                console.error("Image analysis failed:", err);
                setUploadedFiles(prev => prev.map(f => f.id === fileId ? { ...f, imageAnalysisStatus: 'ERROR', error: 'Failed to analyze image' } : f));
              });
        } else {
            const isTextFile = uniqueFile.type.startsWith('text/') || uniqueFile.name.endsWith('.md') || uniqueFile.name.endsWith('.txt') || !uniqueFile.name.includes('.');
            if (isTextFile) {
                const textFile: UploadedFile = {
                    id: fileId,
                    file: uniqueFile,
                    type: 'text',
                    status: ProcessingStatus.PENDING,
                    originalFileSize: uniqueFile.size,
                };
                newFilesToQueue.push(textFile);
                sizeOfNewFiles += uniqueFile.size;
            } else {
                addLog(`[${uniqueFile.name}] Skipped: Unsupported file type '${uniqueFile.type}'.`);
            }
        }
    }
  
    if (newFilesToQueue.length > 0) {
        setUploadedFiles(prev => [...prev, ...newFilesToQueue]);
    }
    setLogs([]);
    setIsPreparing(false);
  };
  
  const handleProcess = useCallback(async () => {
    setIsProcessing(true);
    let tempMarkdown = '';
    const tempAssets: ImageAsset[] = [];

    const filesToProcess = uploadedFiles.filter(f => f.status === ProcessingStatus.PENDING || f.status === ProcessingStatus.ERROR);
    setProcessingProgress({ completed: 0, total: filesToProcess.length });

    for (const uploadedFile of uploadedFiles) {
        if (uploadedFile.status !== ProcessingStatus.PENDING && uploadedFile.status !== ProcessingStatus.ERROR) {
            // This file is already processed, reconstruct its part of the markdown/assets
            if (uploadedFile.transcription) {
                if (uploadedFile.type === 'text') {
                    tempMarkdown += (tempMarkdown ? '\n\n' : '') + uploadedFile.transcription;
                } else {
                    tempMarkdown += (tempMarkdown ? '\n\n- ' : '- ') + uploadedFile.transcription;
                }
            }
            if (uploadedFile.assets) {
              tempAssets.push(...uploadedFile.assets);
              uploadedFile.assets.forEach(asset => {
                  tempMarkdown += `\n\n- ![[assets/${asset.fileName}]]\n  - ${asset.description}`;
              });
            }
            continue;
        }

        setUploadedFiles(prev => prev.map(f =>
            f.id === uploadedFile.id ? { ...f, status: ProcessingStatus.PROCESSING, error: undefined, partialTranscription: '', retryingMessage: undefined, processingStartTime: Date.now() } : f
        ));

        try {
            if (uploadedFile.type === 'audio') {
                const fullTranscription = await transcribeAudioStream(uploadedFile.file,
                    (chunk) => setUploadedFiles(prev => prev.map(f => f.id === uploadedFile.id ? { ...f, partialTranscription: (f.partialTranscription || '') + chunk } : f)),
                    (attempt) => setUploadedFiles(prev => prev.map(f => f.id === uploadedFile.id ? { ...f, retryingMessage: `Transcription failed (Attempt ${attempt}). Retrying...` } : f))
                );
                setUploadedFiles(prev => prev.map(f => f.id === uploadedFile.id ? { ...f, status: ProcessingStatus.DONE, transcription: fullTranscription, partialTranscription: '', processingEndTime: Date.now() } : f));
                if (fullTranscription) tempMarkdown += (tempMarkdown ? '\n\n- ' : '- ') + fullTranscription;
            } else if (uploadedFile.type === 'image') {
                const { transcription, assets } = await processImage(uploadedFile.file, uploadedFile.imageType || 'text',
                    (chunk) => setUploadedFiles(prev => prev.map(f => f.id === uploadedFile.id ? { ...f, partialTranscription: (f.partialTranscription || '') + chunk } : f))
                );
                setUploadedFiles(prev => prev.map(f => f.id === uploadedFile.id ? { ...f, status: ProcessingStatus.DONE, transcription, assets, partialTranscription: '', processingEndTime: Date.now() } : f));
                if (transcription) tempMarkdown += (tempMarkdown ? '\n\n- ' : '- ') + transcription;
                if (assets) {
                  tempAssets.push(...assets);
                  assets.forEach(asset => {
                      tempMarkdown += `\n\n- ![[assets/${asset.fileName}]]\n  - ${asset.description}`;
                  });
                }
            } else if (uploadedFile.type === 'text') {
                const fileContent = await uploadedFile.file.text();
                const normalizedContent = fileContent.replace(/\r\n/g, '\n');
                const blocks = normalizedContent.split(/\n\s*\n/).filter(block => block.trim().length > 0);

                const processedContent = blocks.map(block => {
                    const isPreformatted = /^\s/.test(block);

                    if (isPreformatted) {
                        const lines = block.split('\n');
                        const firstLine = lines[0];
                        const restOfLines = lines.slice(1);
                        
                        let result = `- ${firstLine}`;
                        if (restOfLines.length > 0) {
                           result += '\n' + restOfLines.map(line => `  ${line}`).join('\n');
                        }
                        return result;
                    } else {
                        const singleLineBlock = block.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
                        return `- ${singleLineBlock}`;
                    }
                }).join('\n\n');
                
                await new Promise(res => setTimeout(res, 50)); // tiny delay for UX
                setUploadedFiles(prev => prev.map(f => 
                    f.id === uploadedFile.id 
                    ? { ...f, status: ProcessingStatus.DONE, transcription: processedContent, partialTranscription: '', processingEndTime: Date.now() } 
                    : f
                ));
                
                if (processedContent.trim().length > 0) {
                    tempMarkdown += (tempMarkdown ? '\n\n' : '') + processedContent;
                }
            }
        } catch (error) {
            console.error("Processing failed for file:", uploadedFile.file.name, error);
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
            setUploadedFiles(prev => prev.map(f => f.id === uploadedFile.id ? { ...f, status: ProcessingStatus.ERROR, error: errorMessage, processingEndTime: Date.now() } : f));
        } finally {
            setProcessingProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
        }
    }
    
    setMarkdown(tempMarkdown);
    setAllAssets(tempAssets);
    setIsProcessing(false);
  }, [uploadedFiles]);

  useEffect(() => {
    if (prevIsPreparingRef.current && !isPreparing && autoStartProcessing) {
      if (uploadedFiles.some(f => f.status === ProcessingStatus.PENDING || f.status === ProcessingStatus.ERROR)) {
        handleProcess();
        setAutoStartProcessing(false);
      }
    }
    prevIsPreparingRef.current = isPreparing;
  }, [isPreparing, autoStartProcessing, uploadedFiles, handleProcess]);

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${finalFilename}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleUpdateFile = (id: string, updates: Partial<UploadedFile>) => {
    setUploadedFiles(files => files.map(f => f.id === id ? { ...f, ...updates } : f));
  };
  const handleRemoveMultipleFiles = (ids: string[]) => {
    const idsToRemove = new Set(ids);
    setUploadedFiles(prev => prev.filter(file => !idsToRemove.has(file.id)));
  };
  const pendingFilesCount = uploadedFiles.filter(f => f.status === ProcessingStatus.PENDING || f.status === ProcessingStatus.ERROR).length;
  const isUploaderDisabled = isProcessing || isPreparing || totalSize >= MAX_SESSION_SIZE;

  return (
    <div className="min-h-screen flex flex-col items-center p-4 sm:p-8">
      <header className="w-full max-w-2xl mx-auto text-center mb-8">
        <h1 className="text-3xl font-bold text-slate-100 mb-2">Multimedia to Logseq Processor</h1>
        <p className="text-slate-400">Upload audio, video, or image files to collate into a Logseq-friendly markdown page.</p>
      </header>

      <main className="w-full flex-1">
        {!markdown && (
            <>
              {uploadError && (
                <div className="w-full max-w-2xl mx-auto mb-4 bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg relative transition-all animate-fade-in" role="alert">
                  <span className="block sm:inline ml-2">{uploadError}</span>
                  <span className="absolute top-0 bottom-0 right-0 px-4 py-3" onClick={() => setUploadError(null)}>
                    <svg className="fill-current h-6 w-6 text-red-400 hover:text-red-200 cursor-pointer" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
                  </span>
                </div>
              )}

              <FileUpload onFilesSelected={handleFilesSelected} disabled={isUploaderDisabled} />
              <div className="w-full max-w-2xl mx-auto mt-4">
                  <p className="text-xs text-slate-400 text-right mt-1">
                      Session Quota: {formatSize(totalSize)} / {formatSize(MAX_SESSION_SIZE)}
                  </p>
              </div>
              <div className="w-full max-w-2xl mx-auto mt-3 flex items-center justify-end">
                <input id="autostart-checkbox" type="checkbox" checked={autoStartProcessing} onChange={(e) => setAutoStartProcessing(e.target.checked)} disabled={isProcessing || isPreparing}
                  className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-indigo-500 focus:ring-indigo-600 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed" />
                <label htmlFor="autostart-checkbox" className={`ml-2 text-sm select-none ${isProcessing || isPreparing ? 'text-slate-500 cursor-not-allowed' : 'text-slate-300 cursor-pointer'}`}>
                  Autostart processing after next upload
                </label>
              </div>

              {isPreparing && <ProcessingLog logs={logs} />}

              {uploadedFiles.length > 0 && (
                <div className="w-full max-w-2xl mx-auto mt-8 mb-6 text-center">
                  <button onClick={handleProcess} disabled={pendingFilesCount === 0 || isProcessing || isPreparing}
                    className="inline-flex items-center justify-center px-8 py-3 text-base font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors">
                    {isProcessing ? (
                      <>
                        <SpinnerIcon className="w-5 h-5 mr-3" />
                        Processing...
                        {processingProgress.total > 0 && <span className="ml-2">({processingProgress.completed}/{processingProgress.total})</span>}
                      </>
                    ) : `Process ${pendingFilesCount} File${pendingFilesCount !== 1 ? 's' : ''}`}
                  </button>
                </div>
              )}

              <FileList files={uploadedFiles} onReorder={setUploadedFiles} isProcessing={isProcessing}
                onRemoveMultiple={handleRemoveMultipleFiles} onUpdateFile={handleUpdateFile} />
            </>
          )}

        {markdown && (
          <ResultPreview markdown={markdown} assets={allAssets} onDownload={handleDownload} onClear={handleClear} onReprocess={handleReprocess}
            filename={finalFilename} onFilenameChange={setFinalFilename} />
        )}
      </main>
      <footer className="w-full max-w-2xl mx-auto text-center mt-8">
        <p className="text-xs text-slate-500">
            Note: Files are processed in-browser and streamed directly to the API. Your files are not stored on any server.
        </p>
      </footer>
      <ApiUsageCounter />
    </div>
  );
};

export default App;