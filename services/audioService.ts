// --- Audio Processing Utilities ---

const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

const audioBufferToWav = (buffer: AudioBuffer): Blob => {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArray = new ArrayBuffer(length);
  const view = new DataView(bufferArray);
  let pos = 0;
  const setUint16 = (data: number) => { view.setUint16(pos, data, true); pos += 2; };
  const setUint32 = (data: number) => { view.setUint32(pos, data, true); pos += 4; };
  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); setUint32(0x20746d66);
  setUint32(16); setUint16(1); setUint16(numOfChan); setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); setUint16(numOfChan * 2); setUint16(16);
  setUint32(0x61746164); setUint32(length - pos - 4);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  let offset = 0;
  while (pos < length) {
    for (let i = 0; i < numOfChan; i++) {
      const sample = Math.max(-1, Math.min(1, channels[i][offset] || 0));
      view.setInt16(pos, sample < 0 ? sample * 32768 : sample * 32767, true);
      pos += 2;
    }
    offset++;
  }
  return new Blob([view], { type: 'audio/wav' });
};

const findSilence = (
  audioBuffer: AudioBuffer, searchStartTime: number, searchDuration: number, minSilenceDuration: number, silenceThreshold: number
): number | null => {
  const { sampleRate, numberOfChannels, length } = audioBuffer;
  const startSample = Math.floor(searchStartTime * sampleRate);
  const endSample = Math.min(length, Math.floor((searchStartTime + searchDuration) * sampleRate));
  const minSilentSamples = Math.floor(minSilenceDuration * sampleRate);
  if (startSample >= endSample) return null;
  const channelData = Array.from({ length: numberOfChannels }, (_, i) => audioBuffer.getChannelData(i));
  let silentSamplesCount = 0;
  for (let i = startSample; i < endSample; i++) {
    let isSilent = true;
    for (let chan = 0; chan < numberOfChannels; chan++) {
      if (Math.abs(channelData[chan][i]) > silenceThreshold) { isSilent = false; break; }
    }
    if (isSilent) { silentSamplesCount++; } else { silentSamplesCount = 0; }
    if (silentSamplesCount >= minSilentSamples) {
      return (i - minSilentSamples + 1 + minSilentSamples / 2) / sampleRate;
    }
  }
  return null;
};

export const chunkAudioFile = async (
    file: File, log: (message: string, replaceLast?: boolean) => void
): Promise<{ chunkData: { file: File; duration: number }[]; totalDuration: number }> => {
  const CHUNK_DURATION = 10 * 60; const MIN_SILENCE_DURATION = 0.5;
  const SILENCE_THRESHOLD = 0.01; const SEARCH_WINDOW = 120;
  log(`[${file.name}] Starting audio processing...`);
  log(` -> Reading file into memory...`);
  const arrayBuffer = await file.arrayBuffer();
  log(` -> File read complete (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB).`);
  log(` -> Decoding audio data...`);
  
  const decodeStartTime = Date.now();
  const decodeInterval = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - decodeStartTime) / 1000);
    log(` -> Decoding audio data... (${elapsedSeconds}s)`, true);
  }, 1000);

  let audioBuffer;
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  } finally {
    clearInterval(decodeInterval);
  }

  const duration = audioBuffer.duration;
  log(` -> Audio decoded. Duration: ${duration.toFixed(2)}s`, true);
  if (duration <= CHUNK_DURATION) {
    log(` -> No splitting required.`);
    return { chunkData: [{ file, duration }], totalDuration: duration };
  }
  log(` -> Preparing to run chunking algorithm...`);
  await new Promise(resolve => setTimeout(resolve, 50));
  
  const chunks: { file: File, duration: number }[] = [];
  let currentStartTime = 0; let part = 1;
  const totalChunks = Math.ceil(duration / CHUNK_DURATION);

  while (currentStartTime < audioBuffer.duration) {
    log(` -> Creating chunk ${part} of ~${totalChunks}...`, true);
    await new Promise(resolve => setTimeout(resolve, 0)); // Yield to main thread

    let targetEndTime = currentStartTime + CHUNK_DURATION;
    let actualEndTime = Math.min(targetEndTime, audioBuffer.duration);
    if (targetEndTime < audioBuffer.duration) {
      const splitTime = findSilence(audioBuffer, Math.max(currentStartTime, targetEndTime - SEARCH_WINDOW / 2), SEARCH_WINDOW, MIN_SILENCE_DURATION, SILENCE_THRESHOLD);
      if (splitTime !== null) actualEndTime = splitTime;
    }
    if (actualEndTime <= currentStartTime + 1) {
       actualEndTime = Math.min(currentStartTime + CHUNK_DURATION, audioBuffer.duration);
       if(actualEndTime <= currentStartTime) break;
    }
    const startSample = Math.floor(currentStartTime * audioBuffer.sampleRate);
    const endSample = Math.floor(actualEndTime * audioBuffer.sampleRate);
    const chunkLength = endSample - startSample;
    if (chunkLength <= 0) break;
    const chunkBuffer = audioContext.createBuffer(audioBuffer.numberOfChannels, chunkLength, audioBuffer.sampleRate);
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      chunkBuffer.copyToChannel(audioBuffer.getChannelData(i).subarray(startSample, endSample), i);
    }
    const wavBlob = audioBufferToWav(chunkBuffer);
    const originalName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const chunkFile = new File([wavBlob], `${originalName}-part${String(part).padStart(2, '0')}.wav`, { type: 'audio/wav' });
    chunks.push({ file: chunkFile, duration: actualEndTime - currentStartTime });
    currentStartTime = actualEndTime; part++;
  }
  log(` -> Chunking complete. Created ${chunks.length} chunks.`, true);
  return { chunkData: chunks, totalDuration: duration };
};
