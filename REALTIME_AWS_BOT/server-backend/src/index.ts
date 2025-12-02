import express from "express";
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { getSpeechClient, createStreamingRecognizeRequest } from "./speech/googleSpeechClient";
import { ClientToServerMessage, ServerToClientMessage } from "./types/websocket";
import { runGeminiLiveTextTurn } from "./llm/geminiLiveText";
import { runGeminiTextThenAudio } from "./llm/geminiAudioFromText";

const PORT = process.env.PORT || 4000;
const app = express();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/audio" });

wss.on("connection", (ws: WebSocket) => {
  console.log("Client connected");

  const speechClient = getSpeechClient();
  let recognizeStream: any | null = null;

  const sendJSON = (msg: ServerToClientMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const startRecognitionStream = (sampleRate: number) => {
    if (recognizeStream) {
      recognizeStream.destroy();
      recognizeStream = null;
    }

    const request = createStreamingRecognizeRequest(sampleRate);

    recognizeStream = speechClient
      .streamingRecognize(request)
      .on("error", (err: any) => {
        console.error("Speech API error:", err);
        sendJSON({ type: "error", message: err.message || "Speech API error" });
      })

.on("data", async (data: any) => {
  const result = data.results?.[0];
  if (!result) return;

  const alt = result.alternatives?.[0];
  if (!alt) return;

  const transcript = alt.transcript as string;
  const isFinal = result.isFinal as boolean;

  const languageCodeFromResult =
    (alt as any).languageCode ||
    (result as any).languageCode ||
    undefined;

  // 1️⃣ Always send transcript to frontend
  sendJSON({
    type: "transcript",
    transcript,
    isFinal,
    languageCode: languageCodeFromResult,
  });

  // 2️⃣ If it's a final utterance, trigger Gemini
  if (isFinal && transcript.trim()) {
    try {
      const llmResult = await runGeminiTextThenAudio(
        transcript.trim(),
        languageCodeFromResult
      );

      // Send text answer so chat bubbles update
      sendJSON({
        type: "llmResponse",
        text: llmResult.text,
      });

      // If we got audio, send it too
      if (llmResult.audioBase64) {
        sendJSON({
          type: "llmResponseAudio",
          audioBase64: llmResult.audioBase64,
        });
      }
    } catch (err: any) {
      console.error("Error calling Gemini:", err);
      sendJSON({
        type: "error",
        message: "LLM error: " + (err?.message || "unknown error"),
      });
    }
  }
});


    sendJSON({ type: "info", message: "Recognition stream started" });
  };

  const stopRecognitionStream = () => {
    if (recognizeStream) {
      recognizeStream.end();
      recognizeStream = null;
      sendJSON({ type: "info", message: "Recognition stream stopped" });
    }
  };

  ws.on("message", (message: WebSocket.RawData, isBinary: boolean) => {
    if (!isBinary) {
      let data: ClientToServerMessage;
      try {
        data = JSON.parse(message.toString());
      } catch {
        sendJSON({ type: "error", message: "Invalid JSON message" });
        return;
      }

      if (data.type === "start") {
        startRecognitionStream(data.sampleRate);
      } else if (data.type === "stop") {
        stopRecognitionStream();
      } else if (data.type === "ping") {
        sendJSON({ type: "info", message: "pong" });
      }

      return;
    }

    // Binary = audio bytes
    if (!recognizeStream) return;

    recognizeStream.write(message);
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    stopRecognitionStream();
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err);
    stopRecognitionStream();
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint ws://localhost:${PORT}/ws/audio`);
});
