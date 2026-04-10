import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SERVER_IMAGE_BYTES = 2_000_000;
const TRANSIENT_RETRY_DELAYS_MS = [1200, 2600];

type RecipeApiResponse = {
  dishName: string;
  shortDescription: string;
  cuisine: string;
  difficulty: "Easy" | "Medium" | "Hard";
  servings: string;
  prepTime: string;
  cookTime: string;
  caloriesPerServing: string;
  ingredients: Array<{ item: string; amount: string }>;
  instructions: string[];
  platingTips: string[];
};

function parseModelJson(raw: string): RecipeApiResponse {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  const jsonString =
    firstBrace !== -1 && lastBrace !== -1
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned;

  let parsed: Partial<RecipeApiResponse>;
  try {
    parsed = JSON.parse(jsonString) as Partial<RecipeApiResponse>;
  } catch {
    parsed = {};
  }

  return {
    dishName: parsed.dishName || "Unknown Dish",
    shortDescription:
      parsed.shortDescription || "A flavorful dish generated from your photo.",
    cuisine: parsed.cuisine || "Fusion",
    difficulty: ["Easy", "Medium", "Hard"].includes(parsed.difficulty || "")
      ? (parsed.difficulty as "Easy" | "Medium" | "Hard")
      : "Medium",
    servings: parsed.servings || "2-3",
    prepTime: parsed.prepTime || "20 min",
    cookTime: parsed.cookTime || "30 min",
    caloriesPerServing: parsed.caloriesPerServing || "Approx. 450 kcal",
    ingredients: Array.isArray(parsed.ingredients)
      ? parsed.ingredients
          .filter((x) => x && typeof x === "object")
          .map((x) => ({
            item: (x.item as string) || "Ingredient",
            amount: (x.amount as string) || "To taste",
          }))
      : [],
    instructions: Array.isArray(parsed.instructions)
      ? parsed.instructions.map((x) => String(x)).filter(Boolean)
      : [
          "Review the dish photo and identify the main protein, vegetables, starches, and sauces.",
          "Prepare matching ingredients in balanced portions.",
          "Cook the main ingredients until tender and season gradually.",
          "Finish with herbs, acidity, or sauce to match the photographed dish.",
        ],
    platingTips: Array.isArray(parsed.platingTips)
      ? parsed.platingTips.map((x) => String(x)).filter(Boolean)
      : ["Plate neatly and keep the main ingredient visible."],
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProviderStatus(error: unknown) {
  if (typeof error === "object" && error && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    return Number.isFinite(status) ? status : null;
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\[(\d{3}) [^\]]+\]/);
  return match ? Number(match[1]) : null;
}

function getProviderMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function generateRecipeText({
  apiKey,
  prompt,
  imageBase64,
  mimeType,
}: {
  apiKey: string;
  prompt: string;
  imageBase64: string;
  mimeType: string;
}) {
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: unknown;

  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-3.1-flash-lite-preview",
        generationConfig: {
          responseMimeType: "application/json",
        },
      });
      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: imageBase64,
            mimeType,
          },
        },
      ]);
      return result.response.text();
    } catch (error) {
      lastError = error;
      const status = getProviderStatus(error);
      const shouldRetry = status === 503 && attempt < TRANSIENT_RETRY_DELAYS_MS.length;
      if (!shouldRetry) break;
      await sleep(TRANSIENT_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey =
      process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();

    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY (or GOOGLE_API_KEY)." },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No image uploaded." }, { status: 400 });
    }

    const mimeType = (file.type || "").toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: "Unsupported image type. Use JPG, PNG, or WebP." },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > MAX_SERVER_IMAGE_BYTES) {
      return NextResponse.json(
        {
          error:
            "Image is too large. Please retake the photo with better lighting or upload a smaller image.",
        },
        { status: 413 }
      );
    }
    const imageBase64 = Buffer.from(bytes).toString("base64");

    const prompt = [
      "You are an expert chef.",
      "Analyze the dish in the image and return concise professional recipe data.",
      "If the photo is unclear, infer the most likely dish and still return recipe data.",
      "Return ONLY valid JSON with this exact structure and no extra keys:",
      "{",
      '  "dishName": "string",',
      '  "shortDescription": "string (max 2 sentences)",',
      '  "cuisine": "string",',
      '  "difficulty": "Easy | Medium | Hard",',
      '  "servings": "string",',
      '  "prepTime": "string",',
      '  "cookTime": "string",',
      '  "caloriesPerServing": "string",',
      '  "ingredients": [',
      '    { "item": "string", "amount": "string" }',
      "  ],",
      '  "instructions": ["string (4-6 steps total)"],',
      '  "platingTips": ["string (max 2 tips)"]',
      "}",
      "Keep wording compact. No markdown. No explanation outside JSON.",
    ].join("\n");

    const text = await generateRecipeText({
      apiKey,
      prompt,
      imageBase64,
      mimeType,
    });
    const parsed = parseModelJson(text);
    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Analyze route error:", error);
    const status = getProviderStatus(error);
    const message = getProviderMessage(error);
    if (status === 429 || message.toLowerCase().includes("quota")) {
      return NextResponse.json(
        {
          error:
            "Gemini quota is currently exhausted for this API key. Wait a minute or update the Gemini billing/quota settings, then try again.",
        },
        { status: 429 }
      );
    }
    if (status === 503) {
      return NextResponse.json(
        {
          error:
            "Gemini is temporarily busy. Please wait a moment and try analyzing the photo again.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "Failed to analyze image and generate recipe." },
      { status: 500 }
    );
  }
}
