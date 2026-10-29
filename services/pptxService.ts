import JSZip from 'jszip';
import { UploadedFile, ProcessingStatus } from '../types';

export const processPptxFile = async (
    pptxFile: File,
    fileId: string,
    addLog: (message: string, replaceLast?: boolean) => void
): Promise<UploadedFile[]> => {
    const newFilesToQueue: UploadedFile[] = [];
    addLog(`[${pptxFile.name}] Deconstructing PPTX file...`);

    const arrayBuffer = await pptxFile.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    const originalName = pptxFile.name.substring(0, pptxFile.name.lastIndexOf('.')) || pptxFile.name;

    const slidesFolder = zip.folder("ppt/slides");
    if (!slidesFolder) {
        addLog(`[${pptxFile.name}] -> No slides found.`);
        return [];
    }

    const slideFiles: string[] = [];
    slidesFolder.forEach((relativePath, file) => {
        if (relativePath.startsWith("slide") && relativePath.endsWith(".xml") && !relativePath.includes('/')) {
            slideFiles.push(relativePath);
        }
    });

    // Sort slides by number
    slideFiles.sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || "0", 10);
        const numB = parseInt(b.match(/\d+/)?.[0] || "0", 10);
        return numA - numB;
    });

    const parser = new DOMParser();

    for (let i = 0; i < slideFiles.length; i++) {
        const slideFileName = slideFiles[i];
        const slideNum = slideFileName.match(/\d+/)?.[0] || (i + 1).toString();
        
        // 1. Extract Text from Slide
        const xmlContent = await slidesFolder.file(slideFileName)?.async("text");
        if (xmlContent) {
            const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
            const textNodes = xmlDoc.getElementsByTagName("a:t");
            let slideText = "";
            for (let j = 0; j < textNodes.length; j++) {
                slideText += (textNodes[j].textContent || "") + " ";
            }

            if (slideText.trim()) {
                const textFile = new File([slideText.trim()], `${originalName}-slide${slideNum}.txt`, { type: 'text/plain' });
                newFilesToQueue.push({
                    id: `${fileId}-pptx-slide-${slideNum}-text`,
                    file: textFile,
                    type: 'text',
                    status: ProcessingStatus.PENDING,
                    originalFileSize: textFile.size,
                });
            }
        }

        // 2. Extract Images referenced by this slide
        const relsFileName = `_rels/${slideFileName}.rels`;
        const relsContent = await slidesFolder.file(relsFileName)?.async("text");
        if (relsContent) {
            const relsDoc = parser.parseFromString(relsContent, "text/xml");
            const relationships = relsDoc.getElementsByTagName("Relationship");
            
            for (let j = 0; j < relationships.length; j++) {
                const rel = relationships[j];
                const type = rel.getAttribute("Type");
                const target = rel.getAttribute("Target");
                
                if (type?.endsWith("/image") && target) {
                    // target is usually "../media/imageN.png"
                    const mediaPath = target.startsWith("../") ? target.substring(3) : target;
                    // mediaPath is now probably "media/imageN.png"
                    // In PPTX zip, media is in "ppt/media/..."
                    const fullMediaPath = `ppt/${mediaPath}`;
                    
                    const mediaFile = zip.file(fullMediaPath);
                    if (mediaFile) {
                        const fileData = await mediaFile.async("blob");
                        const fileName = mediaPath.split('/').pop() || `image${j}`;
                        const extension = fileName.split('.').pop() || 'png';
                        
                        const imageFile = new File([fileData], `${originalName}-slide${slideNum}-img${j + 1}.${extension}`, { type: `image/${extension === 'jpg' ? 'jpeg' : extension}` });
                        
                        newFilesToQueue.push({
                            id: `${fileId}-pptx-slide-${slideNum}-img-${j}`,
                            file: imageFile,
                            type: 'image',
                            status: ProcessingStatus.PENDING,
                            originalFileSize: imageFile.size,
                            imageAnalysisStatus: 'DONE',
                            imageType: 'no-text',
                        });
                    }
                }
            }
        }
    }

    addLog(`[${pptxFile.name}] -> Deconstructed into ${newFilesToQueue.length} text and media chunk(s).`);
    return newFilesToQueue;
};
