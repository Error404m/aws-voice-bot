export type ClientToServerMessage =
  | {
      type: "start";
      sampleRate: number;
      languageCode?: string;
      altLanguages?: string[];
    }
  | { type: "stop" }
  | { type: "ping" };

export type ServerToClientMessage =
  | { type: "transcript"; transcript: string; isFinal: boolean; languageCode?: string }
  | { type: "llmResponse"; text: string } // text answer
  | { type: "llmResponseAudio"; audioBase64: string } // NEW: audio answer (PCM 24kHz)
  | { type: "error"; message: string }
  | { type: "info"; message: string };
