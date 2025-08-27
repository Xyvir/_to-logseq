export enum ProcessingStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  DONE = 'DONE',
  ERROR = 'ERROR',
}

export interface ImageAsset {
  fileName: string;
  data: string; // base64 encoded
  description: string;
}

export interface UploadedFile {
  id: string;
  file: File;
  status: ProcessingStatus;
  type: 'audio' | 'image' | 'text';
  transcription?: string;
  partialTranscription?: string;
  error?: string;
  originalFileName?: string;
  processingStartTime?: number;
  processingEndTime?: number;
  retryingMessage?: string;
  originalFileSize?: number;
  
  // Audio specific
  chunkIndex?: number;
  totalChunks?: number;
  duration?: number;

  // Image specific
  imageAnalysisStatus?: 'PENDING' | 'DONE' | 'ERROR';
  imageType?: 'text' | 'no-text';
  assets?: ImageAsset[];
}