// server/src/llm/geminiAudioFromText.ts
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!apiKey) {
  console.warn(
    "WARNING: GEMINI_API_KEY or GOOGLE_API_KEY is not set. Gemini calls will fail until you set one of them."
  );
}

// 1) Text reasoning model
const TEXT_MODEL = "gemini-2.5-flash";

// 2) TTS model (native text-to-speech)
const TTS_MODEL = "gemini-2.5-flash-preview-tts";

export type LlmAudioResult = {
  text: string;
  audioBase64?: string; // 24kHz 16-bit PCM, base64
};

const ai = new GoogleGenAI({
  apiKey,
});

/**
 * 1. Use TEXT_MODEL to generate the assistant's reply (text).
 * 2. Use TTS_MODEL to turn that text into audio (PCM base64).
 */
export async function runGeminiTextThenAudio(
  userText: string,
  languageHint?: string // currently only used in prompt wording
): Promise<LlmAudioResult> {
  if (!apiKey) {
    return {
      text:
        "LLM not configured: GEMINI_API_KEY or GOOGLE_API_KEY is missing on the server.",
    };
  }

  // 1️⃣ TEXT ANSWER
  const textResp = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: userText }],
      },
    ],
     config: {
    systemInstruction: `
You are “AWS Help Bot”, an expert assistant for Amazon Web Services (AWS).

Your ONLY job is to help with AWS-related questions:
- AWS core services (EC2, S3, RDS, Lambda, API Gateway, ECS/EKS, DynamoDB, CloudFront, Route 53, IAM, VPC, CloudWatch, CloudTrail, etc.)
- AWS architecture, best practices, security, networking, cost optimization, troubleshooting.
- AWS Console, AWS CLI, SDKs, and IaC tools like CloudFormation and CDK.

Behavior rules:
1. If the user asks something NOT related to AWS or cloud, briefly say you are focused only on AWS and gently redirect them back.
2. Always answer in the SAME LANGUAGE as the user.
3. Provide clear step-by-step instructions.
4. Always highlight AWS best practices (IAM least privilege, encryption, HA, cost optimization).
5. If unsure about limits/pricing/new features, say it may vary and advise checking AWS docs.

Tone: Friendly, calm, supportive. Act like a senior AWS cloud engineer.
`,
  },
  });

  const answerText = (textResp as any).text as string | undefined;
  const finalText = (answerText || "I couldn't generate a response.").trim();

  // 2️⃣ TTS: TEXT → AUDIO (24kHz PCM)
  // Use the official pattern:
  //   model: "gemini-2.5-flash-preview-tts"
  //   config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' }}}}
  const speakPrompt =
    finalText ||
    "Say: I could not generate a proper response, but I am still here.";

  const ttsResp = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [
      {
        parts: [
          {
            text: languageHint
              ? `Speak this in the same language (${languageHint}) as naturally as possible: ${speakPrompt}`
              : `Speak this naturally: ${speakPrompt}`,
          },
        ],
      },
    ],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            // Pick any supported voice; 'Kore' is a clear, firm voice from docs
            voiceName: "Kore",
          },
        },
      },
    },
  });

  const data =
    (ttsResp as any).candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

  const audioBase64 =
    typeof data === "string" && data.length > 0 ? data : undefined;

  return {
    text: finalText,
    audioBase64,
  };
}
