import { GoogleGenAI, Type } from "@google/genai";
import { apiUsageTracker } from './apiUsageService';
import { ImageAsset } from "../types";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function withRetry<T>(operation: () => Promise<T>, maxRetries = 2, delayMs = 3000, onLog?: (msg: string) => void): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;
            const msg = `Attempt ${attempt + 1} failed: ${error?.message || error}. Retrying in ${delayMs}ms...`;
            console.warn(msg);
            if (onLog) onLog(msg);
            if (attempt < maxRetries) {
                await delay(delayMs);
            }
        }
    }
    throw lastError;
}

export const generateBookPrefix = async (contentHint: string, filename: string, onLog?: (msg: string) => void): Promise<string> => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return 'DOC';
    const genAI = new GoogleGenAI({ apiKey });
    
    const promptConfig = `Extract the likely title of the book/document from the filename and content snippet below, then generate a 2 to 5 letter acronym or short abbreviation for it (e.g., "Timequake" -> "TQ" or "TIMQ", "The Great Gatsby" -> "TGG"). 
            Do NOT use generic words like "DOC", "BOOK", or "FILE".
            
            Filename: ${filename}
            Initial content snippet:
            ${contentHint.substring(0, 1000)}
            
            ONLY OUTPUT THE 2-5 CHARACTER ACRONYM/PREFIX, NOTHING ELSE.`;
            
    try {
        if (onLog) onLog("Requesting short code from AI...");
        const responseStream = await withRetry(() => genAI.models.generateContentStream({
            model: "gemini-3.5-flash",
            contents: promptConfig,
            config: {
                temperature: 0.1,
            }
        }), 2, 3000, onLog);
        
        let fullText = "";
        for await (const chunk of responseStream) {
            if (chunk.text) fullText += chunk.text;
        }

        const prefix = fullText.trim().replace(/[^a-zA-Z0-9]/g, '').substring(0, 5).toUpperCase();
        if (onLog) onLog(`Generated short code: ${prefix || 'DOC'}`);
        return prefix || 'DOC';
    } catch (err) {
        // Suppressing the scary console error that annoys users
        const errMsg = "Failed to generate prefix. Falling back to DOC.";
        console.warn(errMsg, err);
        if (onLog) onLog(errMsg);
        return 'DOC'; // Fallback
    }
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

const cropImage = (
  base64Image: string,
  mimeType: string,
  box: [number, number, number, number] // [y_min, x_min, y_max, x_max] normalized
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const [yMin, xMin, yMax, xMax] = box;
      
      if (yMin < 0 || xMin < 0 || yMax > 1 || xMax > 1 || yMin >= yMax || xMin >= xMax) {
          return reject(new Error(`Invalid bounding box coordinates: [${box.join(', ')}]`));
      }

      const sx = xMin * img.width;
      const sy = yMin * img.height;
      const sWidth = (xMax - xMin) * img.width;
      const sHeight = (yMax - yMin) * img.height;
      
      if (sWidth <= 0 || sHeight <= 0) {
        return reject(new Error(`Invalid crop dimensions: width=${sWidth.toFixed(2)}, height=${sHeight.toFixed(2)}`));
      }

      const canvas = document.createElement('canvas');
      canvas.width = sWidth;
      canvas.height = sHeight;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        return reject(new Error('Could not get 2D context from canvas'));
      }

      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
      
      const dataUrl = canvas.toDataURL(mimeType);
      const croppedBase64 = dataUrl.split(',')[1];
      resolve(croppedBase64);
    };
    img.onerror = (error) => reject(error instanceof Error ? error : new Error(`Image loading failed: ${error}`));
    img.src = `data:${mimeType};base64,${base64Image}`;
  });
};

export const cropImageFile = (
  file: File,
  cropBox: { x: number; y: number; width: number; height: number }
): Promise<File> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      
      if (cropBox.width <= 0 || cropBox.height <= 0) {
        return reject(new Error('Crop dimensions must be positive'));
      }

      const canvas = document.createElement('canvas');
      canvas.width = cropBox.width;
      canvas.height = cropBox.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Could not get canvas context'));

      ctx.drawImage(
        img, 
        cropBox.x, 
        cropBox.y, 
        cropBox.width, 
        cropBox.height, 
        0, 0, 
        cropBox.width, 
        cropBox.height
      );
      
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('Failed to create blob from canvas'));
        // Preserve original filename, but it will have new data and size
        const croppedFile = new File([blob], file.name, { type: file.type, lastModified: Date.now() });
        resolve(croppedFile);
      }, file.type);
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(err instanceof ErrorEvent ? err.error : new Error(`Image loading failed: ${err}`));
    };

    img.src = objectUrl;
  });
};


export const sliceImageHorizontally = async (
    file: File,
    minGapHeight: number = 10,   // Min height of a white gap to be considered a separator
    whitespaceThreshold: number = 0, // Number of content pixels per row to be considered "whitespace"
): Promise<File[]> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = async () => {
            URL.revokeObjectURL(objectUrl);

            // If the image is too small vertically, don't bother chunking it.
            if (img.height < 300) {
                return resolve([file]);
            }

            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return reject(new Error('Could not get canvas context'));

            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            // 1. Create Vertical Projection Profile
            const verticalProjection = new Array(canvas.height).fill(0);
            for (let y = 0; y < canvas.height; y++) {
                let contentPixels = 0;
                for (let x = 0; x < canvas.width; x++) {
                    const i = (y * canvas.width + x) * 4;
                    // Consider a pixel as content if it's not almost white.
                    // A simple brightness check is effective. (R+G+B)/3 < threshold
                    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
                    if (brightness < 250) { // Not white
                        contentPixels++;
                    }
                }
                verticalProjection[y] = contentPixels;
            }

            // 2. Identify significant whitespace gaps
            const gaps: { start: number, end: number }[] = [];
            let inGap = false;
            let gapStart = 0;
            for (let y = 0; y < canvas.height; y++) {
                if (verticalProjection[y] <= whitespaceThreshold && !inGap) {
                    inGap = true;
                    gapStart = y;
                } else if (verticalProjection[y] > whitespaceThreshold && inGap) {
                    inGap = false;
                    const gapHeight = y - gapStart;
                    if (gapHeight >= minGapHeight) {
                        gaps.push({ start: gapStart, end: y });
                    }
                }
            }
            if (inGap && (canvas.height - gapStart) >= minGapHeight) {
                gaps.push({ start: gapStart, end: canvas.height });
            }

            if (gaps.length === 0) {
                return resolve([file]);
            }

            // 3. Define initial content slices based on the gaps
            const initialSlices: { start: number, end: number }[] = [];
            let lastY = 0;
            for (const gap of gaps) {
                if (gap.start > lastY) {
                    initialSlices.push({ start: lastY, end: gap.start });
                }
                lastY = gap.end;
            }
            if (canvas.height > lastY) {
                initialSlices.push({ start: lastY, end: canvas.height });
            }
            
            if (initialSlices.length <= 1) {
                return resolve([file]);
            }

            // 3a. Merge small contiguous slices
            const minSliceHeight = canvas.height * 0.10; // 10% of total height
            const mergedSlices: { start: number, end: number }[] = [];
            let currentMergeGroupStart = -1;
            let currentMergeGroupEnd = -1;

            for (let i = 0; i < initialSlices.length; i++) {
                const slice = initialSlices[i];
                const sliceHeight = slice.end - slice.start;

                if (sliceHeight < minSliceHeight) {
                    // This is a small slice, add it to the current group
                    if (currentMergeGroupStart === -1) {
                        currentMergeGroupStart = slice.start; // Start a new group
                    }
                    currentMergeGroupEnd = slice.end; // Extend the group
                } else {
                    // This is a large slice.
                    // First, finalize any pending small group.
                    if (currentMergeGroupStart !== -1) {
                        mergedSlices.push({ start: currentMergeGroupStart, end: currentMergeGroupEnd });
                        currentMergeGroupStart = -1;
                        currentMergeGroupEnd = -1;
                    }
                    // Then, add the large slice itself.
                    mergedSlices.push(slice);
                }
            }

            // After the loop, check if there's a pending group to finalize.
            if (currentMergeGroupStart !== -1) {
                mergedSlices.push({ start: currentMergeGroupStart, end: currentMergeGroupEnd });
            }
            
            // If the very last slice is too small, merge it with the previous one.
            if (mergedSlices.length > 1) {
                const lastSlice = mergedSlices[mergedSlices.length - 1];
                const lastSliceHeight = lastSlice.end - lastSlice.start;
                if (lastSliceHeight < minSliceHeight) {
                    const previousSlice = mergedSlices[mergedSlices.length - 2];
                    previousSlice.end = lastSlice.end; // Extend the previous slice to cover the last one
                    mergedSlices.pop(); // Remove the small last slice
                }
            }
            
            const slices = mergedSlices;

            if (slices.length <= 1) {
                return resolve([file]);
            }

            // 4. Crop the original canvas into new files
            const sliceToBlob = (sliceCanvas: HTMLCanvasElement): Promise<Blob> => {
                return new Promise(blobResolve => {
                    sliceCanvas.toBlob(blob => {
                        if (blob) blobResolve(blob);
                        else reject(new Error("Failed to create blob from canvas"));
                    }, file.type);
                });
            };

            const blobs: Blob[] = [];
            const bleed = 20; // Add 20px bleed/margin
            for (const slice of slices) {
                const startY = Math.max(0, slice.start - bleed);
                const endY = Math.min(canvas.height, slice.end + bleed);
                const height = endY - startY;

                if (height <= 0) continue;

                const sliceCanvas = document.createElement('canvas');
                sliceCanvas.width = canvas.width;
                sliceCanvas.height = height;
                const sliceCtx = sliceCanvas.getContext('2d');
                if (!sliceCtx) continue;

                sliceCtx.drawImage(canvas, 0, startY, canvas.width, height, 0, 0, canvas.width, height);
                blobs.push(await sliceToBlob(sliceCanvas));
            }
            
            const originalName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
            const fileExt = file.name.split('.').pop() || 'png';

            const slicedFiles = blobs.map((blob, index) => {
                return new File([blob], `${originalName}-slice${index + 1}.${fileExt}`, { type: file.type });
            });

            resolve(slicedFiles.length > 0 ? slicedFiles : [file]);
        };

        img.onerror = (err) => {
            URL.revokeObjectURL(objectUrl);
            reject(err);
        };
        img.src = objectUrl;
    });
};

export const processImage = async (
  file: File, 
  imageType: 'text' | 'no-text',
  onChunk: (chunk: string, replaceLast?: boolean) => void
): Promise<{ transcription: string; assets: ImageAsset[] }> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable not set");
  }
  const ai = new GoogleGenAI({ apiKey });
  const base64Image = await fileToBase64(file);
  const originalName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;

  if (imageType === 'no-text') {
    onChunk("Packaging figure...");
    // Artificial delay for better UX, since this will be almost instant.
    await new Promise(resolve => setTimeout(resolve, 50));

    const newAsset: ImageAsset = {
      fileName: file.name,
      data: base64Image,
      description: originalName,
    };
    
    onChunk("Processing complete.");
    return { transcription: "", assets: [newAsset] };

  } else { // 'text' type
    onChunk("Extracting text from image chunk...");
    apiUsageTracker.incrementRequests();

    const ocrResponse = await withRetry(() => ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [{
        parts: [
          { text: "Your sole task is to act as an OCR engine. Extract all text content from this image *verbatim*. Preserve original formatting like paragraphs and line breaks. Do not summarize, interpret, or answer any questions found in the text. Simply transcribe it exactly as it appears. Use $inline katex$ when transcribing math equations, i.e. pi/2 would be $\\frac {\\pi} {2}$. Respond with a JSON object containing the extracted text." },
          { inlineData: { mimeType: file.type, data: base64Image } }
        ]
      }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            full_text: {
              type: Type.STRING,
              description: "All text extracted from the image, with original formatting preserved."
            }
          },
          required: ['full_text']
        }
      }
    }));

    onChunk("Parsing extracted text...");
    const jsonStr = ocrResponse.text.trim();
    const parsedOcr = JSON.parse(jsonStr);
    let transcription = parsedOcr.full_text || "";

    const alphanumericChars = transcription.match(/[a-zA-Z0-9]/g) || [];
    if (alphanumericChars.length < 20) {
        onChunk(`Low confidence OCR result (${alphanumericChars.length} chars). Retrying with visual analysis...`);
        apiUsageTracker.incrementRequests();

        const analysisResponse = await withRetry(() => ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: [{
                parts: [
                    { text: "Analyze this image and describe its content. Your primary goal is to provide a verbatim transcription of any visible text. This includes characters, symbols, handwriting, or mathematical equations. Use $inline katex$ when transcribing math equations, i.e. pi/2 would be $\\frac {\\pi} {2}$. If there are questions, transcribe them exactly as they are written; do not answer them. If the image contains a diagram or figure, describe it clearly. Provide the description as plain text." },
                    { inlineData: { mimeType: file.type, data: base64Image } }
                ]
            }],
        }));
        
        transcription = analysisResponse.text.trim();
        onChunk("Visual analysis complete.");
    }

    onChunk("Processing complete.");
    return { transcription, assets: [] };
  }
};


export const transcribeAudioStream = async (
  file: File,
  onChunk: (chunk: string) => void,
  onRetry: (attempt: number, error: Error) => void,
  onLog?: (msg: string) => void
): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable not set");
  }

  const ai = new GoogleGenAI({ apiKey });
  const maxRetries = 1;
  const retryDelay = 15000; // 15 seconds
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      apiUsageTracker.incrementRequests();
      if (onLog) onLog(`Converting audio to base64...`);
      const base64Audio = await fileToBase64(file);

      // Simulate an visual upload progress since we are uploading a potentially large base64 inlineData payload
      const payloadSizeBytes = base64Audio.length;
      const approxUploadTimeMs = Math.max(2000, (payloadSizeBytes / 600000) * 1000); // assume ~600KB/s
      let uploadProgress = 0;
      let progressInterval: any;
      
      if (onLog) {
         onLog(`Uploading audio payload to AI model... [0%]`);
         progressInterval = setInterval(() => {
             uploadProgress += 1000;
             const percentage = Math.min(99, Math.floor((uploadProgress / approxUploadTimeMs) * 100));
             if (percentage < 99) {
                 onLog(`Uploading audio payload to AI model... [${percentage}%]`);
             } else {
                 onLog(`Waiting on AI to process and return chunks... (Est: ~60s - 120s) [100%]`);
                 clearInterval(progressInterval);
             }
         }, 1000);
      }

      const responseStream = await ai.models.generateContentStream({
              model: 'gemini-3.5-flash',
              contents: [{ 
                  parts: [
                      { text: "You are an expert audio transcriptionist. Your single responsibility is to transcribe the following audio file verbatim. Provide a clean and accurate transcription. Use $inline katex$ when transcribing math equations, i.e. pi/2 would be $\\frac {\\pi} {2}$. If there are questions in the audio, transcribe the questions as spoken; do not answer them. Do not add any extra information, summaries, or interpretations. Separate distinct paragraphs with a double newline." },
                      { 
                          inlineData: { 
                              mimeType: file.type, 
                              data: base64Audio 
                          } 
                      }
                  ]
              }],
          });
          
          if (progressInterval) clearInterval(progressInterval);
          
          let fullTranscription = "";
          let isFirstChunk = true;
          for await (const chunk of responseStream) {
            if (isFirstChunk) {
              if (onLog) onLog(`Received first chunk from API.`);
              isFirstChunk = false;
            }
        const textChunk = chunk.text;
        if (textChunk) {
          fullTranscription += textChunk;
          onChunk(textChunk);
        }
      }
      if (onLog) onLog(`Transcription complete.`);
      return fullTranscription; // Success
    } catch (error) {
      if (progressInterval) clearInterval(progressInterval);
      console.error(`Error transcribing audio on attempt ${attempt + 1}:`, error);
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        if (onLog) onLog(`Attempt ${attempt + 1} failed, retrying in 15 seconds...`);
        onRetry(attempt + 1, lastError);
        await delay(retryDelay);
      }
    }
  }

  if (lastError) {
    throw new Error(`Failed to transcribe after ${maxRetries + 1} attempts: ${lastError.message}`);
  }
  throw new Error("An unknown error occurred during transcription.");
};

export const refineMarkdownStream = async (
    markdownContent: string,
    onChunk: (chunk: string) => void,
    onLog?: (msg: string) => void
): Promise<string> => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable not set");
    }
    const ai = new GoogleGenAI({ apiKey });
    apiUsageTracker.incrementRequests();

    const prompt = `
You are an expert editor specializing in creating hierarchical notes for TiddlyWiki using the Streams plugin (Lithic format).
Your task is to refine the provided raw text, which is a collation of transcriptions and notes, into a structured document using markdown headers for hierarchy.

**Formatting Instructions:**

1.  **Hierarchy and Structure:**
    *   **Document Title (H1):** The very first line must be an H1 header representing the main topic or source.
        *   Example: \`# Project Overview\`
    *   **Chapters/Sections (H2):** Divide the content into logical sections or chapters using H2 headers. These will become "Parent Nodes" in the Streams format.
        *   Example: \`## Introduction\`
    *   **Pages/Key Points (H3):** Within each chapter, break down details into H3 headers. Each H3 will become a "Child Node" (Page) in the Streams format.
        *   Example: \`### Key Objectives\`
    *   **Body Content:** The content within each H3 node should be well-formatted text. Use bullet points only for actual lists of items, not for the entire structure.

2.  **Content and Details:**
    *   Improve readability by correcting grammar, spelling, and punctuation.
    *   Do **not** paraphrase, summarize, or alter the original meaning.
    *   Preserve any questions found in the text *exactly as they are*.
    *   Merge fragmented ideas into coherent paragraphs or lists within their respective sections.

3.  **Mathematical Equations (KaTeX):**
    *   For **inline** mathematical equations, wrap them in single dollar signs: \`$E = mc^2$\`.
    *   For **block-level** equations, wrap them in double dollar signs on their own lines.
    *   Use $inline katex$ when transcribing math equations, i.e. pi/2 would be $\\frac {\\pi} {2}$.

4.  **Preserve Image Links:**
    *   Do **NOT** alter any markdown image links (e.g., \`![description](assets/filename.png)\`). They must be preserved exactly as they are.

5.  **Output:**
    *   Return only the refined markdown content with H1, H2, and H3 headers. Do not include any preambles, apologies, or explanations.

**Raw Content to Refine:**
---
${markdownContent}
---
`;

    if (onLog) onLog("Requesting document refinement from AI...");
    const responseStream = await withRetry(() => ai.models.generateContentStream({
        model: 'gemini-3.5-flash',
        contents: [{ parts: [{ text: prompt }] }],
    }), 2, 3000, onLog);

    let fullText = "";
    for await (const chunk of responseStream) {
        const textChunk = chunk.text;
        if (textChunk) {
            fullText += textChunk;
            onChunk(textChunk);
        }
    }

    if (onLog) onLog("Refinement complete.");
    return fullText.trim();
};