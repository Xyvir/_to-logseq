import * as pdfjsLib from 'pdfjs-dist';
import { UploadedFile, ProcessingStatus } from '../types';

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

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    log(` -> Processing page ${pageNum}/${pdf.numPages}...`, true);
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const ops = await page.getOperatorList();
    
    // Attempt to extract all embedded images from the page
    const embeddedImages: File[] = [];
    const imagePromises: Promise<void>[] = [];
    
    ops.fnArray.forEach((fn, j) => {
        if (fn === pdfjsLib.OPS.paintImageXObject) {
            const imgId = ops.argsArray[j][0];
            const promise = (async () => {
                try {
                    const imgData = await page.objs.get(imgId);
                    if (!imgData?.data) return;

                    const canvas = document.createElement('canvas');
                    canvas.width = imgData.width;
                    canvas.height = imgData.height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return;

                    // This fallback approach handles both raw pixel data and compressed formats
                    // by attempting to load them into an Image element. It's robust.
                    const tempBlob = new Blob([imgData.data], { type: 'image/jpeg' }); // Assume jpeg, browser is good at figuring it out
                    const url = URL.createObjectURL(tempBlob);

                    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                        const image = new Image();
                        image.onload = () => resolve(image);
                        image.onerror = reject;
                        image.src = url;
                    });
                    
                    URL.revokeObjectURL(url);
                    ctx.drawImage(img, 0, 0);
                    const dataUrl = canvas.toDataURL('image/png');
                    const finalBlob = dataURItoBlob(dataUrl);

                    const imageFile = new File([finalBlob], `${originalName}-page${pageNum}-img${embeddedImages.length + 1}.png`, { type: 'image/png' });
                    embeddedImages.push(imageFile);
                } catch (e) {
                    console.error(`Could not extract image ${imgId} from page ${pageNum}`, e);
                }
            })();
            imagePromises.push(promise);
        }
    });
    await Promise.all(imagePromises);

    // DECISION: Is this a text page or an image-only page?
    if (textContent.items.length > 0) {
      // PAGE WITH TEXT: Create one text file and multiple image files for figures.
      const pageText = textContent.items.map(item => (item as any).str).join(' ');
      
      if (pageText.trim()) {
        const textFile = new File([pageText], `${originalName}-page${pageNum}.txt`, { type: 'text/plain' });
        outputFiles.push({
          id: `${pdfFile.name}-page${pageNum}-text-${Date.now()}`,
          file: textFile,
          type: 'text',
          status: ProcessingStatus.PENDING,
          originalFileSize: textFile.size,
        });
      }

      // Add extracted images, marked as 'no-text' since they are figures in a document.
      embeddedImages.forEach(imgFile => {
        outputFiles.push({
          id: `${pdfFile.name}-page${pageNum}-img-${imgFile.name}-${Date.now()}`,
          file: imgFile,
          type: 'image',
          status: ProcessingStatus.PENDING,
          imageAnalysisStatus: 'DONE', // No need to analyze, we classify it as a figure.
          imageType: 'no-text',
          originalFileSize: imgFile.size,
        });
      });

    } else {
      // IMAGE-ONLY PAGE: Render the whole page as a single image.
      const viewport = page.getViewport({ scale: 2.0 }); // Render at 2x resolution for better quality
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      if (context) {
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        const dataUrl = canvas.toDataURL('image/png');
        const blob = dataURItoBlob(dataUrl);
        const imageFile = new File([blob], `${originalName}-page${pageNum}.png`, { type: 'image/png' });
        outputFiles.push({
          id: `${pdfFile.name}-page${pageNum}-img-${Date.now()}`,
          file: imageFile,
          type: 'image',
          status: ProcessingStatus.PENDING,
          imageAnalysisStatus: 'PENDING', // Needs analysis to extract text via OCR.
          imageType: 'text',
          originalFileSize: imageFile.size,
        });
      }
    }
  }

  log(`[${pdfFile.name}] Finished processing. ${outputFiles.length} files generated.`, true);
  return outputFiles;
};