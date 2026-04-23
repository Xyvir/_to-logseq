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

        // Process sections from spine
        let sectionCount = 0;
        
        for (const item of (spine as any).items) {
            sectionCount++;
            addLog(`[${epubFile.name}] Processing section ${sectionCount}/${(spine as any).items.length}...`, true);
            
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
                                    const imageFile = new File([blob], `${originalName}-section${sectionCount}-img${imgIndex + 1}.png`, { type: blob.type });
                                    
                                    newFilesToQueue.push({
                                        id: `${fileId}-epub-s${sectionCount}-i${imgIndex}`,
                                        file: imageFile,
                                        type: 'image',
                                        status: ProcessingStatus.PENDING,
                                        originalFileSize: imageFile.size,
                                        imageAnalysisStatus: 'DONE',
                                        imageType: 'no-text',
                                    });
                                    
                                    // Replace img in text with a placeholder
                                    const placeholder = `---IMAGE_BREAK_SECTION_${sectionCount}_INDEX_${imgIndex}---`;
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

                const text = body.innerText || body.textContent || '';
                if (text.trim()) {
                    const textFile = new File([text.trim()], `${originalName}-section${sectionCount}.txt`, { type: 'text/plain' });
                    newFilesToQueue.push({
                        id: `${fileId}-epub-s${sectionCount}-text`,
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
