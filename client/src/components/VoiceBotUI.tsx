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
      text: "Namaste 👋, I'm your AWS Live Voice Bot. Tap the mic and ask anything about AWS – in any language you like.",
    },
  ]);

  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string>("Ready");

  // WebSocket
  const wsRef = useRef<WebSocket | null>(null);

  // Audio capture (input)
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Audio playback (output)
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const playheadRef = useRef<number>(0);

  // ========= Audio Utils =========

  const float32ToInt16 = (float32: Float32Array): Int16Array => {
    const len = float32.length;
    const int16 = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16;
  };

  const ensureOutputAudioContext = () => {
    if (!audioContextOutRef.current) {
      audioContextOutRef.current = new AudioContext();
      playheadRef.current = 0;
    }
    return audioContextOutRef.current;
  };

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

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    const pcmBytes = new Uint8Array(pcmBuffer);
    const wavBytes = new Uint8Array(buffer, headerSize);
    wavBytes.set(pcmBytes);

    return buffer;
  };

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

  // ========= Turn-based Logic =========

  const startTurn = async () => {
    if (isListening || isProcessing) return;

    try {
      // 1. Connect WebSocket
      setStatus("Connecting...");
      const ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          console.log("✅ WebSocket connected");
          wsRef.current = ws;
          resolve();
        };
        ws.onerror = (err) => {
          console.error("❌ WebSocket error:", err);
          reject(err);
        };
      });

      // 2. Handle incoming messages
      ws.onmessage = async (event) => {
        if (typeof event.data === "string") {
          if (event.data === "RESPONSE_COMPLETE") {
            console.log("✅ Response complete, ready for next turn");
            setIsProcessing(false);
            setStatus("Ready - Tap mic to speak again");
          } else if (event.data === "ERROR") {
            console.error("❌ Server error");
            setIsProcessing(false);
            setStatus("Error - Try again");
          }
        } else {
          // Binary audio from Gemini
          const arrayBuffer = event.data instanceof ArrayBuffer 
            ? event.data 
            : await event.data.arrayBuffer();
          playPcm24kFromArrayBuffer(arrayBuffer);
        }
      };

      ws.onclose = () => {
        console.log("🔌 WebSocket closed");
        wsRef.current = null;
        if (isListening) {
          stopListening();
        }
      };

      // 3. Start microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const pcm16 = float32ToInt16(input);

        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(pcm16.buffer);
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      mediaStreamRef.current = stream;
      processorRef.current = processor;

      // Reset playhead for new response
      const outCtx = ensureOutputAudioContext();
      playheadRef.current = outCtx.currentTime;

      setIsListening(true);
      setStatus("🎤 Listening... Speak your AWS question");

    } catch (err) {
      console.error("❌ Error starting turn:", err);
      setStatus("Error - Check console");
    }
  };

  const stopListening = () => {
    if (!isListening) return;

    // Stop microphone
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

    // Send END_TURN signal
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log("✋ Sending END_TURN to server");
      wsRef.current.send("END_TURN");
    }

    setIsListening(false);
    setIsProcessing(true);
    setStatus("🤖 Processing... Gemini is responding");
  };

  const handleMicToggle = () => {
    if (!isListening && !isProcessing) {
      startTurn();
    } else if (isListening) {
      stopListening();
    }
  };

  const statusColor = isListening 
    ? "#22c55e" 
    : isProcessing 
    ? "#f59e0b" 
    : "#9ca3af";

  const micButtonStyle = isListening
    ? styles.micButtonActive
    : isProcessing
    ? styles.micButtonProcessing
    : styles.micButton;

  return (
    <div style={styles.wrapper}>
      {/* Status */}
      <div style={styles.statusRow}>
        <div style={styles.botIdentity}>
          <div style={styles.botAvatar}>🤖</div>
          <div>
            <div style={styles.botName}>AWS Help Bot (Turn-based)</div>
            <div style={styles.botSubtitle}>
              Speak → Gemini responds → Speak again
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
        </div>
      </div>

      {/* Chat (optional visual feedback) */}
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

          {isListening && (
            <div style={{ ...styles.messageRow, justifyContent: "flex-end" }}>
              <div style={styles.smallAvatarUser}>🧑</div>
              <div style={{ ...styles.bubble, ...styles.userBubble }}>
                <div style={styles.bubbleText}>🎤 Recording...</div>
              </div>
            </div>
          )}

          {isProcessing && (
            <div style={{ ...styles.messageRow, justifyContent: "flex-start" }}>
              <div style={styles.smallAvatar}>🤖</div>
              <div style={{ ...styles.bubble, ...styles.botBubble }}>
                <div style={styles.bubbleText}>🤔 Thinking...</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div style={styles.bottomBar}>
        <div style={styles.micArea}>
          <span style={styles.micHint}>
            {isListening
              ? "Click to stop and send ⏹"
              : isProcessing
              ? "Waiting for response..."
              : "Click to speak 🎙️"}
          </span>
          <button 
            onClick={handleMicToggle} 
            style={micButtonStyle}
            disabled={isProcessing}
          >
            {isListening ? "⏹" : isProcessing ? "⏳" : "🎙️"}
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
  chatContainer: {
    flex: 1,
    borderRadius: "16px",
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
  },
  bubbleText: {},
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
    justifyContent: "center",
    gap: "12px",
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
  micButtonActive: {
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
      "radial-gradient(circle at 30% 30%, rgba(239,68,68,1), rgba(185,28,28,1))",
    boxShadow: "0 0 24px rgba(239,68,68,0.5)",
  },
  micButtonProcessing: {
    width: "52px",
    height: "52px",
    borderRadius: "999px",
    border: "none",
    fontSize: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "not-allowed",
    background:
      "radial-gradient(circle at 30% 30%, rgba(245,158,11,1), rgba(180,83,9,1))",
    boxShadow: "0 0 24px rgba(245,158,11,0.5)",
    opacity: 0.7,
  },
};

export default VoiceBotUI;