import React, { useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const WS_URL = "ws://localhost:8000/ws/live-audio";

const VoiceBotUI: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      role: "assistant",
      text: "Namaste 👋, I’m your AWS Live Voice Bot. Tap the mic and ask anything about AWS – in any language you like.",
    },
  ]);

  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState<string>("Idle");
  const [dummyId, setDummyId] = useState(2);
  const [streamHint, setStreamHint] = useState<string>("");

  // WebSocket state
  const [wsStatus, setWsStatus] = useState<"idle" | "connecting" | "open" | "error">(
    "idle"
  );
  const wsRef = useRef<WebSocket | null>(null);

  // Audio capture refs (input)
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Audio playback (output from Gemini Live)
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const playheadRef = useRef<number>(0); // schedule chunks sequentially

  // ========= Audio utils =========

  // Float32 [-1,1] → Int16 PCM
  const float32ToInt16 = (float32: Float32Array): Int16Array => {
    const len = float32.length;
    const int16 = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  };

  // Ensure playback audio context (browser chooses sampleRate, will resample from 24k)
  const ensureOutputAudioContext = () => {
    if (!audioContextOutRef.current) {
      audioContextOutRef.current = new AudioContext();
      playheadRef.current = 0;
    }
    return audioContextOutRef.current;
  };

  // Wrap raw 16-bit PCM into a minimal WAV header so decodeAudioData can handle it
  const pcmToWav = (pcmBuffer: ArrayBuffer, sampleRate = 24000): ArrayBuffer => {
    const numChannels = 1;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmBuffer.byteLength;
    const headerSize = 44;

    const buffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) {
        view.setUint8(offset + i, s.charCodeAt(i));
      }
    };

    // RIFF header
    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true); // file size - 8
    writeString(8, "WAVE");

    // fmt chunk
    writeString(12, "fmt ");
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // audio format = 1 (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true); // bits per sample (16)

    // data chunk
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    // Copy PCM payload
    const pcmBytes = new Uint8Array(pcmBuffer);
    const wavBytes = new Uint8Array(buffer, headerSize);
    wavBytes.set(pcmBytes);

    return buffer;
  };

  // Play raw 16-bit PCM, 24kHz mono from ArrayBuffer using decodeAudioData
  // and schedule sequentially (no overlap)
  const playPcm24kFromArrayBuffer = async (buffer: ArrayBuffer) => {
    try {
      const audioCtx = ensureOutputAudioContext();

      const wavBuffer = pcmToWav(buffer, 24000);
      const audioBuffer = await audioCtx.decodeAudioData(wavBuffer);

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);

      const now = audioCtx.currentTime;
      const startAt = playheadRef.current > now ? playheadRef.current : now;

      source.start(startAt);
      playheadRef.current = startAt + audioBuffer.duration;
    } catch (err) {
      console.error("Error playing audio:", err);
    }
  };

  // ========= Helper: WebSocket connection =========

  const connectWebSocket = (): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      // if already open, reuse
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        resolve(wsRef.current);
        return;
      }

      console.log("Connecting WebSocket to:", WS_URL);
      setWsStatus("connecting");
      setStatus("Connecting to backend…");

      const ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer"; // we expect binary audio data

      ws.onopen = () => {
        console.log("WebSocket opened");
        wsRef.current = ws;
        setWsStatus("open");
        setStatus("Connected to Gemini Live backend.");
        // reset playhead for new turn
        const outCtx = ensureOutputAudioContext();
        playheadRef.current = outCtx.currentTime;
        resolve(ws);
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        setWsStatus("error");
        setStatus("WebSocket error – check backend.");
        reject(err);
      };

      ws.onclose = () => {
        console.log("WebSocket closed");
        wsRef.current = null;
        setWsStatus("idle");
        if (!isListening) {
          setStatus("Idle");
        }
      };

      ws.onmessage = async (event) => {
        try {
          const data = event.data;
          let arrayBuffer: ArrayBuffer;

          if (data instanceof ArrayBuffer) {
            arrayBuffer = data;
          } else if (data instanceof Blob) {
            arrayBuffer = await data.arrayBuffer();
          } else {
            console.warn("Unknown WS message type", typeof data);
            return;
          }

          // Stream playback: schedule each chunk in order
          playPcm24kFromArrayBuffer(arrayBuffer);
        } catch (err) {
          console.error("Error handling WS message:", err);
        }
      };
    });
  };

  // ========= Mic pipeline =========

  // 🎙️ Start microphone + audio streaming
  const startListening = async () => {
    if (isListening) return;

    try {
      // 1) Ensure WebSocket to backend is open
      const ws = await connectWebSocket();
      if (ws.readyState !== WebSocket.OPEN) {
        alert("WebSocket not open – check backend.");
        return;
      }

      // 2) Ask for mic access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // 3) Create 16kHz audio context (matches Live input)
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0); // Float32
        const pcm16 = float32ToInt16(input);

        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(pcm16.buffer); // send raw bytes
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      mediaStreamRef.current = stream;
      processorRef.current = processor;

      setIsListening(true);
      setStatus("Listening… streaming audio to Gemini Live");
      setStreamHint("Streaming your voice at 16kHz PCM to backend…");
    } catch (err) {
      console.error("Mic / WS error:", err);
      setStatus("Mic or WebSocket error – check console.");
      setStreamHint("");
    }
  };

  // ⏹ Stop microphone streaming (but keep WS open until backend closes)
const stopListening = () => {
  if (!isListening) return;

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

  // 🔔 Tell backend that this audio stream has ended
  if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
    wsRef.current.send("AUDIO_STREAM_END");
  }

  setIsListening(false);
  setStatus(wsStatus === "open" ? "Waiting for bot response…" : "Idle");
  setStreamHint("");
};


  const handleMicToggle = () => {
    if (!isListening) {
      startListening();
    } else {
      stopListening();
    }
  };

  // ========= Demo simulate button (still useful) =========

  const simulateTurn = () => {
    const userText = "How do I create an S3 bucket in Mumbai region?";
    const botText =
      "To create an S3 bucket in ap-south-1 (Mumbai): open the S3 console, click “Create bucket”, choose a globally unique name, select region ap-south-1, keep public access blocked by default, and enable bucket versioning if you need object history.";

    setMessages((prev) => [
      ...prev,
      { id: String(dummyId), role: "user", text: userText },
      { id: String(dummyId + 1), role: "assistant", text: botText },
    ]);
    setDummyId((id) => id + 2);
  };

  const statusColor =
    status.startsWith("Listening") || isListening ? "#22c55e" : "#9ca3af";

  const wsLabel =
    wsStatus === "idle"
      ? "WS: idle"
      : wsStatus === "connecting"
      ? "WS: connecting…"
      : wsStatus === "open"
      ? "WS: connected"
      : "WS: error";

  return (
    <div style={styles.wrapper}>
      {/* Top status row */}
      <div style={styles.statusRow}>
        <div style={styles.botIdentity}>
          <div style={styles.botAvatar}>🤖</div>
          <div>
            <div style={styles.botName}>AWS Help Bot (Live)</div>
            <div style={styles.botSubtitle}>
              Native audio Gemini backend • AWS-focused assistant
            </div>
          </div>
        </div>
        <div style={styles.statusPill}>
          <span
            style={{
              ...styles.statusDot,
              backgroundColor: statusColor,
            }}
          />
          <span style={styles.statusText}>{status}</span>
          <span style={styles.wsBadge}>{wsLabel}</span>
        </div>
      </div>

      {/* Chat window (still text-only, audio is separate) */}
      <div style={styles.chatContainer}>
        <div style={styles.chatInner}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                ...styles.messageRow,
                justifyContent:
                  msg.role === "user" ? "flex-end" : "flex-start",
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
              </div>

              {msg.role === "user" && (
                <div style={styles.smallAvatarUser}>🧑</div>
              )}
            </div>
          ))}

          {/* Small hint while streaming audio */}
          {isListening && streamHint && (
            <div style={{ ...styles.messageRow, justifyContent: "flex-end" }}>
              <div style={styles.smallAvatarUser}>🧑</div>
              <div
                style={{
                  ...styles.bubble,
                  ...styles.userBubble,
                  opacity: 0.85,
                }}
              >
                <div style={styles.bubbleText}>{streamHint}</div>
                <div style={styles.bubbleStatus}>
                  Audio ↔ Gemini Live (no text transcript yet)
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom controls */}
      <div style={styles.bottomBar}>
        <button onClick={simulateTurn} style={styles.secondaryButton}>
          Simulate AWS Q&A (text)
        </button>

        <div style={styles.micArea}>
          <span style={styles.micHint}>
            {isListening
              ? "Listening… speak your AWS question."
              : "Tap the mic and speak your AWS question."}
          </span>
          <button onClick={handleMicToggle} style={styles.micButton}>
            {isListening ? "⏹" : "🎙️"}
          </button>
        </div>
      </div>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    height: "520px",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  },
  botIdentity: {
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
  statusPill: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 10px",
    borderRadius: "999px",
    border: "1px solid #374151",
    background: "#020617",
    fontSize: "11px",
  },
  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: "999px",
  },
  statusText: {
    color: "#e5e7eb",
  },
  wsBadge: {
    marginLeft: 6,
    padding: "2px 8px",
    borderRadius: "999px",
    border: "1px solid #4b5563",
    fontSize: "10px",
    color: "#e5e7eb",
  },
  chatContainer: {
    flex: 1,
    borderRadius: "16px",
    // border: "1px solid "#1f2937",
    background:
      "radial-gradient(circle at top left, rgba(59,130,246,0.10), transparent 55%), #020617",
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
    background: "#020617",
    color: "#e5e7eb",
    borderBottomLeftRadius: "4px",
    // border: "1px solid "#1e293b",
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
  bottomBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  },
  secondaryButton: {
    padding: "8px 14px",
    borderRadius: "999px",
    // border: "1px solid "#4b5563",
    background: "transparent",
    color: "#e5e7eb",
    fontSize: "12px",
    cursor: "pointer",
  },
  micArea: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
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
    background:
      "radial-gradient(circle at 30% 30%, rgba(34,197,94,1), rgba(21,128,61,1))",
    boxShadow: "0 0 24px rgba(34,197,94,0.5)",
  },
};

export default VoiceBotUI;