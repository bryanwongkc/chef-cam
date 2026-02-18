"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type Ingredient = {
  item: string;
  amount: string;
};

type Recipe = {
  dishName: string;
  shortDescription: string;
  cuisine: string;
  difficulty: "Easy" | "Medium" | "Hard";
  servings: string;
  prepTime: string;
  cookTime: string;
  caloriesPerServing: string;
  ingredients: Ingredient[];
  instructions: string[];
  platingTips: string[];
};

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export default function Home() {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cachedFile, setCachedFile] = useState<File | null>(null);
  const [cachedFromCamera, setCachedFromCamera] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [loadingStartedAt, setLoadingStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const hasResult = useMemo(() => Boolean(recipe), [recipe]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (!loading || !loadingStartedAt) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - loadingStartedAt) / 1000)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [loading, loadingStartedAt]);

  async function compressImage(file: File, fromCamera: boolean): Promise<File> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const sourceUrl = URL.createObjectURL(file);
      image.src = sourceUrl;

      image.onload = () => {
        URL.revokeObjectURL(sourceUrl);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not process image."));
          return;
        }

        const maxSide = fromCamera ? 880 : 1024;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const width = Math.round(image.width * scale);
        const height = Math.round(image.height * scale);

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(image, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Could not compress image."));
              return;
            }
            resolve(new File([blob], `dish-${Date.now()}.jpg`, { type: "image/jpeg" }));
          },
          "image/jpeg",
          fromCamera ? 0.66 : 0.74
        );
      };

      image.onerror = () => {
        URL.revokeObjectURL(sourceUrl);
        reject(new Error("Unsupported image format. Use JPG, PNG, or WebP."));
      };
    });
  }

  async function prepareImage(file: File, fromCamera: boolean) {
    if (!file.type.startsWith("image/")) {
      throw new Error("Please choose a valid image file.");
    }
    if (!ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
      throw new Error("Use JPG, PNG, or WebP. HEIC/HEIF is not supported.");
    }

    if (fromCamera) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setCachedFile(file);
      setCachedFromCamera(true);
      setRecipe(null);
      setError(null);
      return file;
    }

    const compressed = await compressImage(file, false);
    if (compressed.size > MAX_UPLOAD_BYTES) {
      throw new Error("Image is too large after compression. Try another photo.");
    }

    const nextPreview = URL.createObjectURL(compressed);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(nextPreview);
    setCachedFile(compressed);
    setCachedFromCamera(false);
    setRecipe(null);
    setError(null);
    return compressed;
  }

  async function openWebCamera() {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setError("Could not open camera. Please allow camera permission or use Upload.");
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    setCameraOpen(false);
  }

  async function captureFromWebCamera() {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    const width = 960;
    const ratio = video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 0.75;
    canvas.width = width;
    canvas.height = Math.round(width * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Could not capture image.");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.72)
    );
    if (!blob) {
      setError("Could not capture image.");
      return;
    }

    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
    stopCamera();
    try {
      const prepared = await prepareImage(file, true);
      await analyzeFile(prepared);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to process camera photo.");
    }
  }

  async function analyzeFile(file: File) {
    setLoading(true);
    setLoadingStartedAt(Date.now());
    setElapsedSeconds(0);
    setStatusMessage("Uploading image...");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("image", file, file.name);

      const loadingTextTimer = window.setTimeout(() => {
        setStatusMessage("Generating recipe...");
      }, 450);

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });
      window.clearTimeout(loadingTextTimer);

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Request failed. Please try again.");
      }
      if (!payload) {
        throw new Error("No recipe data received.");
      }
      setRecipe(payload as Recipe);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate recipe.");
    } finally {
      setLoading(false);
      setLoadingStartedAt(null);
      setStatusMessage("");
    }
  }

  async function analyzeCachedImage() {
    if (!cachedFile) {
      setError("Take or upload a photo first.");
      return;
    }
    await analyzeFile(cachedFile);
  }

  async function onFileSelected(event: ChangeEvent<HTMLInputElement>, fromCamera: boolean) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setError(null);
      const prepared = await prepareImage(file, fromCamera);
      if (!fromCamera) await analyzeFile(prepared);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to process image.");
    }
    event.target.value = "";
  }

  return (
    <main className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-10">
        <section className="rounded-[28px] border border-[#e4e4e7] bg-white p-6 shadow-[0_12px_40px_rgba(0,0,0,0.05)] md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6e6e73]">
            ChefCam
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] md:text-5xl">
            Photo to Recipe
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-[#515154] md:text-base">
            Minimal, fast, and camera-friendly. Capture a dish or upload an image to generate
            a structured recipe with Gemini 2.5 Flash.
          </p>

          <div className="mt-6 flex flex-wrap gap-2.5">
            <ActionButton onClick={openWebCamera} label="Open Camera" primary />
            <ActionButton
              onClick={() => cameraInputRef.current?.click()}
              label="Take Photo (System)"
            />
            <ActionButton onClick={() => uploadInputRef.current?.click()} label="Upload" />
          </div>
        </section>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => onFileSelected(e, true)}
        />
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => onFileSelected(e, false)}
        />

        {error && (
          <section className="mt-4 rounded-2xl border border-[#ffd2d2] bg-[#fff6f6] px-4 py-3 text-sm text-[#b42318]">
            {error}
          </section>
        )}

        {cameraOpen && (
          <section className="mt-4 rounded-3xl border border-[#e4e4e7] bg-white p-4 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
            <video
              ref={videoRef}
              className="aspect-video w-full rounded-2xl bg-black object-cover"
              playsInline
              muted
            />
            <div className="mt-3 flex gap-2.5">
              <ActionButton onClick={captureFromWebCamera} label="Capture & Analyze" primary />
              <ActionButton onClick={stopCamera} label="Cancel" />
            </div>
          </section>
        )}

        <section className="mt-5 grid gap-4 md:grid-cols-5">
          <div className="md:col-span-2">
            <div className="rounded-3xl border border-[#e4e4e7] bg-white p-3 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
              <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-[#f2f2f7]">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="Dish preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[#6e6e73]">
                    {cachedFile && cachedFromCamera
                      ? "Camera photo cached. Tap Analyze."
                      : "Add a dish photo to get started."}
                  </div>
                )}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <ActionButton
                  onClick={() => cameraInputRef.current?.click()}
                  label={cachedFromCamera ? "Retake Photo" : "Replace Photo"}
                />
                {cachedFile && cachedFromCamera && !loading && (
                  <ActionButton onClick={analyzeCachedImage} label="Analyze Cached Photo" primary />
                )}
                {loading && (
                  <p className="text-center text-xs text-[#6e6e73]">
                    {statusMessage} {elapsedSeconds > 0 ? `(${elapsedSeconds}s)` : ""}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="md:col-span-3">
            {loading && (
              <div className="rounded-3xl border border-[#e4e4e7] bg-white p-6 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8e8e93]">
                  Processing
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.01em]">
                  Building your recipe...
                </h2>
                <p className="mt-2 text-sm text-[#6e6e73]">
                  {statusMessage} {elapsedSeconds > 0 ? `(${elapsedSeconds}s)` : ""}
                </p>
                <div className="mt-4 space-y-2">
                  <div className="h-3 w-2/3 animate-pulse rounded-full bg-[#ececf1]" />
                  <div className="h-3 w-5/6 animate-pulse rounded-full bg-[#ececf1]" />
                  <div className="h-3 w-1/2 animate-pulse rounded-full bg-[#ececf1]" />
                </div>
              </div>
            )}

            {!hasResult && !loading && (
              <div className="rounded-3xl border border-dashed border-[#d6d6db] bg-white p-8 text-center text-[#6e6e73]">
                <h2 className="text-xl font-semibold text-[#1d1d1f]">Recipe will appear here</h2>
                <p className="mt-2 text-sm">Use a clear photo for faster, more accurate results.</p>
              </div>
            )}

            {hasResult && recipe && (
              <article className="overflow-hidden rounded-3xl border border-[#e4e4e7] bg-white shadow-[0_12px_30px_rgba(0,0,0,0.05)]">
                <div className="border-b border-[#efeff2] px-6 py-5 md:px-7">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8e8e93]">
                    Generated Recipe
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-[-0.015em] md:text-3xl">
                    {recipe.dishName}
                  </h2>
                  <p className="mt-2 text-sm text-[#515154]">{recipe.shortDescription}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <MetaChip label={recipe.cuisine} />
                    <MetaChip label={recipe.difficulty} />
                    <MetaChip label={`Serves ${recipe.servings}`} />
                    <MetaChip label={`Prep ${recipe.prepTime}`} />
                    <MetaChip label={`Cook ${recipe.cookTime}`} />
                    <MetaChip label={recipe.caloriesPerServing} />
                  </div>
                </div>

                <div className="grid gap-0 md:grid-cols-5">
                  <section className="border-b border-[#efeff2] px-6 py-5 md:col-span-2 md:border-b-0 md:border-r">
                    <h3 className="text-sm font-semibold text-[#1d1d1f]">Ingredients</h3>
                    <ul className="mt-3 space-y-2.5">
                      {recipe.ingredients.map((ing, idx) => (
                        <li key={`${ing.item}-${idx}`} className="text-sm">
                          <p className="font-medium text-[#1d1d1f]">{ing.item}</p>
                          <p className="text-[#6e6e73]">{ing.amount}</p>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="px-6 py-5 md:col-span-3">
                    <h3 className="text-sm font-semibold text-[#1d1d1f]">Method</h3>
                    <ol className="mt-3 space-y-3">
                      {recipe.instructions.map((step, idx) => (
                        <li key={`${step}-${idx}`} className="flex gap-3 text-sm">
                          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1d1d1f] text-[11px] font-semibold text-white">
                            {idx + 1}
                          </span>
                          <span className="text-[#3a3a3c]">{step}</span>
                        </li>
                      ))}
                    </ol>

                    {recipe.platingTips?.length > 0 && (
                      <div className="mt-5 rounded-2xl border border-[#efeff2] bg-[#fafafc] p-4">
                        <h4 className="text-sm font-semibold text-[#1d1d1f]">Plating Tips</h4>
                        <ul className="mt-2 space-y-1.5 text-sm text-[#515154]">
                          {recipe.platingTips.map((tip, idx) => (
                            <li key={`${tip}-${idx}`}>- {tip}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                </div>
              </article>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function ActionButton({
  onClick,
  label,
  primary = false,
}: {
  onClick: () => void;
  label: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? "rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#2c2c2e]"
          : "rounded-xl border border-[#d2d2d7] bg-white px-4 py-2.5 text-sm font-medium text-[#1d1d1f] transition hover:bg-[#f6f6f8]"
      }
    >
      {label}
    </button>
  );
}

function MetaChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-[#d2d2d7] bg-[#f7f7f8] px-2.5 py-1 text-xs font-medium text-[#3a3a3c]">
      {label}
    </span>
  );
}
