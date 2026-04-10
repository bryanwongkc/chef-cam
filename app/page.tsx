"use client";

import { ChangeEvent, ReactNode, RefObject, useEffect, useRef, useState } from "react";

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

type WorkflowStep = "idle" | "camera" | "captured" | "analyzing" | "ready";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<WorkflowStep>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    return () => {
      stopCamera();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (step !== "analyzing") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [step]);

  async function openCamera() {
    try {
      setError(null);
      setRecipe(null);
      setStep("camera");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setStep(capturedFile ? "captured" : "idle");
      setError("Camera unavailable. Allow camera access or choose a photo from your device.");
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }

  async function capturePhoto() {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    const width = 1100;
    const ratio = video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 0.75;

    canvas.width = width;
    canvas.height = Math.round(width * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Could not capture the photo.");
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.72)
    );
    if (!blob) {
      setError("Could not process the photo.");
      return;
    }

    stopCamera();
    const file = new File([blob], `chef-cam-${Date.now()}.jpg`, { type: "image/jpeg" });
    setCapturedImage(file);
    await analyzeFile(file);
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setError(null);
      const prepared = await prepareImage(file);
      setCapturedImage(prepared);
      await analyzeFile(prepared);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not use that photo.");
    }
  }

  function setCapturedImage(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setCapturedFile(file);
    setRecipe(null);
    setElapsedSeconds(0);
    setStep("captured");
  }

  async function prepareImage(file: File): Promise<File> {
    if (!file.type.startsWith("image/")) {
      throw new Error("Choose a valid image file.");
    }
    if (!ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
      throw new Error("Use JPG, PNG, or WebP. HEIC/HEIF is not supported.");
    }

    const compressed = await compressImage(file);
    if (compressed.size > MAX_UPLOAD_BYTES) {
      throw new Error("Image is too large after compression. Try another photo.");
    }
    return compressed;
  }

  async function compressImage(file: File): Promise<File> {
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

        const maxSide = 1100;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Could not compress image."));
              return;
            }
            resolve(new File([blob], `chef-cam-${Date.now()}.jpg`, { type: "image/jpeg" }));
          },
          "image/jpeg",
          0.74
        );
      };

      image.onerror = () => {
        URL.revokeObjectURL(sourceUrl);
        reject(new Error("Unsupported image format. Use JPG, PNG, or WebP."));
      };
    });
  }

  async function analyzeFile(file: File) {
    setStep("analyzing");
    setElapsedSeconds(0);
    setStatusMessage("Uploading photo");
    setError(null);

    const timer = window.setTimeout(() => setStatusMessage("Creating recipe"), 600);
    try {
      const formData = new FormData();
      formData.append("image", file, file.name);

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || "Request failed. Try again.");
      }
      if (!payload) {
        throw new Error("No recipe data received.");
      }

      setRecipe(payload as Recipe);
      setStep("ready");
    } catch (err: unknown) {
      setStep("captured");
      setError(err instanceof Error ? err.message : "Failed to generate recipe.");
    } finally {
      window.clearTimeout(timer);
      setStatusMessage("");
    }
  }

  function retakePhoto() {
    setRecipe(null);
    setError(null);
    void openCamera();
  }

  function saveAsPdf() {
    if (!recipe) return;
    window.print();
  }

  function shareOnWhatsApp() {
    if (!recipe) return;
    const text = formatRecipeForSharing(recipe);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  const canAnalyzeAgain = Boolean(capturedFile) && step !== "analyzing";

  return (
    <main className="min-h-screen bg-white text-[#111111]">
      <div className="no-print mx-auto max-w-6xl px-3 py-3 sm:px-5 sm:py-5 lg:px-8">
        <header className="grid gap-4 border-b border-[#e6e6e6] pb-5 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-[#6b6b6b]">
              <span className="h-2 w-2 rounded-full bg-[#111111]" />
              ChefCam
            </div>
            <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-tight sm:text-4xl lg:text-5xl">
              Camera-first recipe generator.
            </h1>
          </div>
          <Progress step={step} />
        </header>

        <section className="grid gap-4 py-4 md:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] md:gap-5 md:py-5">
          <div className="space-y-3 md:space-y-5">
            <Studio
              step={step}
              videoRef={videoRef}
              previewUrl={previewUrl}
              elapsedSeconds={elapsedSeconds}
              statusMessage={statusMessage}
              onCapture={capturePhoto}
              onCancel={() => {
                stopCamera();
                setStep(capturedFile ? "captured" : "idle");
              }}
            />

            {error && <Notice>{error}</Notice>}

            <div className="sticky bottom-3 z-10 grid gap-3 rounded-lg border border-[#d8d8d8] bg-white p-3 shadow-[0_12px_32px_rgba(0,0,0,0.08)] sm:static sm:grid-cols-3 sm:shadow-none">
              <Button onClick={openCamera} primary disabled={step === "analyzing"}>
                Open Camera
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} disabled={step === "analyzing"}>
                Choose Photo
              </Button>
              <Button
                onClick={() => capturedFile && analyzeFile(capturedFile)}
                disabled={!canAnalyzeAgain}
              >
                Analyze Again
              </Button>
            </div>
          </div>

          <aside className="min-h-[360px] rounded-lg border border-[#e6e6e6] bg-white">
            {recipe ? (
              <RecipePanel
                recipe={recipe}
                onRetake={retakePhoto}
                onPdf={saveAsPdf}
                onWhatsApp={shareOnWhatsApp}
              />
            ) : (
              <WaitingPanel step={step} elapsedSeconds={elapsedSeconds} statusMessage={statusMessage} />
            )}
          </aside>
        </section>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileSelected}
      />

      {recipe && <PrintableRecipe recipe={recipe} />}
    </main>
  );
}

function Studio({
  step,
  videoRef,
  previewUrl,
  elapsedSeconds,
  statusMessage,
  onCapture,
  onCancel,
}: {
  step: WorkflowStep;
  videoRef: RefObject<HTMLVideoElement | null>;
  previewUrl: string | null;
  elapsedSeconds: number;
  statusMessage: string;
  onCapture: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#e6e6e6] bg-[#f6f6f6]">
      <div className="relative aspect-[3/4] bg-[#ededed] sm:aspect-[4/3] lg:aspect-[16/11]">
        {step === "camera" ? (
          <video ref={videoRef} className="h-full w-full bg-black object-cover" playsInline muted />
        ) : previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Captured dish" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div>
              <p className="text-sm font-semibold uppercase text-[#777777]">No photo</p>
              <p className="mt-2 max-w-xs text-sm leading-6 text-[#555555]">
                Open the camera and capture the dish in clear light.
              </p>
            </div>
          </div>
        )}

        {step === "analyzing" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#111111]/70 px-6 text-center text-white">
            <div>
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              <p className="mt-4 text-sm font-medium">
                {statusMessage || "Analyzing"} {elapsedSeconds > 0 ? `(${elapsedSeconds}s)` : ""}
              </p>
            </div>
          </div>
        )}
      </div>

      {step === "camera" && (
        <div className="grid gap-3 border-t border-[#e6e6e6] bg-white p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
          <p className="text-base font-medium text-[#333333] sm:text-sm sm:font-normal sm:text-[#555555]">
            Frame the dish, then capture.
          </p>
          <Button onClick={onCancel}>Cancel</Button>
          <Button onClick={onCapture} primary>
            Capture
          </Button>
        </div>
      )}
    </section>
  );
}

function RecipePanel({
  recipe,
  onRetake,
  onPdf,
  onWhatsApp,
}: {
  recipe: Recipe;
  onRetake: () => void;
  onPdf: () => void;
  onWhatsApp: () => void;
}) {
  return (
    <article className="flex h-full flex-col">
      <div className="border-b border-[#e6e6e6] p-5">
        <p className="text-xs font-medium uppercase text-[#777777]">Recipe</p>
        <h2 className="mt-2 text-2xl font-semibold leading-tight sm:text-3xl">{recipe.dishName}</h2>
        <p className="mt-2 text-sm leading-6 text-[#555555]">{recipe.shortDescription}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          <Tag>{recipe.cuisine}</Tag>
          <Tag>{recipe.difficulty}</Tag>
          <Tag>Serves {recipe.servings}</Tag>
          <Tag>{recipe.caloriesPerServing}</Tag>
        </div>
      </div>

      <div className="grid gap-0 md:flex-1">
        <RecipeSection title="Ingredients">
          <ul className="grid gap-3 sm:grid-cols-2 md:grid-cols-1">
            {recipe.ingredients.map((ingredient, index) => (
              <li key={`${ingredient.item}-${index}`} className="text-sm">
                <p className="font-medium">{ingredient.item}</p>
                <p className="text-[#666666]">{ingredient.amount}</p>
              </li>
            ))}
          </ul>
        </RecipeSection>

        <RecipeSection title="Method">
          <ol className="space-y-3">
            {recipe.instructions.map((instruction, index) => (
              <li key={`${instruction}-${index}`} className="grid grid-cols-[1.75rem_1fr] gap-3 text-sm leading-6">
                <span className="flex h-7 w-7 items-center justify-center rounded bg-[#111111] text-xs font-medium text-white">
                  {index + 1}
                </span>
                <span>{instruction}</span>
              </li>
            ))}
          </ol>

          {recipe.platingTips.length > 0 && (
            <div className="mt-5 border-t border-[#e6e6e6] pt-4">
              <p className="text-sm font-semibold">Plating</p>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-[#555555]">
                {recipe.platingTips.map((tip, index) => (
                  <li key={`${tip}-${index}`}>- {tip}</li>
                ))}
              </ul>
            </div>
          )}
        </RecipeSection>
      </div>

      <div className="sticky bottom-0 grid gap-3 border-t border-[#d8d8d8] bg-white p-4 sm:static sm:grid-cols-3">
        <Button onClick={onPdf}>Save PDF</Button>
        <Button onClick={onWhatsApp} primary>
          WhatsApp
        </Button>
        <Button onClick={onRetake}>Retake</Button>
      </div>
    </article>
  );
}

function WaitingPanel({
  step,
  elapsedSeconds,
  statusMessage,
}: {
  step: WorkflowStep;
  elapsedSeconds: number;
  statusMessage: string;
}) {
  const isAnalyzing = step === "analyzing";
  return (
    <div className="flex h-full min-h-[360px] items-center justify-center p-6 text-center">
      <div>
        <p className="text-xs font-medium uppercase text-[#777777]">
          {isAnalyzing ? "Working" : "Recipe output"}
        </p>
        <h2 className="mt-2 text-3xl font-semibold sm:text-2xl">
          {isAnalyzing ? "Building your recipe" : "Capture to begin"}
        </h2>
        <p className="mt-3 max-w-sm text-base leading-7 text-[#555555] sm:text-sm sm:leading-6">
          {isAnalyzing
            ? `${statusMessage || "Analyzing"} ${elapsedSeconds > 0 ? `(${elapsedSeconds}s)` : ""}`
            : "The generated recipe, ingredients, method, PDF export, and WhatsApp share controls will appear here."}
        </p>
      </div>
    </div>
  );
}

function Progress({ step }: { step: WorkflowStep }) {
  const stages = ["Capture", "Analyze", "Export"];
  const active = step === "ready" ? 2 : step === "analyzing" ? 1 : 0;

  return (
    <div className="grid grid-cols-3 gap-1.5 sm:min-w-80">
      {stages.map((stage, index) => (
        <div
          key={stage}
          className={
            index <= active
              ? "rounded-lg border border-[#111111] bg-[#111111] px-3 py-3 text-center text-sm font-medium text-white sm:py-2 sm:text-xs"
              : "rounded-lg border border-[#e0e0e0] bg-white px-3 py-3 text-center text-sm font-medium text-[#666666] sm:py-2 sm:text-xs"
          }
        >
          {stage}
        </div>
      ))}
    </div>
  );
}

function RecipeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-[#e6e6e6] p-5 last:border-b-0">
      <h3 className="mb-4 text-base font-semibold uppercase text-[#777777] sm:text-sm">{title}</h3>
      {children}
    </section>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-[#d0d0d0] bg-[#f3f3f3] px-4 py-4 text-base leading-7 text-[#333333] sm:py-3 sm:text-sm sm:leading-6">
      {children}
    </div>
  );
}

function PrintableRecipe({ recipe }: { recipe: Recipe }) {
  return (
    <section className="print-sheet hidden bg-white p-8 text-[#111111]">
      <p className="text-xs font-semibold uppercase">ChefCam Recipe</p>
      <h1 className="mt-3 text-3xl font-semibold">{recipe.dishName}</h1>
      <p className="mt-2 text-sm">{recipe.shortDescription}</p>

      <div className="mt-5 grid grid-cols-3 gap-2 text-xs">
        <p>Cuisine: {recipe.cuisine}</p>
        <p>Difficulty: {recipe.difficulty}</p>
        <p>Servings: {recipe.servings}</p>
        <p>Prep: {recipe.prepTime}</p>
        <p>Cook: {recipe.cookTime}</p>
        <p>{recipe.caloriesPerServing}</p>
      </div>

      <h2 className="mt-7 text-lg font-semibold">Ingredients</h2>
      <ul className="mt-3 space-y-1 text-sm">
        {recipe.ingredients.map((ingredient, index) => (
          <li key={`${ingredient.item}-print-${index}`}>
            {ingredient.amount} {ingredient.item}
          </li>
        ))}
      </ul>

      <h2 className="mt-7 text-lg font-semibold">Method</h2>
      <ol className="mt-3 space-y-2 text-sm">
        {recipe.instructions.map((instruction, index) => (
          <li key={`${instruction}-print-${index}`}>
            {index + 1}. {instruction}
          </li>
        ))}
      </ol>

      {recipe.platingTips.length > 0 && (
        <>
          <h2 className="mt-7 text-lg font-semibold">Plating Tips</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {recipe.platingTips.map((tip, index) => (
              <li key={`${tip}-print-${index}`}>- {tip}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? "min-h-14 w-full rounded-lg bg-[#111111] px-5 py-4 text-base font-semibold text-white transition hover:bg-[#303030] disabled:cursor-not-allowed disabled:bg-[#a6a6a6] sm:min-h-11 sm:px-4 sm:py-3 sm:text-sm sm:font-medium"
          : "min-h-14 w-full rounded-lg border border-[#cfcfcf] bg-white px-5 py-4 text-base font-semibold text-[#111111] transition hover:bg-[#f3f3f3] disabled:cursor-not-allowed disabled:text-[#a6a6a6] sm:min-h-11 sm:px-4 sm:py-3 sm:text-sm sm:font-medium"
      }
    >
      {children}
    </button>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-[#d6d6d6] bg-[#f5f5f5] px-2.5 py-1.5 text-xs font-medium text-[#333333]">
      {children}
    </span>
  );
}

function formatRecipeForSharing(recipe: Recipe) {
  const ingredients = recipe.ingredients
    .map((ingredient) => `- ${ingredient.amount} ${ingredient.item}`)
    .join("\n");
  const instructions = recipe.instructions
    .map((instruction, index) => `${index + 1}. ${instruction}`)
    .join("\n");
  const platingTips = recipe.platingTips.length
    ? `\n\nPlating tips:\n${recipe.platingTips.map((tip) => `- ${tip}`).join("\n")}`
    : "";

  return [
    `${recipe.dishName}`,
    recipe.shortDescription,
    "",
    `${recipe.cuisine} | ${recipe.difficulty} | Serves ${recipe.servings}`,
    `Prep ${recipe.prepTime} | Cook ${recipe.cookTime} | ${recipe.caloriesPerServing}`,
    "",
    "Ingredients:",
    ingredients,
    "",
    "Method:",
    instructions,
    platingTips,
  ].join("\n");
}
