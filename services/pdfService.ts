import * as pdfjsLib from 'pdfjs-dist';
import { UploadedFile, ProcessingStatus } from '../types';
import { sliceImageHorizontally } from './geminiService';

// Set worker source once. The worker is needed for pdf.js to not freeze the main thread.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.5.136/build/pdf.worker.mjs`;

// Helper to convert a data URI string to a Blob object
const dataURItoBlob = (dataURI: string): Blob => {
  const byteString = atob(dataURI.split(',')[1]);
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}

// Main function to process a PDF file
export const processPdfFile = async (
  pdfFile: File,
  log: (message: string, replaceLast?: boolean) => void
): Promise<UploadedFile[]> => {
  log(`[${pdfFile.name}] Processing PDF...`);

  const loadingTask = pdfjsLib.getDocument(await pdfFile.arrayBuffer());
  const pdf = await loadingTask.promise;
  log(` -> PDF has ${pdf.numPages} pages.`);
  
  const outputFiles: UploadedFile[] = [];
  const originalName = pdfFile.name.substring(0, pdfFile.name.lastIndexOf('.')) || pdfFile.name;

  const renderPageAsImageFile = async (page: pdfjsLib.PDFPageProxy, pageNum: number): Promise<File | null> => {
    const viewport = page.getViewport({ scale: 2.0 }); // Render at 2x resolution for better quality
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    if (context) {
      await page.render({ canvasContext: context, viewport: viewport, canvas }).promise;
      const dataUrl = canvas.toDataURL('image/png');
      const blob = dataURItoBlob(dataUrl);
      const imageFile = new File([blob], `${originalName}-page${pageNum}.png`, { type: 'image/png' });
      return imageFile;
    }
    return null;
  };

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    log(` -> Processing page ${pageNum}/${pdf.numPages}...`, true);
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    
    const pageText = textContent.items.map(item => (item as any).str).join(' ').trim();
    const hasText = !!pageText;

    // If there's text on the page, create a text chunk for it.
    if (pageText) {
      const textFile = new File([pageText], `${originalName}-page${pageNum}.txt`, { type: 'text/plain' });
      outputFiles.push({
        id: `${pdfFile.name}-page${pageNum}-text-${Date.now()}`,
        file: textFile,
        type: 'text',
        status: ProcessingStatus.PENDING,
        originalFileSize: textFile.size,
      });
    }

    // Always render the page as an image, slice it, and add the chunks for individual analysis.
    const pageImageFile = await renderPageAsImageFile(page, pageNum);
    if (pageImageFile) {
        log(` -> Slicing page ${pageNum} image...`, true);
        try {
            const slicedImageFiles = await sliceImageHorizontally(pageImageFile);
            slicedImageFiles.forEach((slicedFile, index) => {
                const fileId = `${pdfFile.name}-page${pageNum}-slice${index + 1}-${Date.now()}`;
                outputFiles.push({
                    id: fileId,
                    file: slicedFile,
                    type: 'image',
                    status: ProcessingStatus.PENDING,
                    originalFileSize: slicedFile.size,
                    imageAnalysisStatus: 'DONE',
                    imageType: hasText ? 'no-text' : 'text', 
                    preselectedForDeletion: hasText,
                });
            });
        } catch (error) {
            log(` -> Error slicing page ${pageNum}: ${error instanceof Error ? error.message : String(error)}`, true);
            // If slicing fails, add the whole page image as a fallback.
            const fileId = `${pdfFile.name}-page${pageNum}-img-${Date.now()}`;
            outputFiles.push({
                id: fileId,
                file: pageImageFile,
                type: 'image',
                status: ProcessingStatus.PENDING,
                originalFileSize: pageImageFile.size,
                imageAnalysisStatus: 'DONE',
                imageType: hasText ? 'no-text' : 'text',
                preselectedForDeletion: hasText,
            });
        }
    }
  }

  log(`[${pdfFile.name}] Finished processing. ${outputFiles.length} files generated.`, true);
  return outputFiles;
};
