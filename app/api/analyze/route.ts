import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SERVER_IMAGE_BYTES = 1_500_000;

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

  const parsed = JSON.parse(jsonString) as Partial<RecipeApiResponse>;

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
      : [],
    platingTips: Array.isArray(parsed.platingTips)
      ? parsed.platingTips.map((x) => String(x)).filter(Boolean)
      : [],
  };
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
      "You are an expert chef and food stylist.",
      "Analyze the image and produce a professional recipe.",
      "Return ONLY valid JSON with this exact structure:",
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
      '  "instructions": ["string", "string"],',
      '  "platingTips": ["string", "string"]',
      "}",
      "No markdown. No explanation outside JSON.",
    ].join("\n");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: imageBase64,
          mimeType,
        },
      },
    ]);

    const text = result.response.text();
    const parsed = parseModelJson(text);
    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Analyze route error:", error);
    return NextResponse.json(
      { error: "Failed to analyze image and generate recipe." },
      { status: 500 }
    );
  }
}
