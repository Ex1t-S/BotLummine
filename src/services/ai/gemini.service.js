import { GoogleGenAI } from "@google/genai";

export async function runGeminiReply(prompt) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    if (!apiKey) {
      throw new Error("Falta GEMINI_API_KEY en el archivo .env");
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
    });

    return {
      provider: "gemini",
      model: modelName,
      text: response.text || "",
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata?.totalTokenCount || 0,
      },
      raw: response,
    };
  } catch (error) {
    console.error("--- ERROR EN GEMINI SERVICE ---");
    console.error("Mensaje:", error.message);
    throw error;
  }
}