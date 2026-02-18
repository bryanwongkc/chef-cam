import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

// Ensure API key is defined
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function POST(req: NextRequest) {
  try {
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
          mimeType: file.type,
        },
      },
    ]);

    const response = await result.response;
    let text = response.text();
    
    // Clean up markdown if Gemini adds it
    text = text.replace(/```json/g, "").replace(/```/g, "");

    return NextResponse.json(JSON.parse(text));
  } catch (error) {
    console.error("Gemini Error:", error);
    return NextResponse.json({ error: "Failed to analyze image" }, { status: 500 });
  }
}