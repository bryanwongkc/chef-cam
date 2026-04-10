"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

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
    <main className="min-h-screen bg-[#f7f7f7] text-[#171717]">
      <div className="no-print mx-auto grid min-h-screen max-w-7xl gap-4 px-3 py-3 sm:px-4 sm:py-5 md:grid-cols-[0.85fr_1.15fr] md:gap-8 md:px-8 md:py-6 lg:px-10">
        <section className="flex flex-col justify-between rounded-lg border border-[#dedede] bg-white p-4 sm:p-5 md:p-7">
          <div>
            <p className="text-xs font-semibold uppercase text-[#666666]">ChefCam</p>
            <h1 className="mt-3 max-w-md text-3xl font-semibold leading-tight sm:text-4xl md:mt-4 md:text-5xl">
              Capture a dish. Get a recipe.
            </h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-[#555555] md:mt-4">
              Open the camera, take one clear photo, and Gemini will turn it into a practical recipe.
            </p>
          </div>

          <div className="mt-6 space-y-4 md:mt-8">
            <WorkflowStatus step={step} />
            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <Button onClick={openCamera} primary disabled={step === "analyzing"}>
                Open Camera
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} disabled={step === "analyzing"}>
                Choose Photo
              </Button>
              {canAnalyzeAgain && (
                <Button onClick={() => capturedFile && analyzeFile(capturedFile)}>
                  Analyze Again
                </Button>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-4 md:space-y-5">
          {error && (
            <div className="rounded-lg border border-[#cfcfcf] bg-[#f2f2f2] px-4 py-3 text-sm text-[#333333]">
              {error}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-[#dedede] bg-white">
            {step === "camera" ? (
              <CameraPanel
                videoRef={videoRef}
                onCapture={capturePhoto}
                onCancel={() => {
                  stopCamera();
                  setStep(capturedFile ? "captured" : "idle");
                }}
              />
            ) : (
              <PreviewPanel
                previewUrl={previewUrl}
                step={step}
                elapsedSeconds={elapsedSeconds}
                statusMessage={statusMessage}
              />
            )}
          </div>

          {recipe ? (
            <RecipeCard
              recipe={recipe}
              onRetake={retakePhoto}
              onPdf={saveAsPdf}
              onWhatsApp={shareOnWhatsApp}
            />
          ) : (
            <EmptyRecipeState step={step} elapsedSeconds={elapsedSeconds} statusMessage={statusMessage} />
          )}
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

function CameraPanel({
  videoRef,
  onCapture,
  onCancel,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onCapture: () => void;
  onCancel: () => void;
}) {
  return (
    <div>
      <video ref={videoRef} className="aspect-video w-full bg-black object-cover" playsInline muted />
      <div className="grid gap-3 border-t border-[#e5e5e5] p-3 sm:flex sm:items-center sm:justify-between sm:p-4">
        <p className="text-sm text-[#555555]">Frame the dish clearly, then capture.</p>
        <div className="grid gap-2 sm:flex">
          <Button onClick={onCancel}>Cancel</Button>
          <Button onClick={onCapture} primary>
            Capture
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreviewPanel({
  previewUrl,
  step,
  elapsedSeconds,
  statusMessage,
}: {
  previewUrl: string | null;
  step: WorkflowStep;
  elapsedSeconds: number;
  statusMessage: string;
}) {
  return (
    <div className="relative aspect-[4/3] bg-[#eeeeee]">
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="Captured dish" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center px-5 text-center sm:px-8">
          <div>
            <p className="text-base font-semibold text-[#171717] sm:text-lg">No photo yet</p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[#666666]">
              Start with the camera. A clear overhead or angled photo works best.
            </p>
          </div>
        </div>
      )}

      {step === "analyzing" && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#171717]/65 px-6 text-center text-white">
          <div>
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            <p className="mt-4 text-sm font-medium">
              {statusMessage || "Analyzing"} {elapsedSeconds > 0 ? `(${elapsedSeconds}s)` : ""}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyRecipeState({
  step,
  elapsedSeconds,
  statusMessage,
}: {
  step: WorkflowStep;
  elapsedSeconds: number;
  statusMessage: string;
}) {
  const message =
    step === "analyzing"
      ? `${statusMessage || "Analyzing"} ${elapsedSeconds > 0 ? `(${elapsedSeconds}s)` : ""}`
      : "Your generated recipe will appear here after capture.";

  return (
    <section className="rounded-lg border border-dashed border-[#d6d6d6] bg-white p-5 text-center sm:p-8">
      <p className="text-base font-semibold text-[#171717] sm:text-lg">
        {step === "analyzing" ? "Recipe in progress" : "Ready when you are"}
      </p>
      <p className="mt-2 text-sm text-[#666666]">{message}</p>
    </section>
  );
}

function RecipeCard({
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
    <article className="rounded-lg border border-[#dedede] bg-white">
      <div className="border-b border-[#e5e5e5] p-4 sm:p-5 md:p-6">
        <div className="grid gap-4 lg:flex lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-[#777777]">Generated Recipe</p>
            <h2 className="mt-2 text-2xl font-semibold leading-tight sm:text-3xl">
              {recipe.dishName}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#555555]">
              {recipe.shortDescription}
            </p>
          </div>
          <div className="grid gap-2 sm:flex sm:flex-wrap lg:justify-end">
            <Button onClick={onPdf}>Save as PDF</Button>
            <Button onClick={onWhatsApp} primary>
              Share WhatsApp
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5 sm:mt-5 sm:gap-2">
          <Meta label={recipe.cuisine} />
          <Meta label={recipe.difficulty} />
          <Meta label={`Serves ${recipe.servings}`} />
          <Meta label={`Prep ${recipe.prepTime}`} />
          <Meta label={`Cook ${recipe.cookTime}`} />
          <Meta label={recipe.caloriesPerServing} />
        </div>
      </div>

      <div className="grid md:grid-cols-[0.8fr_1.2fr]">
        <section className="border-b border-[#e5e5e5] p-4 sm:p-5 md:border-b-0 md:border-r md:p-6">
          <h3 className="text-sm font-semibold">Ingredients</h3>
          <ul className="mt-3 grid gap-3 sm:mt-4 sm:grid-cols-2 md:block md:space-y-3">
            {recipe.ingredients.map((ingredient, index) => (
              <li key={`${ingredient.item}-${index}`} className="text-sm">
                <p className="font-medium">{ingredient.item}</p>
                <p className="text-[#666666]">{ingredient.amount}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="p-4 sm:p-5 md:p-6">
          <h3 className="text-sm font-semibold">Method</h3>
          <ol className="mt-3 space-y-3 sm:mt-4 sm:space-y-4">
            {recipe.instructions.map((instruction, index) => (
              <li key={`${instruction}-${index}`} className="flex gap-3 text-sm leading-6">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#171717] text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <span>{instruction}</span>
              </li>
            ))}
          </ol>

          {recipe.platingTips.length > 0 && (
            <div className="mt-5 rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-3 sm:mt-6 sm:p-4">
              <h4 className="text-sm font-semibold">Plating Tips</h4>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-[#555555]">
                {recipe.platingTips.map((tip, index) => (
                  <li key={`${tip}-${index}`}>- {tip}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 grid sm:mt-6 sm:block">
            <Button onClick={onRetake}>Retake Photo</Button>
          </div>
        </section>
      </div>
    </article>
  );
}

function PrintableRecipe({ recipe }: { recipe: Recipe }) {
  return (
    <section className="print-sheet hidden bg-white p-8 text-[#171717]">
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

function WorkflowStatus({ step }: { step: WorkflowStep }) {
  const items = [
    { id: "camera", label: "Open camera" },
    { id: "analyzing", label: "Analyze" },
    { id: "ready", label: "Export" },
  ];
  const activeIndex =
    step === "idle" || step === "camera" || step === "captured"
      ? 0
      : step === "analyzing"
        ? 1
        : 2;

  return (
    <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
      {items.map((item, index) => (
        <div
          key={item.id}
          className={
            index <= activeIndex
              ? "rounded-lg border border-[#171717] bg-[#171717] px-2 py-2 text-center text-[11px] font-medium text-white sm:px-3 sm:text-xs"
              : "rounded-lg border border-[#dedede] bg-[#f7f7f7] px-2 py-2 text-center text-[11px] font-medium text-[#666666] sm:px-3 sm:text-xs"
          }
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}

function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
}: {
  children: React.ReactNode;
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
          ? "w-full rounded-lg bg-[#171717] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#303030] disabled:cursor-not-allowed disabled:bg-[#a6a6a6] sm:w-auto sm:py-2.5"
          : "w-full rounded-lg border border-[#d6d6d6] bg-white px-4 py-3 text-sm font-medium text-[#171717] transition hover:bg-[#f2f2f2] disabled:cursor-not-allowed disabled:text-[#a6a6a6] sm:w-auto sm:py-2.5"
      }
    >
      {children}
    </button>
  );
}

function Meta({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-[#d6d6d6] bg-[#f2f2f2] px-2 py-1 text-[11px] font-medium text-[#333333] sm:px-2.5 sm:text-xs">
      {label}
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
