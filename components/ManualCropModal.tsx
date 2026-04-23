import React, { useState, useRef, useEffect } from 'react';
import { UploadedFile } from '../types';

interface ManualCropModalProps {
  fileToCrop: UploadedFile;
  onClose: () => void;
  onConfirm: (originalFileId: string, cropBox: { x: number; y: number; width: number; height: number }) => void;
}

const ManualCropModal: React.FC<ManualCropModalProps> = ({ fileToCrop, onClose, onConfirm }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [startPoint, setStartPoint] = useState({ x: 0, y: 0 });

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(fileToCrop.file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [fileToCrop]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setStartPoint({ x, y });
    setCrop({ x, y, width: 0, height: 0 });
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !imageContainerRef.current) return;
    const rect = imageContainerRef.current.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const newX = Math.min(startPoint.x, currentX);
    const newY = Math.min(startPoint.y, currentY);
    const newWidth = Math.abs(currentX - startPoint.x);
    const newHeight = Math.abs(currentY - startPoint.y);

    setCrop({ x: newX, y: newY, width: newWidth, height: newHeight });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleConfirm = () => {
    if (!imageRef.current || crop.width === 0 || crop.height === 0) return;

    const { naturalWidth, naturalHeight, clientWidth, clientHeight } = imageRef.current;
    const scaleX = naturalWidth / clientWidth;
    const scaleY = naturalHeight / clientHeight;

    const actualCrop = {
      x: Math.round(crop.x * scaleX),
      y: Math.round(crop.y * scaleY),
      width: Math.round(crop.width * scaleX),
      height: Math.round(crop.height * scaleY),
    };
    
    if(actualCrop.width > 0 && actualCrop.height > 0) {
      onConfirm(fileToCrop.id, actualCrop);
    }
  };

  return (
    <div 
        className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
        aria-modal="true"
        role="dialog"
    >
      <div className="bg-slate-800 rounded-lg shadow-2xl p-6 w-full max-w-4xl border border-slate-700">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-slate-200">Manual Crop</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">&times;</button>
        </div>
        <p className="text-sm text-slate-400 mb-4">Click and drag on the image to select an area to crop.</p>
        <div 
          ref={imageContainerRef}
          className="relative max-h-[70vh] w-full select-none cursor-crosshair overflow-hidden"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {imageUrl && (
            <img 
              ref={imageRef}
              src={imageUrl} 
              alt="Crop preview" 
              className="max-h-[70vh] w-auto h-auto mx-auto pointer-events-none" 
            />
          )}
          {crop.width > 0 && crop.height > 0 && (
            <div
              className="absolute border-2 border-dashed border-indigo-400 bg-indigo-500/20"
              style={{
                left: `${crop.x}px`,
                top: `${crop.y}px`,
                width: `${crop.width}px`,
                height: `${crop.height}px`,
              }}
            />
          )}
        </div>
        <div className="flex justify-end space-x-4 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700 rounded-md hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-indigo-500"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={crop.width === 0 || crop.height === 0}
            className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-indigo-500 disabled:bg-slate-600 disabled:cursor-not-allowed"
          >
            Confirm Crop
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManualCropModal;
