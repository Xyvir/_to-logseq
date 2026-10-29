import ePub from 'epubjs';
import { UploadedFile, ProcessingStatus } from '../types';

export const processEpubFile = async (
    epubFile: File,
    fileId: string,
    addLog: (message: string, replaceLast?: boolean) => void
): Promise<UploadedFile[]> => {
    const newFilesToQueue: UploadedFile[] = [];
    addLog(`[${epubFile.name}] Loading EPUB book...`);

    const arrayBuffer = await epubFile.arrayBuffer();
    const book = ePub(arrayBuffer);

    try {
        await book.ready;
        addLog(`[${epubFile.name}] Parsing navigation...`);
        const navigation = await book.loaded.navigation;
        const spine = await book.loaded.spine;
        
        const originalName = epubFile.name.substring(0, epubFile.name.lastIndexOf('.')) || epubFile.name;

        // Process pages from spine
        let pageCount = 0;
        
        for (const item of (spine as any).items) {
            pageCount++;
            addLog(`[${epubFile.name}] Processing page ${pageCount}/${(spine as any).items.length}...`, true);
            
            const doc = await book.load(item.href);
            if (doc) {
                // Extract text from the chapter document
                const body = (doc as Document).body;
                
                // Find images
                const images = body.querySelectorAll('img');
                const imagePromises: Promise<void>[] = [];
                
                images.forEach((img, imgIndex) => {
                    const src = img.getAttribute('src');
                    if (src) {
                        imagePromises.push((async () => {
                            try {
                                const resource = await book.archive.createUrl(item.href + '/../' + src);
                                if (resource) {
                                    const response = await fetch(resource);
                                    const blob = await response.blob();
                                    const formattedPageCount = String(pageCount).padStart(3, '0');
                                    const imageFile = new File([blob], `${originalName}-page${formattedPageCount}-img${imgIndex + 1}.png`, { type: blob.type });
                                    
                                    newFilesToQueue.push({
                                        id: `${fileId}-epub-s${formattedPageCount}-i${imgIndex}`,
                                        file: imageFile,
                                        type: 'image',
                                        status: ProcessingStatus.PENDING,
                                        originalFileSize: imageFile.size,
                                        imageAnalysisStatus: 'DONE',
                                        imageType: 'no-text',
                                    });
                                    
                                    // Replace img in text with a placeholder
                                    const placeholder = `---IMAGE_BREAK_PAGE_${formattedPageCount}_INDEX_${imgIndex}---`;
                                    const placeholderNode = (doc as Document).createTextNode(placeholder);
                                    img.parentNode?.replaceChild(placeholderNode, img);
                                }
                            } catch (e) {
                                console.error('Failed to load image from epub', e);
                            }
                        })());
                    }
                });

                await Promise.all(imagePromises);

                const formattedPageCount = String(pageCount).padStart(3, '0');
                const text = body.innerText || body.textContent || '';
                const fallbackTitle = '__FALLBACK_TITLE__';
                const titleMatch = body.querySelector('h1, h2, h3, h4, h5, h6, title, div.title, p.title')?.textContent || fallbackTitle;
                const sanitizedTitle = titleMatch === fallbackTitle 
                    ? `Page_${formattedPageCount}` 
                    : titleMatch.trim().replace(/\s+/g, '_');

                if (text.trim() || images.length > 0) {
                    // Prepend with ## so the lithic generator knows it's a new chapter
                    const finalMarkdown = `## ${sanitizedTitle}\n\n${text.trim()}`;
                    const textFile = new File([finalMarkdown], `${originalName}-page${formattedPageCount}.txt`, { type: 'text/plain' });
                    newFilesToQueue.push({
                        id: `${fileId}-epub-s${formattedPageCount}-text`,
                        file: textFile,
                        type: 'text',
                        status: ProcessingStatus.PENDING,
                        originalFileSize: textFile.size,
                    });
                }
            }
        }

        addLog(`[${epubFile.name}] -> Deconstructed into ${newFilesToQueue.length} text and image chunk(s).`);
    } catch (error) {
        addLog(`[${epubFile.name}] Error processing EPUB: ${error instanceof Error ? error.message : String(error)}`);
        console.error(error);
    }

    return newFilesToQueue;
};
