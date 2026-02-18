"use client";

import { useState, useRef, useEffect, ChangeEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface RecipeData {
  name: string;
  calories: string;
  description: string;
  ingredients: string[];
  instructions: string[];
}

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4MB safety limit for serverless body size
const UNSUPPORTED_MIME_TYPES = new Set(["image/heic", "image/heif"]);

export default function Home() {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<RecipeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  // --- AGGRESSIVE COMPRESSION LOGIC --- (dummy touch)
  const compressImage = async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.src = url;

      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas error"));

        // FORCE SMALL SIZE: Max 512px is plenty for AI
        const MAX_SIZE = 512;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        // AGGRESSIVE COMPRESSION: Quality 0.5 (50%)
        canvas.toBlob(
          (blob) => {
            if (blob) {
              console.log(`Original size: ${file.size / 1024}KB`);
              console.log(`Compressed size: ${blob.size / 1024}KB`);
              resolve(blob);
            } else {
              reject(new Error("Compression failed"));
            }
          },
          "image/jpeg",
          0.5 
        );
      };
      img.onerror = () =>
        reject(new Error("This photo format is not supported by your browser."));
    });
  };

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (!file.type.startsWith("image/")) {
        throw new Error("Please upload a valid image.");
      }
      if (UNSUPPORTED_MIME_TYPES.has(file.type.toLowerCase())) {
        throw new Error(
          "HEIC/HEIF is not supported. Use JPG/PNG/WebP or set iPhone Camera Format to Most Compatible."
        );
      }

      setLoading(true);
      setError(null);
      setData(null);

      const updatePreview = (blob: Blob) => {
        const previewUrl = URL.createObjectURL(blob);
        if (previewUrlRef.current) {
          URL.revokeObjectURL(previewUrlRef.current);
        }
        previewUrlRef.current = previewUrl;
        setImage(previewUrl);
      };

      // Show immediate preview while compression/upload happens
      updatePreview(file);

      // Compress if possible, otherwise upload original file
      let uploadFile: File = file;
      try {
        const compressedBlob = await compressImage(file);
        uploadFile = new File([compressedBlob], `${Date.now()}-capture.jpg`, {
          type: "image/jpeg",
        });
        updatePreview(uploadFile);
      } catch (compressionError) {
        console.warn("Compression failed.", compressionError);
      }

      if (uploadFile.size > MAX_UPLOAD_BYTES) {
        throw new Error("Image is too large. Use a smaller JPG/PNG/WebP image.");
      }

      // Send to API
      const formData = new FormData();
      formData.append("image", uploadFile, uploadFile.name);

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        // Check specifically for payload error
        if (response.status === 413) {
          throw new Error("Image is still too large. Try a different one.");
        }
        throw new Error(errorText || `Server error: ${response.status}`);
      }

      const result = await response.json();
      if (result.error) throw new Error(result.error);

      setData(result);
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-white relative overflow-hidden font-sans">
      <div className="fixed top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-900/30 rounded-full blur-[100px]" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-orange-900/20 rounded-full blur-[100px]" />

      <div className="max-w-md mx-auto min-h-screen flex flex-col p-6 relative z-10">
        <header className="flex justify-between items-center mb-8 pt-4">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent">
              ChefCam
            </h1>
            <p className="text-neutral-400 text-xs">Powered by Gemini 2.5</p>
          </div>
        </header>

        {error && (
          <div className="bg-red-500/20 text-red-200 p-4 rounded-xl mb-6 text-sm border border-red-500/30">
            {error}
          </div>
        )}

        {!image && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4 opacity-60">
            <div className="w-20 h-20 rounded-full bg-neutral-800 flex items-center justify-center border border-neutral-700">
              <CameraIcon className="w-8 h-8 text-neutral-400" />
            </div>
            <p className="text-neutral-400">Snap a photo of food to get a recipe</p>
          </div>
        )}

        <div className="flex-1 space-y-6 pb-32">
          {image && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative w-full aspect-video rounded-2xl overflow-hidden shadow-2xl border border-neutral-800"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="Food" className="w-full h-full object-cover" />
              {loading && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center flex-col space-y-3">
                  <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-medium text-orange-400 animate-pulse">Consulting Michelin Chef...</p>
                </div>
              )}
            </motion.div>
          )}

          <AnimatePresence>
            {data && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-neutral-900/80 backdrop-blur-md border border-neutral-800 rounded-3xl p-6 shadow-2xl space-y-6"
              >
                <div>
                  <div className="flex justify-between items-start">
                    <h2 className="text-2xl font-bold text-white leading-tight">{data.name}</h2>
                    <span className="bg-green-500/10 text-green-400 text-xs px-2 py-1 rounded-full font-medium border border-green-500/20">
                      {data.calories}
                    </span>
                  </div>
                  <p className="text-neutral-400 text-sm mt-2">{data.description}</p>
                </div>

                <div className="h-px bg-neutral-800" />

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-3">Ingredients</h3>
                  <ul className="space-y-2">
                    {data.ingredients.map((ing, i) => (
                      <li key={i} className="flex items-center space-x-3 text-sm text-neutral-300">
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                        <span>{ing}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="h-px bg-neutral-800" />

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-3">Preparation</h3>
                  <div className="space-y-4">
                    {data.instructions.map((step, i) => (
                      <div key={i} className="flex space-x-4">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-800 border border-neutral-700 text-xs flex items-center justify-center text-neutral-400">
                          {i + 1}
                        </span>
                        <p className="text-sm text-neutral-300 leading-relaxed pt-0.5">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="fixed bottom-8 left-0 right-0 flex justify-center z-50 pointer-events-none">
          <label className="pointer-events-auto cursor-pointer group">
            <input 
              type="file" 
              accept="image/jpeg,image/png,image/webp" 
              capture="environment" 
              className="hidden" 
              onChange={handleImageUpload}
              ref={fileInputRef}
            />
            <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.3)] transition-transform group-active:scale-95">
              <CameraIcon className="w-8 h-8 text-black" />
            </div>
          </label>
        </div>

      </div>
    </main>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
      <circle cx="12" cy="13" r="3"/>
    </svg>
  );
}
