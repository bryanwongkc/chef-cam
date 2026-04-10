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

type SavedRecipe = {
  id: string;
  name: string;
  createdAt: number;
  recipe: Recipe;
};

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEVICE_ID_KEY = "chefcam.deviceId.v1";

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
  const [activeTab, setActiveTab] = useState<"analyze" | "saved">("analyze");
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipe[]>([]);
  const [selectedSavedRecipeId, setSelectedSavedRecipeId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [savedLoading, setSavedLoading] = useState(false);

  const hasResult = useMemo(() => Boolean(recipe), [recipe]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  useEffect(() => {
    const id = getOrCreateDeviceId();
    setDeviceId(id);
    fetchSavedRecipes(id);
  }, []);

  function getOrCreateDeviceId() {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  }

  async function fetchSavedRecipes(id: string) {
    try {
      setSavedLoading(true);
      const response = await fetch(`/api/recipes?deviceId=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load saved recipes.");
      }
      const items = Array.isArray(payload?.items) ? (payload.items as SavedRecipe[]) : [];
      setSavedRecipes(items);
      setSelectedSavedRecipeId((prev) => prev ?? (items[0]?.id || null));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load saved recipes.");
    } finally {
      setSavedLoading(false);
    }
  }

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

  async function saveCurrentRecipe() {
    if (!recipe || !deviceId) return;
    try {
      const response = await fetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          name: recipe.dishName,
          recipe,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save recipe.");
      }
      await fetchSavedRecipes(deviceId);
      if (payload?.id) setSelectedSavedRecipeId(payload.id as string);
      setActiveTab("saved");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save recipe.");
    }
  }

  async function renameSavedRecipe(id: string) {
    if (!deviceId) return;
    const target = savedRecipes.find((x) => x.id === id);
    if (!target) return;
    const next = window.prompt("Rename recipe", target.name)?.trim();
    if (!next) return;
    try {
      const response = await fetch("/api/recipes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, deviceId, name: next }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to rename recipe.");
      }
      setSavedRecipes((prev) => prev.map((x) => (x.id === id ? { ...x, name: next } : x)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to rename recipe.");
    }
  }

  async function removeSavedRecipe(id: string) {
    if (!deviceId) return;
    const ok = window.confirm("Remove this saved recipe?");
    if (!ok) return;
    try {
      const response = await fetch(
        `/api/recipes?id=${encodeURIComponent(id)}&deviceId=${encodeURIComponent(deviceId)}`,
        { method: "DELETE" }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to remove recipe.");
      }
      const next = savedRecipes.filter((x) => x.id !== id);
      setSavedRecipes(next);
      setSelectedSavedRecipeId((prev) => {
        if (prev !== id) return prev;
        return next[0]?.id || null;
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove recipe.");
    }
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

  const selectedSavedRecipe = useMemo(() => {
    if (!selectedSavedRecipeId) return null;
    return savedRecipes.find((x) => x.id === selectedSavedRecipeId) || null;
  }, [savedRecipes, selectedSavedRecipeId]);

  return (
    <main className="min-h-screen bg-[#f8f8f6] text-[#181817]">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <section className="border-b border-[#dedbd2] pb-6 md:pb-8">
          <p className="text-xs font-semibold uppercase text-[#6b6760]">
            ChefCam
          </p>
          <h1 className="mt-3 text-3xl font-semibold md:text-5xl">
            Photo to Recipe
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5a5751] md:text-base">
            Minimal, fast, and camera-friendly. Capture a dish or upload an image to generate
            a structured recipe with Gemini 2.5 Flash.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <ActionButton onClick={openWebCamera} label="Open Camera" primary />
            <ActionButton
              onClick={() => cameraInputRef.current?.click()}
              label="Take Photo (System)"
            />
            <ActionButton onClick={() => uploadInputRef.current?.click()} label="Upload" />
          </div>

          <div className="mt-6 inline-flex rounded-lg border border-[#d8d5cc] bg-[#eeece6] p-1">
            <button
              type="button"
              onClick={() => setActiveTab("analyze")}
              className={
                activeTab === "analyze"
                  ? "rounded-md bg-white px-3 py-1.5 text-sm font-medium text-[#181817] shadow-sm"
                  : "rounded-md px-3 py-1.5 text-sm font-medium text-[#6b6760] transition hover:text-[#181817]"
              }
            >
              Analyze
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("saved")}
              className={
                activeTab === "saved"
                  ? "rounded-md bg-white px-3 py-1.5 text-sm font-medium text-[#181817] shadow-sm"
                  : "rounded-md px-3 py-1.5 text-sm font-medium text-[#6b6760] transition hover:text-[#181817]"
              }
            >
              Saved Recipes
            </button>
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
          <section className="mt-4 rounded-lg border border-[#e6b9b4] bg-[#fff7f5] px-4 py-3 text-sm text-[#9b2c20]">
            {error}
          </section>
        )}

        {activeTab === "analyze" && cameraOpen && (
          <section className="mt-5 rounded-lg border border-[#dedbd2] bg-white p-3">
            <video
              ref={videoRef}
              className="aspect-video w-full rounded-md bg-black object-cover"
              playsInline
              muted
            />
            <div className="mt-3 flex gap-2">
              <ActionButton onClick={captureFromWebCamera} label="Capture & Analyze" primary />
              <ActionButton onClick={stopCamera} label="Cancel" />
            </div>
          </section>
        )}

        {activeTab === "analyze" && (
          <section className="mt-6 grid gap-5 md:grid-cols-5">
          <div className="md:col-span-2">
            <div className="rounded-lg border border-[#dedbd2] bg-white p-3">
              <div className="aspect-[4/3] overflow-hidden rounded-md bg-[#eeece6]">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="Dish preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[#6b6760]">
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
                  <p className="text-center text-xs text-[#6b6760]">
                    {statusMessage} {elapsedSeconds > 0 ? `(${elapsedSeconds}s)` : ""}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="md:col-span-3">
            {loading && (
              <div className="rounded-lg border border-[#dedbd2] bg-white p-6">
                <p className="text-xs font-semibold uppercase text-[#777269]">
                  Processing
                </p>
                <h2 className="mt-2 text-2xl font-semibold">
                  Building your recipe...
                </h2>
                <p className="mt-2 text-sm text-[#6b6760]">
                  {statusMessage} {elapsedSeconds > 0 ? `(${elapsedSeconds}s)` : ""}
                </p>
                <div className="mt-4 space-y-2">
                  <div className="h-2 w-2/3 animate-pulse rounded-full bg-[#e6e1d8]" />
                  <div className="h-2 w-5/6 animate-pulse rounded-full bg-[#e6e1d8]" />
                  <div className="h-2 w-1/2 animate-pulse rounded-full bg-[#e6e1d8]" />
                </div>
              </div>
            )}

            {!hasResult && !loading && (
              <div className="rounded-lg border border-dashed border-[#d8d5cc] bg-white p-8 text-center text-[#6b6760]">
                <h2 className="text-xl font-semibold text-[#181817]">Recipe will appear here</h2>
                <p className="mt-2 text-sm">Use a clear photo for faster, more accurate results.</p>
              </div>
            )}

            {hasResult && recipe && (
              <article className="overflow-hidden rounded-lg border border-[#dedbd2] bg-white">
                <div className="border-b border-[#e9e5dc] px-6 py-5 md:px-7">
                  <p className="text-xs font-semibold uppercase text-[#777269]">
                    Generated Recipe
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold md:text-3xl">
                    {recipe.dishName}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[#5a5751]">{recipe.shortDescription}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <MetaChip label={recipe.cuisine} />
                    <MetaChip label={recipe.difficulty} />
                    <MetaChip label={`Serves ${recipe.servings}`} />
                    <MetaChip label={`Prep ${recipe.prepTime}`} />
                    <MetaChip label={`Cook ${recipe.cookTime}`} />
                    <MetaChip label={recipe.caloriesPerServing} />
                  </div>
                  <div className="mt-4">
                    <ActionButton onClick={saveCurrentRecipe} label="Save Recipe" />
                  </div>
                </div>

                <div className="grid gap-0 md:grid-cols-5">
                  <section className="border-b border-[#e9e5dc] px-6 py-5 md:col-span-2 md:border-b-0 md:border-r">
                    <h3 className="text-sm font-semibold text-[#181817]">Ingredients</h3>
                    <ul className="mt-3 space-y-2.5">
                      {recipe.ingredients.map((ing, idx) => (
                        <li key={`${ing.item}-${idx}`} className="text-sm">
                          <p className="font-medium text-[#181817]">{ing.item}</p>
                          <p className="text-[#6b6760]">{ing.amount}</p>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="px-6 py-5 md:col-span-3">
                    <h3 className="text-sm font-semibold text-[#181817]">Method</h3>
                    <ol className="mt-3 space-y-3">
                      {recipe.instructions.map((step, idx) => (
                        <li key={`${step}-${idx}`} className="flex gap-3 text-sm">
                          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#181817] text-[11px] font-semibold text-white">
                            {idx + 1}
                          </span>
                          <span className="leading-6 text-[#3b3832]">{step}</span>
                        </li>
                      ))}
                    </ol>

                    {recipe.platingTips?.length > 0 && (
                      <div className="mt-5 rounded-lg border border-[#e9e5dc] bg-[#fbfaf7] p-4">
                        <h4 className="text-sm font-semibold text-[#181817]">Plating Tips</h4>
                        <ul className="mt-2 space-y-1.5 text-sm leading-6 text-[#5a5751]">
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
        )}

        {activeTab === "saved" && (
          <section className="mt-6 grid gap-5 md:grid-cols-5">
            <div className="md:col-span-2">
              <div className="rounded-lg border border-[#dedbd2] bg-white p-3">
                <h2 className="px-2 pb-2 text-sm font-semibold text-[#181817]">
                  Saved Recipes
                </h2>
                {savedLoading && (
                  <p className="px-2 pb-2 text-xs text-[#6b6760]">Loading...</p>
                )}
                {savedRecipes.length === 0 && (
                  <p className="px-2 py-8 text-sm text-[#6b6760]">
                    No saved recipes yet.
                  </p>
                )}
                <div className="space-y-2">
                  {savedRecipes.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedSavedRecipeId(item.id)}
                      className={
                        selectedSavedRecipeId === item.id
                          ? "w-full rounded-md border border-[#d8d5cc] bg-[#f3f1eb] px-3 py-2 text-left"
                          : "w-full rounded-md border border-transparent px-3 py-2 text-left transition hover:bg-[#f3f1eb]"
                      }
                    >
                      <p className="text-sm font-medium text-[#181817]">{item.name}</p>
                      <p className="text-xs text-[#6b6760]">
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="md:col-span-3">
              {!selectedSavedRecipe && (
                <div className="rounded-lg border border-dashed border-[#d8d5cc] bg-white p-8 text-center text-[#6b6760]">
                  <h2 className="text-xl font-semibold text-[#181817]">
                    Select a saved recipe
                  </h2>
                  <p className="mt-2 text-sm">
                    Rename or remove recipes from your saved list.
                  </p>
                </div>
              )}

              {selectedSavedRecipe && (
                <article className="overflow-hidden rounded-lg border border-[#dedbd2] bg-white">
                  <div className="border-b border-[#e9e5dc] px-6 py-5 md:px-7">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase text-[#777269]">
                        Saved Recipe
                      </p>
                      <div className="flex gap-2">
                        <ActionButton
                          onClick={() => renameSavedRecipe(selectedSavedRecipe.id)}
                          label="Rename"
                        />
                        <ActionButton
                          onClick={() => removeSavedRecipe(selectedSavedRecipe.id)}
                          label="Remove"
                        />
                      </div>
                    </div>
                    <h2 className="mt-1 text-2xl font-semibold md:text-3xl">
                      {selectedSavedRecipe.name}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[#5a5751]">
                      {selectedSavedRecipe.recipe.shortDescription}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <MetaChip label={selectedSavedRecipe.recipe.cuisine} />
                      <MetaChip label={selectedSavedRecipe.recipe.difficulty} />
                      <MetaChip label={`Serves ${selectedSavedRecipe.recipe.servings}`} />
                      <MetaChip label={`Prep ${selectedSavedRecipe.recipe.prepTime}`} />
                      <MetaChip label={`Cook ${selectedSavedRecipe.recipe.cookTime}`} />
                      <MetaChip label={selectedSavedRecipe.recipe.caloriesPerServing} />
                    </div>
                  </div>

                  <div className="grid gap-0 md:grid-cols-5">
                    <section className="border-b border-[#e9e5dc] px-6 py-5 md:col-span-2 md:border-b-0 md:border-r">
                      <h3 className="text-sm font-semibold text-[#181817]">Ingredients</h3>
                      <ul className="mt-3 space-y-2.5">
                        {selectedSavedRecipe.recipe.ingredients.map((ing, idx) => (
                          <li key={`${ing.item}-${idx}`} className="text-sm">
                            <p className="font-medium text-[#181817]">{ing.item}</p>
                            <p className="text-[#6b6760]">{ing.amount}</p>
                          </li>
                        ))}
                      </ul>
                    </section>

                    <section className="px-6 py-5 md:col-span-3">
                      <h3 className="text-sm font-semibold text-[#181817]">Method</h3>
                      <ol className="mt-3 space-y-3">
                        {selectedSavedRecipe.recipe.instructions.map((step, idx) => (
                          <li key={`${step}-${idx}`} className="flex gap-3 text-sm">
                            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#181817] text-[11px] font-semibold text-white">
                              {idx + 1}
                            </span>
                            <span className="leading-6 text-[#3b3832]">{step}</span>
                          </li>
                        ))}
                      </ol>

                      {selectedSavedRecipe.recipe.platingTips?.length > 0 && (
                        <div className="mt-5 rounded-lg border border-[#e9e5dc] bg-[#fbfaf7] p-4">
                          <h4 className="text-sm font-semibold text-[#181817]">Plating Tips</h4>
                          <ul className="mt-2 space-y-1.5 text-sm leading-6 text-[#5a5751]">
                            {selectedSavedRecipe.recipe.platingTips.map((tip, idx) => (
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
        )}
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
          ? "rounded-lg bg-[#181817] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#2f2c26]"
          : "rounded-lg border border-[#d8d5cc] bg-white px-4 py-2.5 text-sm font-medium text-[#181817] transition hover:bg-[#f3f1eb]"
      }
    >
      {label}
    </button>
  );
}

function MetaChip({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-[#d8d5cc] bg-[#f3f1eb] px-2.5 py-1 text-xs font-medium text-[#3b3832]">
      {label}
    </span>
  );
}
