import { GoogleGenAI, Modality } from "@google/genai";

const apiKey = process.env.GOOGLE_API_KEY;

if (!apiKey) {
  console.warn(
    "WARNING: GOOGLE_API_KEY is not set. Gemini calls will fail until you set it."
  );
}

// Use Live-capable text model
// For Gemini Developer API (AI Studio) use a live model, e.g.:
const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-09-2025";

const ai = new GoogleGenAI({ apiKey });

/**
 * Run a single "turn" with the Live API using text in/out:
 * - input: userText
 * - output: combined text answer from the model
 */
export async function runGeminiLiveTextTurn(userText: string): Promise<string> {
  if (!apiKey) {
    return "LLM not configured: GOOGLE_API_KEY is missing on the server.";
  }

  const responseQueue: any[] = [];

  function pushMessage(message: any) {
    responseQueue.push(message);
  }

  async function waitMessage(): Promise<any> {
    while (true) {
      const msg = responseQueue.shift();
      if (msg) return msg;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function handleTurn(): Promise<any[]> {
    const turns: any[] = [];
    let done = false;
    while (!done) {
      const message = await waitMessage();
      turns.push(message);
      if (message.serverContent && message.serverContent.turnComplete) {
        done = true;
      }
    }
    return turns;
  }

  // Connect Live session
  const session = await ai.live.connect({
    model: LIVE_MODEL,
    config: {
      responseModalities: [Modality.TEXT],
      systemInstruction:
        "You are a helpful assistant for a voice chat app. Answer concisely and in the same language as the user.",
      // you can tune safety, temperature etc here
    },
    callbacks: {
      onopen() {
        console.debug("Gemini Live session opened");
      },
      onmessage(message) {
        pushMessage(message);
      },
      onerror(e) {
        console.error("Gemini Live error:", e);
      },
      onclose(e) {
        console.debug("Gemini Live session closed:", e.reason);
      },
    },
  });

  // Send the user text as a full turn
  session.sendClientContent({
    turns: [
      {
        role: "user",
        parts: [{ text: userText }],
      },
    ],
    turnComplete: true,
  });

  const turns = await handleTurn();

  // Collect text chunks from turns
  let finalText = "";
  for (const turn of turns) {
    if (turn.text) {
      finalText += turn.text;
    } else if (turn.serverContent && turn.serverContent.outputText) {
      // some message shapes may put text here
      finalText += turn.serverContent.outputText;
    }
  }

  await session.close();

  return finalText.trim() || "I couldn't generate a response.";
}
