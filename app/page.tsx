"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";

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

const MAX_UPLOAD_BYTES = 1_500_000;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export default function Home() {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const hasResult = useMemo(() => Boolean(recipe), [recipe]);

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

        const MAX_SIDE = fromCamera ? 960 : 1280;
        let width = image.width;
        let height = image.height;
        const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(image, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Could not compress image."));
              return;
            }
            const finalFile = new File([blob], `dish-${Date.now()}.jpg`, {
              type: "image/jpeg",
            });
            resolve(finalFile);
          },
          "image/jpeg",
          fromCamera ? 0.68 : 0.8
        );
      };

      image.onerror = () => {
        URL.revokeObjectURL(sourceUrl);
        reject(new Error("Unsupported image format. Use JPG, PNG, or WebP."));
      };
    });
  }

  async function analyzeImage(file: File, fromCamera: boolean) {
    setLoading(true);
    setError(null);
    setRecipe(null);

    try {
      if (!file.type.startsWith("image/")) {
        throw new Error("Please choose a valid image file.");
      }

      if (!ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
        throw new Error("Use JPG, PNG, or WebP. HEIC/HEIF is not supported.");
      }

      const compressed = await compressImage(file, fromCamera);
      if (compressed.size > MAX_UPLOAD_BYTES) {
        throw new Error("Image is too large after compression. Try another photo.");
      }

      const nextPreview = URL.createObjectURL(compressed);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(nextPreview);

      const formData = new FormData();
      formData.append("image", compressed, compressed.name);

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Request failed. Please try again.");
      }
      if (!payload) {
        throw new Error("No recipe data received.");
      }

      setRecipe(payload as Recipe);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to generate recipe.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function onFileSelected(
    event: ChangeEvent<HTMLInputElement>,
    fromCamera: boolean
  ) {
    const file = event.target.files?.[0];
    if (!file) return;
    await analyzeImage(file, fromCamera);
    event.target.value = "";
  }

  return (
    <main className="min-h-screen bg-[#f6f2ea] text-[#19140f]">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 md:px-8 md:py-12">
        <header className="relative overflow-hidden rounded-3xl border border-[#e7dccb] bg-gradient-to-br from-[#fff7ea] via-[#ffe9cc] to-[#f9d9b0] p-6 shadow-[0_20px_60px_rgba(91,56,24,0.12)] md:p-10">
          <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-[#fff1dc] blur-2xl" />
          <div className="pointer-events-none absolute -bottom-8 left-10 h-28 w-28 rounded-full bg-[#ffd5a5] blur-xl" />
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#8e5d2f]">
            ChefCam
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight md:text-5xl">
            Turn any dish photo into a restaurant-style recipe with Gemini 2.5
            Flash.
          </h1>
          <p className="mt-4 max-w-2xl text-sm text-[#67482c] md:text-base">
            Capture from your phone camera or upload an image. We detect the
            dish and generate a structured ingredient list with professional
            cooking instructions.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="rounded-xl bg-[#21160f] px-5 py-3 text-sm font-semibold text-[#fff6eb] transition hover:bg-[#322115]"
            >
              Take Photo
            </button>
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              className="rounded-xl border border-[#5a3b1e] bg-transparent px-5 py-3 text-sm font-semibold text-[#4c321a] transition hover:bg-[#fff1de]"
            >
              Upload Image
            </button>
          </div>
        </header>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
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
          <section className="mt-6 rounded-2xl border border-[#f2b5aa] bg-[#fff2ef] p-4 text-sm text-[#812719]">
            {error}
          </section>
        )}

        <section className="mt-7 grid gap-6 md:grid-cols-5">
          <div className="md:col-span-2">
            <div className="overflow-hidden rounded-3xl border border-[#e5dac9] bg-white shadow-sm">
              <div className="aspect-[4/3] w-full bg-[#efe5d8]">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="Uploaded dish"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[#6e5136]">
                    Add a dish photo to generate recipe details.
                  </div>
                )}
              </div>

              <div className="border-t border-[#f0e8dd] p-4">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-full rounded-xl border border-[#d8c7b1] bg-[#fffaf2] px-4 py-2.5 text-sm font-medium text-[#5f4125] transition hover:bg-[#fff0da]"
                >
                  Replace Photo
                </button>
                {loading && (
                  <p className="mt-3 text-center text-sm font-medium text-[#8f6238]">
                    Analyzing image and building recipe...
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="md:col-span-3">
            {!hasResult && !loading && (
              <div className="rounded-3xl border border-dashed border-[#c8b196] bg-[#fffbf5] p-8 text-center text-[#6a4b2f]">
                <h2 className="text-xl font-semibold">Recipe will appear here</h2>
                <p className="mt-2 text-sm">
                  Use a clear top-down or angled food photo for the best output.
                </p>
              </div>
            )}

            {hasResult && recipe && (
              <article className="overflow-hidden rounded-3xl border border-[#ddcfba] bg-white shadow-[0_16px_48px_rgba(65,39,18,0.1)]">
                <div className="bg-gradient-to-r from-[#2a1e13] to-[#54341e] p-6 text-[#fdf4e8]">
                  <p className="text-xs uppercase tracking-[0.2em] text-[#eccb9f]">
                    Generated Recipe
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold md:text-3xl">
                    {recipe.dishName}
                  </h2>
                  <p className="mt-3 text-sm text-[#f0dfc8]">
                    {recipe.shortDescription}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <MetaPill label={`Cuisine: ${recipe.cuisine}`} />
                    <MetaPill label={`Difficulty: ${recipe.difficulty}`} />
                    <MetaPill label={`Serves: ${recipe.servings}`} />
                    <MetaPill label={`Prep: ${recipe.prepTime}`} />
                    <MetaPill label={`Cook: ${recipe.cookTime}`} />
                    <MetaPill label={`Calories: ${recipe.caloriesPerServing}`} />
                  </div>
                </div>

                <div className="grid gap-0 md:grid-cols-5">
                  <section className="border-b border-[#efe7dc] bg-[#fffaf2] p-6 md:col-span-2 md:border-b-0 md:border-r">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7f5a38]">
                      Ingredients
                    </h3>
                    <ul className="mt-4 space-y-3">
                      {recipe.ingredients.map((ing, idx) => (
                        <li key={`${ing.item}-${idx}`} className="text-sm">
                          <p className="font-medium text-[#2a1d12]">{ing.item}</p>
                          <p className="text-[#6f5237]">{ing.amount}</p>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="p-6 md:col-span-3">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7f5a38]">
                      Method
                    </h3>
                    <ol className="mt-4 space-y-4">
                      {recipe.instructions.map((step, idx) => (
                        <li key={`${step}-${idx}`} className="flex gap-3 text-sm">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2e2013] text-xs font-semibold text-[#ffead2]">
                            {idx + 1}
                          </span>
                          <span className="leading-relaxed text-[#2b1f15]">{step}</span>
                        </li>
                      ))}
                    </ol>

                    {recipe.platingTips?.length > 0 && (
                      <div className="mt-7 rounded-2xl border border-[#ebddca] bg-[#fff8ee] p-4">
                        <h4 className="text-sm font-semibold text-[#5c3f22]">
                          Plating Tips
                        </h4>
                        <ul className="mt-2 space-y-1 text-sm text-[#6e5034]">
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

function MetaPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-[#8f6640] bg-[#6d4828] px-2.5 py-1 text-[#fde8cf]">
      {label}
    </span>
  );
}
