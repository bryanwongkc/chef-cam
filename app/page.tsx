"use client";

import { useState, useRef, ChangeEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface RecipeData {
  name: string;
  calories: string;
  description: string;
  ingredients: string[];
  instructions: string[];
}

export default function Home() {
  // State variables
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<RecipeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- 1. COMPRESSION LOGIC (The Fix) ---
  const compressImage = async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // Create a temporary URL for the file
      const url = URL.createObjectURL(file);
      img.src = url;

      img.onload = () => {
        // Free memory immediately
        URL.revokeObjectURL(url);

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject("Canvas error");

        // Aggressive resizing to max 600px to prevent mobile crash
        const MAX_SIZE = 600; 
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

        // Convert to efficient JPEG blob (60% quality)
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject("Compression failed");
          },
          "image/jpeg",
          0.6 
        );
      };
      img.onerror = (err) => reject(err);
    });
  };

  // --- 2. UPLOAD HANDLER ---
  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      setError(null);
      setData(null);
      // Don't set image state yet to save memory

      // A. Compress first
      const compressedBlob = await compressImage(file);
      
      // B. Create preview from small compressed image
      const previewUrl = URL.createObjectURL(compressedBlob);
      setImage(previewUrl);

      // C. Send to API
      const formData = new FormData();
      formData.append("image", compressedBlob); // Sending smaller file

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text(); 
        throw new Error(`Server error: ${response.status}`);
      }

      const result = await response.json();
      if (result.error) throw new Error(result.error);

      setData(result);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to analyze. Try a different photo.");
    } finally {
      setLoading(false);
    }
  };

  // --- 3. UI RENDER ---
  return (
    <main className="min-h-screen bg-neutral-950 text-white relative overflow-hidden font-sans">
      <div className="fixed top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-900/30 rounded-full blur-[100px]" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-orange-900/20 rounded-full blur-[100px]" />

      <div className="max-w-md mx-auto min-h-screen flex flex-col p-6 relative z-10">
        <header className="flex justify-between items-center mb-8 pt-4">
          <div>
            <h1 className="text-2xl font-bold