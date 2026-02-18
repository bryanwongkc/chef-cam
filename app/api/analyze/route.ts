import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

// Ensure API key is defined
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
export const runtime = "nodejs";

function parseModelJson(rawText: string) {
  const cleaned = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("Model did not return valid JSON");
    }
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Server is missing GEMINI_API_KEY" },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("image") as File;

    if (!file) {
      return NextResponse.json({ error: "No image uploaded" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Using Gemini 2.5 Flash
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
      You are a Michelin-star chef. Analyze this food image.
      Return strictly a JSON object (no markdown formatting) with this structure:
      {
        "name": "Name of the dish",
        "calories": "Estimated calories per serving",
        "description": "A mouth-watering 1-sentence description.",
        "ingredients": ["Ingredient 1", "Ingredient 2", ...],
        "instructions": ["Step 1...", "Step 2..."]
      }
    `;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: buffer.toString("base64"),
          mimeType: file.type || "image/jpeg",
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();
    const parsed = parseModelJson(text);

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Gemini Error:", error);
    return NextResponse.json({ error: "Failed to analyze image" }, { status: 500 });
  }
}
