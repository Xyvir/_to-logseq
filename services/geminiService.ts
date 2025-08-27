import { GoogleGenAI, Type } from "@google/genai";
import { apiUsageTracker } from './apiUsageService';
import { ImageAsset } from "../types";

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

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

export const classifyImageType = async (file: File): Promise<'text' | 'no-text'> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
  }
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const base64Image = await fileToBase64(file);

  apiUsageTracker.incrementRequests();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      parts: [
        { text: "Analyze the image. Does it primarily contain a significant amount of text (e.g., a document, a screenshot with lots of text, a presentation slide), or is it mostly a photograph or illustration with little to no text? Respond with only the word 'text' or 'no-text'." },
        { inlineData: { mimeType: file.type, data: base64Image } }
      ]
    }]
  });
  
  const result = response.text.trim().toLowerCase();
  if (result === 'text') {
    return 'text';
  }
  return 'no-text';
};

export const isKeyframe = async (file: File): Promise<boolean> => {
    if (!process.env.API_KEY) {
      throw new Error("API_KEY environment variable not set");
    }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const base64Image = await fileToBase64(file);
  
    apiUsageTracker.incrementRequests();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        parts: [
          { text: "Analyze the image. Is this a slide, diagram, chart, or a screen with significant text that looks like a key point in a presentation or tutorial? Or is it a person talking, a landscape, or a dynamic scene from a video? Respond with only the word 'keyframe' or 'not-keyframe'." },
          { inlineData: { mimeType: file.type, data: base64Image } }
        ]
      }]
    });
    
    const result = response.text.trim().toLowerCase();
    return result === 'keyframe';
  };

export const processImage = async (
  file: File, 
  imageType: 'text' | 'no-text',
  onChunk: (chunk: string, replaceLast?: boolean) => void
): Promise<{ transcription: string; assets: ImageAsset[] }> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
  }
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const base64Image = await fileToBase64(file);
  const originalName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;

  if (imageType === 'no-text') {
    apiUsageTracker.incrementRequests();
    const responseStream = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: [{
        parts: [
          { text: "You are an expert at describing images. Provide a detailed description of the following image." },
          { inlineData: { mimeType: file.type, data: base64Image } }
        ]
      }]
    });
    
    let fullDescription = "";
    for await (const chunk of responseStream) {
      const textChunk = chunk.text;
      if (textChunk) {
        fullDescription += textChunk;
        onChunk(textChunk);
      }
    }
    return { transcription: fullDescription, assets: [] };

  } else { // 'text' type
    onChunk("Analyzing layout and extracting text...");
    apiUsageTracker.incrementRequests();

    const layoutResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        parts: [
          { text: "Analyze the layout of this image. Extract all text content, preserving its original formatting (like paragraphs and line breaks). Also, identify all distinct non-text figures (e.g., charts, photographs, diagrams). For each figure, provide a one-sentence descriptive caption and its bounding box coordinates (normalized [y_min, x_min, y_max, x_max]). Respond with a JSON object." },
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
            },
            figures: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  caption: {
                    type: Type.STRING,
                    description: "A one-sentence caption for the figure."
                  },
                  bounding_box: {
                    type: Type.ARRAY,
                    description: "Normalized coordinates [y_min, x_min, y_max, x_max].",
                    items: { type: Type.NUMBER }
                  }
                },
                required: ['caption', 'bounding_box']
              }
            }
          },
          required: ['full_text', 'figures']
        }
      }
    });

    onChunk("Parsing layout and cropping figures...");
    const jsonStr = layoutResponse.text.trim();
    const parsedLayout = JSON.parse(jsonStr);

    const transcription = parsedLayout.full_text || "";
    const figures = parsedLayout.figures || [];
    const newAssets: ImageAsset[] = [];

    if (figures.length > 0) {
      onChunk(`Found ${figures.length} figure(s). Cropping...`);
      let count = 1;
      for (const figure of figures) {
        if (figure.bounding_box && figure.bounding_box.length === 4) {
          try {
            const croppedBase64 = await cropImage(base64Image, file.type, figure.bounding_box as [number, number, number, number]);
            const fileExt = file.name.split('.').pop() || 'png';
            newAssets.push({
              fileName: `${originalName}-fig${count}.${fileExt}`,
              data: croppedBase64,
              description: figure.caption || `Figure ${count} from ${file.name}`
            });
            onChunk(`Cropped figure ${count}...`, true);
            count++;
          } catch (e) {
            console.error("Failed to crop image figure:", e);
            onChunk(`Failed to crop figure ${count}.`, true);
          }
        }
      }
    }

    onChunk("Processing complete.");
    return { transcription, assets: newAssets };
  }
};


export const transcribeAudioStream = async (
  file: File,
  onChunk: (chunk: string) => void,
  onRetry: (attempt: number, error: Error) => void
): Promise<string> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const maxRetries = 1;
  const retryDelay = 15000; // 15 seconds
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      apiUsageTracker.incrementRequests();
      const base64Audio = await fileToBase64(file);

      const responseStream = await ai.models.generateContentStream({
          model: 'gemini-2.5-flash',
          contents: [{ 
              parts: [
                  { text: "You are an expert audio transcriptionist. Transcribe the following audio file. Provide a clean and accurate transcription. Separate distinct paragraphs with a double newline." },
                  { 
                      inlineData: { 
                          mimeType: file.type, 
                          data: base64Audio 
                      } 
                  }
              ]
          }],
      });
      
      let fullTranscription = "";
      for await (const chunk of responseStream) {
        const textChunk = chunk.text;
        if (textChunk) {
          fullTranscription += textChunk;
          onChunk(textChunk);
        }
      }
      return fullTranscription; // Success
    } catch (error) {
      console.error(`Error transcribing audio on attempt ${attempt + 1}:`, error);
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
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