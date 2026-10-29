import mammoth from 'mammoth';
import { UploadedFile, ProcessingStatus } from '../types';

const base64ToFile = (base64: string, filename: string, mimeType: string): File => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) { 
        byteNumbers[i] = byteCharacters.charCodeAt(i); 
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    return new File([blob], filename, { type: mimeType });
};

export const processDocxFile = async (
    docxFile: File,
    fileId: string,
    addLog: (message: string, replaceLast?: boolean) => void
): Promise<UploadedFile[]> => {
    const newFilesToQueue: UploadedFile[] = [];
    addLog(`[${docxFile.name}] Deconstructing DOCX file...`);
    
    const arrayBuffer = await docxFile.arrayBuffer();
    
    const images: { data: string, contentType: string }[] = [];
    const imageConverterOptions = {
        convertImage: mammoth.images.inline((element: any) => {
            const index = images.length;
            return element.read("base64").then((imageBuffer: string) => {
                images.push({ data: imageBuffer, contentType: element.contentType });
                return {
                    src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
                    'data-image-index': index.toString()
                };
            });
        })
    };
    
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer }, imageConverterOptions);

    const placeholder = (index: number) => `---IMAGE_BREAK_${index}---`;
    const renderContainer = document.createElement('div');
    renderContainer.innerHTML = html;
    
    renderContainer.querySelectorAll('img[data-image-index]').forEach(img => {
        const indexStr = img.getAttribute('data-image-index');
        if (indexStr) {
            const index = parseInt(indexStr, 10);
            const placeholderNode = document.createTextNode(placeholder(index));
            img.parentNode?.replaceChild(placeholderNode, img);
        }
    });

    const textWithPlaceholders = renderContainer.innerText;
    const chunkRegex = /---IMAGE_BREAK_(\d+)---/;
    const textAndImageParts = textWithPlaceholders.split(chunkRegex);

    const originalName = docxFile.name.substring(0, docxFile.name.lastIndexOf('.')) || docxFile.name;

    let textChunkCount = 0;
    for (let i = 0; i < textAndImageParts.length; i++) {
        const part = textAndImageParts[i];
        
        if (i % 2 === 1) { // Image index part
            const imageIndex = parseInt(part, 10);
            const image = images[imageIndex];
            if (image) {
                const extension = image.contentType.split('/')[1] || 'png';
                const imageFile = base64ToFile(image.data, `${originalName}-image${imageIndex + 1}.${extension}`, image.contentType);

                newFilesToQueue.push({
                    id: `${fileId}-image-${imageIndex}`,
                    file: imageFile,
                    type: 'image',
                    status: ProcessingStatus.PENDING,
                    originalFileSize: imageFile.size,
                    imageAnalysisStatus: 'DONE',
                    imageType: 'no-text',
                });
            }
        } else { // Text part
            const trimmedText = part.trim();
            if (trimmedText) {
                textChunkCount++;
                const textFile = new File([trimmedText], `${originalName}-text${textChunkCount}.txt`, { type: 'text/plain' });
                newFilesToQueue.push({
                    id: `${fileId}-text-${textChunkCount}`,
                    file: textFile,
                    type: 'text',
                    status: ProcessingStatus.PENDING,
                    originalFileSize: textFile.size,
                });
            }
        }
    }
    
    addLog(`[${docxFile.name}] -> Deconstructed into ${newFilesToQueue.length} text and image chunk(s).`);
    return newFilesToQueue;
};
