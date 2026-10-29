import React, { useState, useCallback, useEffect, useRef } from 'react';
import { UploadedFile, ProcessingStatus, ImageAsset } from './types';
import { transcribeAudioStream, processImage, sliceImageHorizontally, refineMarkdownStream, cropImageFile, generateBookPrefix } from './services/geminiService';
import { parseMarkdownToLithic } from './services/lithicService';
import { processPdfFile } from './services/pdfService';
import { processEpubFile } from './services/epubService';
import { processDocxFile } from './services/docxService';
import { processPptxFile } from './services/pptxService';
import { chunkAudioFile } from './services/audioService';
import { processJsonFile } from './services/jsonService';
import FileUpload from './components/FileUpload';
import FileList from './components/FileList';
import ResultPreview from './components/TranscriptionPreview';
import ProcessingLog from './components/ProcessingLog';
import ManualCropModal from './components/ManualCropModal';
import ConfirmationModal from './components/ConfirmationModal';
import PrefixPromptModal from './components/PrefixPromptModal';
import { SpinnerIcon } from './components/icons';


// --- React Component ---

const calculateTotalSize = (files: UploadedFile[]): number => {
    const processedOriginals = new Set<string>();
    let total = 0;

    files.forEach(file => {
        if (file.originalFileName) {
            if (!processedOriginals.has(file.originalFileName)) {
                total += file.originalFileSize || 0;
                processedOriginals.add(file.originalFileName);
            }
        } else {
            total += file.originalFileSize || file.file.size;
        }
    });
    return total;
};

const App: React.FC = () => {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [isGeneratingPrefix, setIsGeneratingPrefix] = useState(false);
  const [markdown, setMarkdown] = useState('');
  const [lithicContent, setLithicContent] = useState('');
  const [rawMarkdown, setRawMarkdown] = useState('');
  const [refinementStreamContent, setRefinementStreamContent] = useState('');
  const [allAssets, setAllAssets] = useState<ImageAsset[]>([]);
  const [finalFilename, setFinalFilename] = useState('lithic-export');
  const [logs, setLogs] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [autoStartProcessing, setAutoStartProcessing] = useState(true);
  const [processingProgress, setProcessingProgress] = useState({ completed: 0, total: 0 });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [croppingFile, setCroppingFile] = useState<UploadedFile | null>(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [skipRefinement, setSkipRefinement] = useState(false);
  const [prefixPromptResolve, setPrefixPromptResolve] = useState<((prefix: string) => void) | null>(null);

  const requestPrefixFromUser = (): Promise<string> => {
    return new Promise((resolve) => {
      setPrefixPromptResolve(() => resolve);
    });
  };

  const processingTriggerRef = useRef<boolean>(false);
  
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
    setUploadedFiles([]); setIsProcessing(false); setMarkdown(''); setLithicContent(''); setRawMarkdown(''); setAllAssets([]);
    setFinalFilename('lithic-export'); setLogs([]);
    setUploadError(null);
    setSelectedIds(new Set());
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
    setRawMarkdown('');
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

  const handleFilesSelected = useCallback(async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
  
    setIsPreparing(true); setUploadError(null); setLogs(['Preparing uploaded files...']);
    const existingOriginalFilenames = new Set(uploadedFiles.map(f => f.originalFileName || f.file.name));
    const newFilesToQueue: UploadedFile[] = [];
    
    const currentSize = calculateTotalSize(uploadedFiles);
    let sizeOfNewFiles = 0;

    for (const file of fileArray) {
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

        const isAudioFile = uniqueFile.type.startsWith('audio/') || 
                            (uniqueFile.type === 'video/webm' && uniqueFile.name.toLowerCase().endsWith('.webm')) || 
                            (uniqueFile.type === '' && uniqueFile.name.toLowerCase().endsWith('.webm'));

        if (isAudioFile) {
            try {
                if (uniqueFile.size > MAX_FILE_SIZE) {
                  setUploadError(`Error: "${uniqueFile.name}" (${formatSize(uniqueFile.size)}) exceeds the file limit of ${formatSize(MAX_FILE_SIZE)}.`);
                  addLog(`[${uniqueFile.name}] Error: File size exceeds the 2 GB limit.`);
                  continue;
                }
                
                // Ensure the file has a valid MIME type for Gemini API
                let fileToProcess = uniqueFile;
                if ((uniqueFile.type === '' || uniqueFile.type === 'video/webm') && uniqueFile.name.toLowerCase().endsWith('.webm')) {
                    fileToProcess = new File([uniqueFile], uniqueFile.name, { type: 'audio/webm' });
                }

                const { chunkData } = await chunkAudioFile(fileToProcess, addLog);
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
            try {
                addLog(`[${uniqueFile.name}] Slicing image into content blocks...`);
                const slicedImageFiles = await sliceImageHorizontally(uniqueFile);
                addLog(` -> Sliced into ${slicedImageFiles.length} chunk(s).`);
                const isSliced = slicedImageFiles.length > 1;
        
                for (const slicedFile of slicedImageFiles) {
                    const slicedFileId = `${slicedFile.name}-${Date.now()}`;
                    const imageFile: UploadedFile = {
                        id: slicedFileId, file: slicedFile, type: 'image', status: ProcessingStatus.PENDING,
                        imageAnalysisStatus: 'DONE', imageType: 'text',
                        originalFileSize: slicedFile.size,
                        originalFileName: isSliced ? uniqueFile.name : undefined,
                    };
                    newFilesToQueue.push(imageFile);
                }
                sizeOfNewFiles += uniqueFile.size;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                addLog(`[${uniqueFile.name}] Error slicing image: ${errorMessage}`);
                setUploadError(`Error with "${uniqueFile.name}": ${errorMessage}`);
            }
        } else if (uniqueFile.type === 'text/html' || uniqueFile.name.endsWith('.html') || uniqueFile.name.endsWith('.htm')) {
            try {
                addLog(`[${uniqueFile.name}] Processing HTML file...`);
                const htmlContent = await uniqueFile.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(htmlContent, "text/html");
                const extractedText = doc.body.innerText || doc.body.textContent || "";

                if (extractedText.trim().length === 0) {
                    addLog(`[${uniqueFile.name}] Skipped: No text content found in HTML body.`);
                    continue;
                }
                const textFile = new File([extractedText], uniqueFile.name.replace(/\.(html?)$/i, '.txt'), { type: 'text/plain' });
                const uploadedHtmlFile: UploadedFile = {
                    id: fileId, file: textFile, type: 'text', status: ProcessingStatus.PENDING,
                    originalFileSize: uniqueFile.size, originalFileName: uniqueFile.name,
                };
                newFilesToQueue.push(uploadedHtmlFile);
                sizeOfNewFiles += uniqueFile.size;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                addLog(`[${uniqueFile.name}] Error processing HTML: ${errorMessage}`);
                setUploadError(`Error with "${uniqueFile.name}": ${errorMessage}`);
            }
        } else if (uniqueFile.name.endsWith('.docx')) {
            try {
                const processedFiles = await processDocxFile(uniqueFile, fileId, addLog);
                newFilesToQueue.push(...processedFiles);
                sizeOfNewFiles += uniqueFile.size;
                setSkipRefinement(true);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                addLog(`[${uniqueFile.name}] Error processing DOCX: ${errorMessage}`);
                setUploadError(`Error with "${uniqueFile.name}": ${errorMessage}`);
            }
        } else if (uniqueFile.name.endsWith('.pptx')) {
            try {
                const processedFiles = await processPptxFile(uniqueFile, fileId, addLog);
                newFilesToQueue.push(...processedFiles);
                sizeOfNewFiles += uniqueFile.size;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                addLog(`[${uniqueFile.name}] Error processing PPTX: ${errorMessage}`);
                setUploadError(`Error with "${uniqueFile.name}": ${errorMessage}`);
            }
        } else if (uniqueFile.name.endsWith('.epub')) {
            try {
                const processedFiles = await processEpubFile(uniqueFile, fileId, addLog);
                newFilesToQueue.push(...processedFiles);
                sizeOfNewFiles += uniqueFile.size;
                setSkipRefinement(true);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                addLog(`[${uniqueFile.name}] Error processing EPUB: ${errorMessage}`);
                setUploadError(`Error with "${uniqueFile.name}": ${errorMessage}`);
            }
        } else if (uniqueFile.name.endsWith('.json') || uniqueFile.type === 'application/json') {
            try {
                const jsonMarkdown = await processJsonFile(uniqueFile);
                newFilesToQueue.push({
                    id: fileId,
                    file: uniqueFile,
                    originalFileName: uniqueFile.name,
                    status: ProcessingStatus.DONE,
                    transcription: jsonMarkdown,
                    size: uniqueFile.size
                });
                sizeOfNewFiles += uniqueFile.size;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                addLog(`[${uniqueFile.name}] Error processing JSON: ${errorMessage}`);
                setUploadError(`Error with "${uniqueFile.name}": ${errorMessage}`);
            }
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
        setUploadedFiles(prev => {
            const nextFiles = [...prev, ...newFilesToQueue];
            if (autoStartProcessing) {
                processingTriggerRef.current = true;
            }
            return nextFiles;
        });
        setSelectedIds(prevSelectedIds => {
            const newSelectedIds = new Set(prevSelectedIds);
            newFilesToQueue.forEach(file => {
                if (file.preselectedForDeletion) {
                    newSelectedIds.add(file.id);
                }
            });
            return newSelectedIds;
        });
    }
    setLogs([]);
    setIsPreparing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog, uploadedFiles, autoStartProcessing]);
  
  const isUploaderDisabled = isProcessing || isPreparing || isRefining || totalSize >= MAX_SESSION_SIZE;

  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
        if (isUploaderDisabled) return;

        const items = event.clipboardData?.items;
        if (!items) return;

        const filePromises: Promise<File | null>[] = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
                const blob = item.getAsFile();
                if (blob) {
                    const timestamp = new Date().getTime();
                    const extension = blob.type.split('/')[1]?.split('+')[0] || 'png';
                    const file = new File([blob], `pasted-image-${timestamp}.${extension}`, { type: blob.type });
                    filePromises.push(Promise.resolve(file));
                }
            } else if (item.kind === 'string' && item.type.startsWith('text/plain')) {
                filePromises.push(new Promise((resolve) => {
                    item.getAsString((text) => {
                        if (text && text.trim()) {
                            const timestamp = new Date().getTime();
                            const file = new File([text], `pasted-text-${timestamp}.txt`, { type: 'text/plain' });
                            resolve(file);
                        } else {
                            resolve(null);
                        }
                    });
                }));
            }
        }

        if (filePromises.length === 0) return;

        const pastedFiles = (await Promise.all(filePromises)).filter((f): f is File => f !== null);

        if (pastedFiles.length > 0) {
            handleFilesSelected(pastedFiles);
        }
    };

    window.addEventListener('paste', handlePaste);

    return () => {
        window.removeEventListener('paste', handlePaste);
    };
  }, [isUploaderDisabled, handleFilesSelected]);

  const startProcessingLogic = useCallback(async (allFilesForProcessing: UploadedFile[]) => {
    setIsProcessing(true);
    setSelectedIds(new Set());
    let tempMarkdown = '';
    const tempAssets: ImageAsset[] = [];

    const filesToProcess = allFilesForProcessing.filter(f => f.status === ProcessingStatus.PENDING || f.status === ProcessingStatus.ERROR);
    setProcessingProgress({ completed: 0, total: filesToProcess.length });

    for (const uploadedFile of allFilesForProcessing) {
        if (uploadedFile.status !== ProcessingStatus.PENDING && uploadedFile.status !== ProcessingStatus.ERROR) {
            if (uploadedFile.transcription) {
                tempMarkdown += (tempMarkdown ? '\n\n' : '') + uploadedFile.transcription;
            }
            if (uploadedFile.assets) {
              tempAssets.push(...uploadedFile.assets);
              uploadedFile.assets.forEach(asset => {
                  tempMarkdown += `\n\n![${asset.description}](assets/${asset.fileName})`;
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
                    (attempt) => setUploadedFiles(prev => prev.map(f => f.id === uploadedFile.id ? { ...f, retryingMessage: `Transcription failed (Attempt ${attempt}). Retrying...` } : f)),
                    (msg) => setUploadedFiles(prev => prev.map(f => f.id === uploadedFile.id ? { ...f, currentLogMessage: msg } : f))
                );
                setUploadedFiles(prev => prev.map(f => f.id === uploadedFile.id ? { ...f, status: ProcessingStatus.DONE, transcription: fullTranscription, partialTranscription: '', processingEndTime: Date.now() } : f));
                if (fullTranscription) tempMarkdown += (tempMarkdown ? '\n\n' : '') + fullTranscription;
            } else if (uploadedFile.type === 'image') {
                const { transcription, assets } = await processImage(uploadedFile.file, uploadedFile.imageType || 'text',
                    (chunk) => setUploadedFiles(prev => prev.map(f => f.id === uploadedFile.id ? { ...f, partialTranscription: (f.partialTranscription || '') + chunk } : f))
                );
                setUploadedFiles(prev => prev.map(f => f.id === uploadedFile.id ? { ...f, status: ProcessingStatus.DONE, transcription, assets, partialTranscription: '', processingEndTime: Date.now() } : f));
                if (transcription) tempMarkdown += (tempMarkdown ? '\n\n' : '') + transcription;
                if (assets) {
                  tempAssets.push(...assets);
                  assets.forEach(asset => {
                    tempMarkdown += `\n\n![${asset.description}](assets/${asset.fileName})`;
                  });
                }
            } else if (uploadedFile.type === 'text') {
                const fileContent = await uploadedFile.file.text();
                const normalizedContent = fileContent.replace(/\r\n/g, '\n');
                const blocks = normalizedContent.split(/\n\s*\n/).filter(block => block.trim().length > 0);

                const processedContent = blocks.map(block => {
                    const isPreformatted = /^\s/.test(block);
                    const isHeader = /^#{1,6}\s/.test(block.trim());

                    if (isHeader) {
                        return block.trim();
                    } else if (isPreformatted) {
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
            // Add a slight delay to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    setIsProcessing(false);

    if (tempMarkdown.trim().length > 0) {
        setRawMarkdown(tempMarkdown);
        let prefix = 'DOC';
        
        const uniqueOriginalFiles = Array.from(new Set(allFilesForProcessing.map(f => f.originalFileName || f.file.name)));
        let useOriginalFilename = false;
        let originalBaseName = '';
        
        if (uniqueOriginalFiles.length === 1) {
            const baseName = uniqueOriginalFiles[0].replace(/\.[^/.]+$/, "");
            if (baseName.length <= 30) {
                useOriginalFilename = true;
                originalBaseName = baseName
                    .replace(/[\\/:*?"<>|]/g, '')
                    .replace(/\s+/g, '-')
                    .replace(/-+/g, '-')
                    .trim();
            }
        }

        try {
            setIsGeneratingPrefix(true);
            setLogs(['Starting shortcode generation...']);
            let fileNamesStr = uniqueOriginalFiles.slice(0, 10).join(', ');
            if (uniqueOriginalFiles.length > 10) fileNamesStr += '...';
            prefix = await generateBookPrefix(tempMarkdown, fileNamesStr, (msg) => setLogs(prev => [...prev, msg]));
            if (!prefix || prefix === 'DOC') {
                setIsGeneratingPrefix(false);
                prefix = await requestPrefixFromUser();
            }
        } catch (err) {
            console.error("Could not generate prefix", err);
            setIsGeneratingPrefix(false);
            prefix = await requestPrefixFromUser();
        } finally {
            setIsGeneratingPrefix(false);
        }

        const finalBaseName = (useOriginalFilename && originalBaseName) 
            ? originalBaseName 
            : (prefix !== 'DOC' && prefix ? prefix : '');

        if (skipRefinement) {
            const firstLine = tempMarkdown.split('\n')[0] || 'lithic-export';
            const sanitizedFilename = firstLine
                .replace(/^-?\s*#+\s*/, '')
                .trim()
                .replace(/[\\/:*?"<>|]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .substring(0, 100);
            
            setFinalFilename(finalBaseName || sanitizedFilename || 'lithic-export');
            setLithicContent(parseMarkdownToLithic(tempMarkdown, sanitizedFilename || 'Imported Content', tempAssets, prefix));
            setMarkdown(tempMarkdown);
        } else {
            setIsRefining(true);
            setLogs(['Starting document refinement...']);
            setRefinementStreamContent('');
            try {
                const refinedMarkdown = await refineMarkdownStream(
                  tempMarkdown,
                  (chunk) => setRefinementStreamContent(prev => prev + chunk),
                  (msg) => setLogs(prev => [...prev, msg])
                );
                
                if (refinedMarkdown) {
                    const firstLine = refinedMarkdown.split('\n')[0] || 'lithic-export';
                    const sanitizedFilename = firstLine
                        .replace(/^-?\s*#+\s*/, '')
                        .trim()
                        .replace(/[\\/:*?"<>|]/g, '')
                        .replace(/\s+/g, '-')
                        .replace(/-+/g, '-')
                        .substring(0, 100);
                    
                    setFinalFilename(finalBaseName || sanitizedFilename || 'lithic-export');
                    setLithicContent(parseMarkdownToLithic(refinedMarkdown, sanitizedFilename || 'Imported Content', tempAssets, prefix));
                }

                setMarkdown(refinedMarkdown);
            } catch (error) {
                console.error("Refining failed:", error);
                setMarkdown(tempMarkdown);
            } finally {
                setIsRefining(false);
            }
        }
    } else {
        setRawMarkdown(tempMarkdown);
        setMarkdown(tempMarkdown);
    }
    
    setAllAssets(tempAssets);
  }, [skipRefinement]);

  useEffect(() => {
    if (processingTriggerRef.current) {
        processingTriggerRef.current = false;
        startProcessingLogic(uploadedFiles);
    }
  }, [uploadedFiles, startProcessingLogic]);

  const handleProcessClick = () => {
    const filesMarkedForDeletion = uploadedFiles.filter(f => selectedIds.has(f.id));
    if (filesMarkedForDeletion.length > 0 && pendingFilesCount > 0) {
        setShowDeleteConfirmation(true);
    } else if (pendingFilesCount > 0) {
        startProcessingLogic(uploadedFiles);
    }
  };

  const handleProcessWithDeletions = () => {
      setShowDeleteConfirmation(false);
      startProcessingLogic(uploadedFiles);
  };

  const handleProcessAfterDeletion = () => {
      setShowDeleteConfirmation(false);
      const filesToKeep = uploadedFiles.filter(f => !selectedIds.has(f.id));
      setUploadedFiles(filesToKeep);
      // Processing will be triggered by the useEffect that watches uploadedFiles
      processingTriggerRef.current = true;
  };

  const handleDownload = () => {
    const content = lithicContent || markdown;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${finalFilename}.lith`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  const handleDownloadMarkdown = () => {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${finalFilename}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadDebugPlaintext = () => {
    if (!rawMarkdown) return;
    const blob = new Blob([rawMarkdown], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${finalFilename}-debug.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleUpdateFile = (id: string, updates: Partial<UploadedFile>) => {
    setUploadedFiles(files => files.map(f => f.id === id ? { ...f, ...updates } : f));
  };
  const handleRemoveMultipleFiles = (ids: string[]) => {
    const idsToRemove = new Set(ids);
    setUploadedFiles(prev => prev.filter(file => !idsToRemove.has(file.id)));
  };

  const handleOpenCropModal = (fileId: string) => {
    const fileToCrop = uploadedFiles.find(f => f.id === fileId);
    if (fileToCrop) {
      setCroppingFile(fileToCrop);
    }
  };

  const handleCloseCropModal = () => {
    setCroppingFile(null);
  };

  const handleCropConfirm = async (originalFileId: string, cropBox: { x: number; y: number; width: number; height: number }) => {
    const originalFileIndex = uploadedFiles.findIndex(f => f.id === originalFileId);
    if (originalFileIndex === -1) return;

    const originalUploadedFile = uploadedFiles[originalFileIndex];

    try {
        const croppedFileWithOldName = await cropImageFile(originalUploadedFile.file, cropBox);

        const originalName = originalUploadedFile.file.name.substring(0, originalUploadedFile.file.name.lastIndexOf('.')) || originalUploadedFile.file.name;
        const fileExt = originalUploadedFile.file.name.split('.').pop() || 'png';
        
        const cropCount = uploadedFiles.filter(f => f.originalFileName === originalUploadedFile.file.name).length;
        const newFileName = `${originalName}-crop${cropCount + 1}.${fileExt}`;

        const newFile = new File([croppedFileWithOldName], newFileName, { type: croppedFileWithOldName.type, lastModified: Date.now() });

        const newUploadedFile: UploadedFile = {
            id: `${originalUploadedFile.id}-crop-${Date.now()}`,
            file: newFile,
            type: 'image',
            status: ProcessingStatus.PENDING,
            originalFileSize: newFile.size,
            imageAnalysisStatus: 'DONE',
            imageType: 'no-text',
            originalFileName: originalUploadedFile.file.name,
        };

        setUploadedFiles(prevFiles => {
            const newFiles = [...prevFiles];
            const updatedOriginal = { ...newFiles[originalFileIndex], preselectedForDeletion: true };
            newFiles[originalFileIndex] = updatedOriginal;
            
            newFiles.splice(originalFileIndex + 1, 0, newUploadedFile);
            return newFiles;
        });

        setSelectedIds(prevSelectedIds => {
            const newSelectedIds = new Set(prevSelectedIds);
            newSelectedIds.add(originalFileId);
            return newSelectedIds;
        });

    } catch (error) {
        console.error("Failed to crop image:", error);
    } finally {
        handleCloseCropModal();
    }
  };

  const pendingFilesCount = uploadedFiles.filter(f => f.status === ProcessingStatus.PENDING || f.status === ProcessingStatus.ERROR).length;

  return (
    <div className="min-h-screen flex flex-col items-center p-4 sm:p-8">
      <header className="w-full max-w-2xl mx-auto text-center mb-8">
        <h1 className="text-3xl font-bold text-slate-100 mb-2">_to-lithic: Multimedia Processor</h1>
        <p className="text-slate-400">Upload document, image, or audio files to collate into a Monolith-friendly layout.</p>
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
              <div className="w-full max-w-2xl mx-auto mt-3 flex flex-col sm:flex-row items-end sm:items-center justify-end gap-3">
                <div className="flex items-center">
                  <input id="skip-refinement-checkbox" type="checkbox" checked={skipRefinement} onChange={(e) => setSkipRefinement(e.target.checked)} disabled={isProcessing || isPreparing}
                    className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-indigo-500 focus:ring-indigo-600 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed" />
                  <label htmlFor="skip-refinement-checkbox" className={`ml-2 text-sm select-none ${isProcessing || isPreparing ? 'text-slate-500 cursor-not-allowed' : 'text-slate-300 cursor-pointer'}`} title="Recommended for native EPUB/DOCX. Saves generation time by skipping AI transcription refinement.">
                    Skip AI Refinement
                  </label>
                </div>
                <div className="flex items-center">
                  <input id="autostart-checkbox" type="checkbox" checked={autoStartProcessing} onChange={(e) => setAutoStartProcessing(e.target.checked)} disabled={isProcessing || isPreparing}
                    className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-indigo-500 focus:ring-indigo-600 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed" />
                  <label htmlFor="autostart-checkbox" className={`ml-2 text-sm select-none ${isProcessing || isPreparing ? 'text-slate-500 cursor-not-allowed' : 'text-slate-300 cursor-pointer'}`}>
                    Autostart next upload
                  </label>
                </div>
              </div>

              {(isPreparing || isGeneratingPrefix || isRefining) && (logs.length > 0 || refinementStreamContent) ? <ProcessingLog logs={logs} streamContent={isRefining ? refinementStreamContent : undefined} /> : null}

              {uploadedFiles.length > 0 && (
                <div className="w-full max-w-2xl mx-auto mt-8 mb-6 text-center">
                  <button onClick={handleProcessClick} disabled={pendingFilesCount === 0 || isProcessing || isPreparing || isRefining || isGeneratingPrefix}
                    className="inline-flex items-center justify-center px-8 py-3 text-base font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors">
                    {isProcessing ? (
                      <>
                        <SpinnerIcon className="w-5 h-5 mr-3" />
                        Processing...
                        {processingProgress.total > 0 && <span className="ml-2">({processingProgress.completed}/{processingProgress.total})</span>}
                      </>
                    ) : isGeneratingPrefix ? (
                      <>
                        <SpinnerIcon className="w-5 h-5 mr-3" />
                        Generating Shortcode...
                      </>
                    ) : isRefining ? (
                      <>
                        <SpinnerIcon className="w-5 h-5 mr-3" />
                        Refining Document...
                      </>
                    ) : `Process ${pendingFilesCount} File${pendingFilesCount !== 1 ? 's' : ''}`}
                  </button>
                </div>
              )}

              <FileList files={uploadedFiles} onReorder={setUploadedFiles} isProcessing={isProcessing || isRefining}
                onRemoveMultiple={handleRemoveMultipleFiles} onUpdateFile={handleUpdateFile}
                selectedIds={selectedIds} onSelectionChange={setSelectedIds} onOpenCropModal={handleOpenCropModal} />
            </>
          )}

        {markdown && !isRefining && (
          <ResultPreview markdown={markdown} lithicContent={lithicContent} assets={allAssets} onDownload={handleDownload} onClear={handleClear} onReprocess={handleReprocess}
            filename={finalFilename} onFilenameChange={setFinalFilename} rawMarkdown={rawMarkdown} onDownloadMarkdown={handleDownloadMarkdown} onDownloadDebug={handleDownloadDebugPlaintext} />
        )}
      </main>

      {croppingFile && (
          <ManualCropModal
            fileToCrop={croppingFile}
            onClose={handleCloseCropModal}
            onConfirm={handleCropConfirm}
          />
        )}
      
      {showDeleteConfirmation && (
          <ConfirmationModal
            count={selectedIds.size}
            onClose={() => setShowDeleteConfirmation(false)}
            onIgnore={handleProcessWithDeletions}
            onConfirm={handleProcessAfterDeletion}
          />
      )}

      {prefixPromptResolve && (
          <PrefixPromptModal
            onConfirm={(prefix) => {
              prefixPromptResolve(prefix);
              setPrefixPromptResolve(null);
            }}
            onCancel={() => {
              prefixPromptResolve('DOC');
              setPrefixPromptResolve(null);
            }}
          />
      )}

      <footer className="w-full max-w-2xl mx-auto text-center mt-8">
        <p className="text-xs text-slate-500">
            Note: Files are processed in-browser and streamed directly to the API. Your files are not stored on any server.
        </p>
      </footer>
    </div>
  );
};

export default App;