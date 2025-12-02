import React, { useEffect, useRef, useState } from "react";

type TranscriptMessage = {
  type: "transcript";
  transcript: string;
  isFinal: boolean;
  languageCode?: string;
};

type InfoMessage = {
  type: "info";
  message: string;
};

type ErrorMessage = {
  type: "error";
  message: string;
};

type LlmResponseMessage = {
  type: "llmResponse";
  text: string;
};

type LlmResponseAudioMessage = {
  type: "llmResponseAudio";
  audioBase64: string; // raw 16-bit PCM, 24kHz, base64-encoded
};

type ServerMessage =
  | TranscriptMessage
  | InfoMessage
  | ErrorMessage
  | LlmResponseMessage
  | LlmResponseAudioMessage;

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: "pending" | "done";
};

const WS_URL = "ws://localhost:4000/ws/audio";

const VoiceStreamer: React.FC = () => {
  const [isListening, setIsListening] = useState(false);
  const [wsStatus, setWsStatus] = useState<"idle" | "connecting" | "open" | "error">(
    "idle"
  );
  const [statusText, setStatusText] = useState<string>("Backend: idle");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [lastLangCode, setLastLangCode] = useState<string | undefined>(undefined);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null); // input capture
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const msgIdRef = useRef<number>(0);

  // Separate audio context for output (bot voice)
  const audioContextOutRef = useRef<AudioContext | null>(null);

  const LANGUAGE_OPTIONS = [
    { code: "auto", label: "Auto (Hi/En/Ta/Kn/Fr)" },
    { code: "en-IN", label: "English (India)" },
    { code: "hi-IN", label: "Hindi" },
    { code: "ta-IN", label: "Tamil" },
    { code: "kn-IN", label: "Kannada" },
    { code: "fr-FR", label: "French" },
  ];

  const [selectedLang, setSelectedLang] = useState<string>("auto");

  const nextId = () => {
    msgIdRef.current += 1;
    return msgIdRef.current.toString();
  };

  // Ensure output audio context (for bot audio)
  const ensureOutputAudioContext = () => {
    if (!audioContextOutRef.current) {
      audioContextOutRef.current = new AudioContext({ sampleRate: 24000 });
    }
    return audioContextOutRef.current;
  };

  // Play raw 16-bit PCM (24kHz mono) from base64 string
  const playPcm24kFromBase64 = async (base64: string) => {
    try {
      const audioCtx = ensureOutputAudioContext();

      const binary = atob(base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const buffer = new ArrayBuffer(bytes.byteLength);
      const view = new DataView(buffer);
      for (let i = 0; i < bytes.byteLength; i++) {
        view.setUint8(i, bytes[i]);
      }

      const sampleCount = buffer.byteLength / 2; // 16-bit = 2 bytes
      const audioBuffer = audioCtx.createBuffer(1, sampleCount, 24000);
      const channelData = audioBuffer.getChannelData(0);

      for (let i = 0; i < sampleCount; i++) {
        const sample = view.getInt16(i * 2, true); // little-endian
        channelData[i] = sample / 32768;
      }

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      source.start();
    } catch (err) {
      console.error("Error playing audio:", err);
    }
  };

  // 🔌 Connect WebSocket lazily when starting listening
  const connectWebSocket = (): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      console.log("Connecting WebSocket to:", WS_URL);
      setWsStatus("connecting");
      setStatusText("Connecting to backend WebSocket...");

      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log("WebSocket opened");
        wsRef.current = ws;
        setWsStatus("open");
        setStatusText("Backend connected. Ready to listen.");
        resolve(ws);
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        setWsStatus("error");
        setStatusText("WebSocket error. Check backend server.");
        reject(err);
      };

      ws.onclose = () => {
        console.log("WebSocket closed");
        wsRef.current = null;
        if (!isListening) {
          setWsStatus("idle");
          setStatusText("Backend disconnected.");
        }
      };

      ws.onmessage = (event) => {
        console.log("WS message:", event.data);
        try {
          const data: ServerMessage = JSON.parse(event.data.toString());

          if (data.type === "info") {
            setStatusText(`Info: ${data.message}`);
          } else if (data.type === "error") {
            console.error("Server error:", data.message);
            setStatusText(`Error: ${data.message}`);
          } else if (data.type === "transcript") {
            handleTranscriptMessage(data);
          } else if (data.type === "llmResponse") {
            applyLlmResponse(data.text);
          } else if (data.type === "llmResponseAudio") {
            // 🔊 play bot audio
            playPcm24kFromBase64(data.audioBase64);
          }
        } catch (e) {
          console.error("Invalid message from server", e);
        }
      };
    });
  };

  // 🎙️ Handle partial & final transcripts → convert to chat messages
  const handleTranscriptMessage = (data: TranscriptMessage) => {
    if (data.languageCode) {
      setLastLangCode(data.languageCode);
    }

    if (!data.isFinal) {
      setInterimTranscript(data.transcript);
      return;
    }

    const finalText = data.transcript.trim();
    setInterimTranscript("");

    if (!finalText) return;

    // 1️⃣ Add user message
    const userMsg: ChatMessage = {
      id: nextId(),
      role: "user",
      text: finalText,
      status: "done",
    };

    // 2️⃣ Add assistant placeholder message ("Processing…")
    const botMsg: ChatMessage = {
      id: nextId(),
      role: "assistant",
      text: "Processing…",
      status: "pending", // will be replaced when llmResponse arrives
    };

    setMessages((prev) => [...prev, userMsg, botMsg]);
  };

  // 🧠 Apply LLM response to latest pending assistant message
  const applyLlmResponse = (text: string) => {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        const msg = next[i];
        if (msg.role === "assistant" && msg.status === "pending") {
          next[i] = {
            ...msg,
            text,
            status: "done",
          };
          return next;
        }
      }
      // If no pending assistant found, just append as a new assistant message
      return [
        ...next,
        {
          id: nextId(),
          role: "assistant",
          text,
          status: "done",
        },
      ];
    });
  };

  const startListening = async () => {
    if (isListening) return;

    try {
      // Ensure WebSocket is connected
      let ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        ws = await connectWebSocket();
      }

      if (ws.readyState !== WebSocket.OPEN) {
        alert("WebSocket is not open even after connect. Check backend.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0); // Float32 [-1,1]
        const pcm16 = float32ToInt16(inputData);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(pcm16.buffer); // send raw bytes
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      mediaStreamRef.current = stream;
      processorRef.current = processor;

      // Decide primary + alternate languages for this session
      let languageCode: string | undefined;
      let altLanguages: string[] | undefined;

      if (selectedLang === "auto") {
        languageCode = "en-IN";
        altLanguages = ["hi-IN", "ta-IN", "kn-IN", "fr-FR"];
      } else if (selectedLang === "hi-IN") {
        languageCode = "hi-IN";
        altLanguages = ["en-IN"];
      } else if (selectedLang === "ta-IN") {
        languageCode = "ta-IN";
        altLanguages = ["en-IN"];
      } else if (selectedLang === "kn-IN") {
        languageCode = "kn-IN";
        altLanguages = ["en-IN"];
      } else if (selectedLang === "fr-FR") {
        languageCode = "fr-FR";
        altLanguages = ["en-IN"];
      } else {
        languageCode = "en-IN";
        altLanguages = ["hi-IN", "ta-IN", "kn-IN", "fr-FR"];
      }

      // Tell backend to start STT
      ws.send(
        JSON.stringify({
          type: "start",
          sampleRate: audioContext.sampleRate,
          languageCode,
          altLanguages,
        })
      );

      setIsListening(true);
      setStatusText("Listening... Speak your prompt.");
    } catch (err) {
      console.error("Error in startListening:", err);
      setStatusText("Failed to start listening (mic or WS issue).");
    }
  };

  const stopListening = () => {
    if (!isListening) return;

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    setIsListening(false);
    setStatusText("Stopped listening.");
    setInterimTranscript("");
  };

  useEffect(() => {
    return () => {
      // cleanup on unmount
      stopListening();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (audioContextOutRef.current) {
        audioContextOutRef.current.close();
        audioContextOutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wsLabel =
    wsStatus === "idle"
      ? "WS: idle"
      : wsStatus === "connecting"
      ? "WS: connecting..."
      : wsStatus === "open"
      ? "WS: connected"
      : "WS: error";

  return (
    <div style={styles.wrapper}>
      {/* Header / Controls */}
      <div style={styles.headerRow}>
        <div style={styles.headerLeft}>
          <div style={styles.botAvatar}>🤖</div>
          <div>
            <div style={styles.botName}>AI Voice Bot</div>
            <div style={styles.botSubtitle}>{statusText}</div>
          </div>
        </div>

        <div style={styles.headerRight}>
          <select
            value={selectedLang}
            onChange={(e) => setSelectedLang(e.target.value)}
            style={styles.select}
            disabled={isListening}
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>

          {lastLangCode && (
            <span style={styles.langTag}>Detected: {lastLangCode}</span>
          )}

          <span style={styles.wsBadge}>{wsLabel}</span>
        </div>
      </div>

      {/* Chat Area */}
      <div style={styles.chatContainer}>
        <div style={styles.chatInner}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                ...styles.messageRow,
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              {msg.role === "assistant" && (
                <div style={styles.smallAvatar}>🤖</div>
              )}

              <div
                style={{
                  ...styles.bubble,
                  ...(msg.role === "user"
                    ? styles.userBubble
                    : styles.botBubble),
                }}
              >
                <div style={styles.bubbleText}>{msg.text}</div>
                {msg.status === "pending" && (
                  <div style={styles.bubbleStatus}>Processing…</div>
                )}
              </div>

              {msg.role === "user" && (
                <div style={styles.smallAvatarUser}>🧑</div>
              )}
            </div>
          ))}

          {/* Live interim transcript as “typing” bubble */}
          {interimTranscript && (
            <div style={{ ...styles.messageRow, justifyContent: "flex-end" }}>
              <div style={styles.smallAvatarUser}>🧑</div>
              <div style={{ ...styles.bubble, ...styles.userBubble, opacity: 0.8 }}>
                <div style={styles.bubbleText}>{interimTranscript}</div>
                <div style={styles.bubbleStatus}>Listening…</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mic Controls */}
      <div style={styles.micBar}>
        <div style={styles.micHint}>
          {isListening ? "Listening… tap to stop." : "Tap and speak your prompt." } Designed By Mrityunjaya Tiwari
        </div>
        <button
          onClick={isListening ? stopListening : startListening}
          style={{
            ...styles.micButton,
            background: isListening
              ? "radial-gradient(circle at 30% 30%, #fecaca, #b91c1c)"
              : "radial-gradient(circle at 30% 30%, #a7f3d0, #059669)",
          }}
        >
          {isListening ? "⏹" : "🎙️"}
        </button>
      </div>
    </div>
  );
};

// Float32 [-1,1] → Int16 PCM
function float32ToInt16(float32: Float32Array): Int16Array {
  const len = float32.length;
  const int16 = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

const styles: { [key: string]: React.CSSProperties } = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    height: "520px",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  botAvatar: {
    width: "40px",
    height: "40px",
    borderRadius: "999px",
    background: "#0f172a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "22px",
  },
  botName: {
    fontSize: "14px",
    fontWeight: 600,
  },
  botSubtitle: {
    fontSize: "11px",
    color: "#9ca3af",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  select: {
    padding: "6px 10px",
    borderRadius: "999px",
    border: "1px solid #4b5563",
    background: "#020617",
    color: "#e5e7eb",
    fontSize: "12px",
  },
  langTag: {
    fontSize: "11px",
    color: "#9ca3af",
    border: "1px solid #374151",
    padding: "4px 8px",
    borderRadius: "999px",
  },
  wsBadge: {
    fontSize: "11px",
    color: "#e5e7eb",
    background: "#111827",
    border: "1px solid #374151",
    padding: "4px 8px",
    borderRadius: "999px",
  },
  chatContainer: {
    flex: 1,
    borderRadius: "16px",
    // border: "1px solid "#1f2937",
    background:
      "radial-gradient(circle at top left, rgba(56,189,248,0.08), transparent 55%), rgba(15,23,42,0.95)",
    overflow: "hidden",
    display: "flex",
  },
  chatInner: {
    flex: 1,
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    overflowY: "auto",
  },
  messageRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: "6px",
  },
  bubble: {
    maxWidth: "70%",
    padding: "8px 10px",
    borderRadius: "14px",
    fontSize: "13px",
    lineHeight: 1.4,
  },
  userBubble: {
    background: "#16a34a",
    color: "white",
    borderBottomRightRadius: "4px",
  },
  botBubble: {
    background: "#0b1220",
    color: "#e5e7eb",
    borderBottomLeftRadius: "4px",
    // border: "1px solid "#222f43ff",
  },
  bubbleText: {},
  bubbleStatus: {
    marginTop: "3px",
    fontSize: "10px",
    opacity: 0.7,
  },
  smallAvatar: {
    width: "26px",
    height: "26px",
    borderRadius: "999px",
    background: "#020617",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "14px",
  },
  smallAvatarUser: {
    width: "26px",
    height: "26px",
    borderRadius: "999px",
    background: "#1e293b",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "14px",
  },
  micBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: "6px",
  },
  micHint: {
    fontSize: "12px",
    color: "#9ca3af",
  },
  micButton: {
    width: "52px",
    height: "52px",
    borderRadius: "999px",
    border: "none",
    fontSize: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    boxShadow: "0 0 20px rgba(34,197,94,0.4)",
  },
};

export default VoiceStreamer;
