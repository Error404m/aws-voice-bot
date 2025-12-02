import { SpeechClient } from "@google-cloud/speech";

const speechClient = new SpeechClient();

/**
 * TIP:
 * - Use an Indian English code (en-IN) instead of en-US if you’re speaking Hinglish.
 * - Put the languages you speak MOST at the top / as primary.
 */
export const PRIMARY_LANGUAGE = "en-IN"; // or "hi-IN" if you are mostly Hindi
export const ALT_LANGUAGES = [
  "hi-IN", // Hindi
  "ta-IN", // Tamil
  "kn-IN", // Kannada
  "fr-FR", // French
];

export function createStreamingRecognizeRequest(sampleRateHertz: number) {
  return {
    config: {
      encoding: "LINEAR16" as const,
      sampleRateHertz,
      languageCode: PRIMARY_LANGUAGE,
      alternativeLanguageCodes: ALT_LANGUAGES,
      enableAutomaticPunctuation: true,
      // optional tweaks:
      // useEnhanced: true,
      // model: "default",
    },
    interimResults: true,
  };
}

export function getSpeechClient() {
  return speechClient;
}
