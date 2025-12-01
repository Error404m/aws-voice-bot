import React, { useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const WS_URL = "ws://localhost:8000/ws/live-audio";

const VoiceBotUI: React.FC = () => {
  const [username, setUsername] = useState<string>("");
  const [hasStarted, setHasStarted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
      setStatus("Connecting...");
      const ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          console.log("✅ WebSocket connected");
          wsRef.current = ws;

          const configMessage = JSON.stringify({
            type: "config",
            userName: username.trim(),
          });
          ws.send(configMessage);

          resolve();
        };
        ws.onerror = (err) => {
          console.error("❌ WebSocket error:", err);
          reject(err);
        };
      });

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
          const arrayBuffer =
            event.data instanceof ArrayBuffer
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

      const outCtx = ensureOutputAudioContext();
      playheadRef.current = outCtx.currentTime;

      setIsListening(true);
      setStatus(`Listening...`);

    } catch (err) {
      console.error("❌ Error starting turn:", err);
      setStatus("Error - Check console");
    }
  };

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

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log("✋ Sending END_TURN to server");
      wsRef.current.send("END_TURN");
    }

    setIsListening(false);
    setIsProcessing(true);
    setStatus("Processing your request...");
  };

  const handleMicToggle = () => {
    if (!isListening && !isProcessing) {
      startTurn();
    } else if (isListening) {
      stopListening();
    }
  };

  const handleStart = (name: string) => {
    setUsername(name);
    setHasStarted(true);
  };

  if (!hasStarted) {
    return <WelcomeScreen onStart={handleStart} />;
  }

  return (
    <ChatInterface
      username={username}
      messages={messages}
      isListening={isListening}
      isProcessing={isProcessing}
      status={status}
      onMicToggle={handleMicToggle}
    />
  );
};

// WelcomeScreen Component
const WelcomeScreen: React.FC<{ onStart: (name: string) => void }> = ({ onStart }) => {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("Please enter a valid name (at least 2 characters)");
      return;
    }
    onStart(name.trim());
  };

  return (
    <div className="welcome-container">
      <div className="welcome-card">
        <div className="bot-logo">
          <div className="logo-circle">
            <span className="logo-icon">🤖</span>
          </div>
          <div className="logo-pulse"></div>
        </div>

        <h1 className="welcome-title">AWS DigiBot</h1>
        
        <p className="welcome-subtitle">
          Your 24×7×365 AI Assistant for AWS Queries
        </p>

        <div className="language-section">
          <p className="language-intro">I can help you in multiple languages:</p>
          <div className="language-tags">
            <span className="language-tag">🇮🇳 Hindi</span>
            <span className="language-tag">🇬🇧 English</span>
            <span className="language-tag">🇮🇳 Marathi</span>
            <span className="language-tag">🇮🇳 Gujarati</span>
            <span className="language-tag">🇮🇳 Kannada</span>
            <span className="language-tag">🇮🇳 Tamil</span>
            <span className="language-tag">🇮🇳 Bengali</span>
            <span className="language-tag">🇫🇷 French</span>
            <span className="language-tag">🇪🇸 Spanish</span>
            <span className="language-tag">🇯🇵 Japanese</span>
            <span className="language-tag">+ many more languages....</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="name-form">
          <div className="input-group">
            <label htmlFor="username" className="input-label">
              What's your name?
            </label>
            <input
              id="username"
              type="text"
              className={`name-input ${error ? 'input-error' : ''}`}
              placeholder="Enter your name"
              value={name}
              style={{color:"black"}}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              autoFocus
            />
            {error && <span className="error-message">{error}</span>}
          </div>

          <button type="submit" className="start-button">
            <span className="button-text">Start Conversation</span>
            <span className="button-icon">→</span>
          </button>
        </form>

        <div className="features-grid">
          <div className="feature-item">
            <span className="feature-icon">🎤</span>
            <span className="feature-text">Voice Input</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon">🔊</span>
            <span className="feature-text">Voice Response</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon">⚡</span>
            <span className="feature-text">Real-time AI</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon">🌐</span>
            <span className="feature-text">Multi-language</span>
          </div>
        </div>

  
      </div>


            <footer className="app-footer">
        <span>
          Developed with <span className="heart">❤️</span> by <strong>Mrityunjaya</strong>
        </span>
      </footer>
    </div>
  );
};

// ChatInterface Component
const ChatInterface: React.FC<{
  username: string;
  messages: ChatMessage[];
  isListening: boolean;
  isProcessing: boolean;
  status: string;
  onMicToggle: () => void;
}> = ({ username, messages, isListening, isProcessing, status, onMicToggle }) => {
  const statusColor = isListening
    ? "#22c55e"
    : isProcessing
    ? "#f59e0b"
    : "#6366f1";

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <div className="header-content">
          <div className="bot-identity">
            <div className="bot-avatar-large">
              <span>🤖</span>
            </div>
            <div className="bot-info">
              <h2 className="bot-greeting">
                Hello <span className="username-highlight">{username}</span>, I'm AWS DigiBot
              </h2>
              <p className="bot-description">
                I am here to help 24×7×365 for your any AWS related queries. 
                I can answer in Hindi, English, Marathi, Gujarati, Kannada, Tamil, 
                Bengali, French, Spanish, Japanese, etc.
              </p>
            </div>
          </div>
          
          <div className="status-badge" style={{ borderColor: statusColor }}>
            <span className="status-dot" style={{ backgroundColor: statusColor }}></span>
            <span className="status-text">{status}</span>
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="messages-container">
        <div className="messages-inner">
          {messages.length === 0 && !isListening && !isProcessing && (
            <div className="empty-state">
              <div className="empty-icon">💬</div>
              <p className="empty-text">Click the microphone below to start your conversation</p>
              <p className="empty-hint">Ask me anything about AWS services!</p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`message ${msg.role === "user" ? "message-user" : "message-assistant"}`}
            >
              <div className="message-avatar">
                {msg.role === "assistant" ? "🤖" : "👤"}
              </div>
              <div className="message-bubble">
                <div className="message-text">{msg.text}</div>
              </div>
            </div>
          ))}

          {isListening && (
            <div className="message message-user">
              <div className="message-avatar">👤</div>
              <div className="message-bubble recording-bubble">
                <div className="recording-indicator">
                  <span className="recording-dot"></span>
                  <span className="recording-dot"></span>
                  <span className="recording-dot"></span>
                  <span className="message-text">Recording...</span>
                </div>
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="message message-assistant">
              <div className="message-avatar">🤖</div>
              <div className="message-bubble">
                <div className="thinking-animation">
                  <div className="thinking-dots">
                    <span className="thinking-dot"></span>
                    <span className="thinking-dot"></span>
                    <span className="thinking-dot"></span>
                  </div>
                  <span className="message-text">Thinking...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="controls-container">
        <div className="mic-controls">
          <p className="mic-hint">
            {isListening
              ? "🎤 Listening... Click to stop and send"
              : isProcessing
              ? "⏳ Processing your request..."
              : "🎙️ Click to speak your question"}
          </p>
          <button
            onClick={onMicToggle}
            className={`mic-button ${isListening ? 'mic-active' : ''} ${isProcessing ? 'mic-disabled' : ''}`}
            disabled={isProcessing}
          >
            <span className="mic-icon">
              {isListening ? "⏹" : isProcessing ? "⏳" : "🎙️"}
            </span>
            {isListening && (
              <span className="pulse-ring"></span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceBotUI;

// Styles
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }


  html, body, #root {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
}

/* Full width for both screens */
.welcome-container,
.chat-container {
  width: 100%;
}


  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* Welcome Screen Styles */
.welcome-card {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 24px;
  padding: 48px 40px;
  width: 100%;            /* full width of screen on desktop */
  max-width: none;        /* ensure it doesn’t cap at 600px */
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  animation: slideUp 0.6s ease-out;
}


  .welcome-card {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    border-radius: 24px;
    padding: 48px 40px;
    width: 100%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    animation: slideUp 0.6s ease-out;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(30px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .bot-logo {
    position: relative;
    display: flex;
    justify-content: center;
    margin-bottom: 32px;
  }

  .logo-circle {
    width: 100px;
    height: 100px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    z-index: 2;
    box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
  }

  .logo-icon {
    font-size: 48px;
  }

  .logo-pulse {
    position: absolute;
    width: 100px;
    height: 100px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    opacity: 0.4;
    animation: pulse 2s ease-out infinite;
  }

  @keyframes pulse {
    0% {
      transform: scale(1);
      opacity: 0.4;
    }
    100% {
      transform: scale(1.5);
      opacity: 0;
    }
  }

  .welcome-title {
    font-size: 36px;
    font-weight: 700;
    color: #1f2937;
    text-align: center;
    margin-bottom: 12px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .welcome-subtitle {
    font-size: 18px;
    color: #6b7280;
    text-align: center;
    margin-bottom: 32px;
    font-weight: 500;
  }

  .language-section {
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
    border-radius: 16px;
    padding: 20px;
    margin-bottom: 32px;
  }

  .language-intro {
    font-size: 14px;
    color: #4b5563;
    text-align: center;
    margin-bottom: 16px;
    font-weight: 600;
  }

  .language-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }

  .language-tag {
    background: white;
    color: #667eea;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.15);
    transition: transform 0.2s;
  }

  .language-tag:hover {
    transform: translateY(-2px);
  }

  .name-form {
    margin-bottom: 32px;
  }

  .input-group {
    margin-bottom: 24px;
  }

  .input-label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: #374151;
    margin-bottom: 8px;
  }

  .name-input {
    width: 100%;
    padding: 14px 18px;
    font-size: 16px;
    border: 2px solid #234ea2ff;
    border-radius: 12px;
    outline: none;
    transition: all 0.3s;
    background: white;
  }

  .name-input:focus {
    border-color: #667eea;
    box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
  }

  .name-input.input-error {
    border-color: #ef4444;
  }

  .error-message {
    display: block;
    color: #ef4444;
    font-size: 13px;
    margin-top: 6px;
  }

  .start-button {
    width: 100%;
    padding: 16px 24px;
    font-size: 16px;
    font-weight: 600;
    color: white;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    border-radius: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    transition: all 0.3s;
    box-shadow: 0 4px 16px rgba(102, 126, 234, 0.3);
  }

  .start-button:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
  }

  .start-button:active {
    transform: translateY(0);
  }

  .button-text {
    font-size: 16px;
  }

  .button-icon {
    font-size: 20px;
    transition: transform 0.3s;
  }

  .start-button:hover .button-icon {
    transform: translateX(4px);
  }

  .features-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }

  .feature-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    background: rgba(102, 126, 234, 0.05);
    border-radius: 10px;
  }

  .feature-icon {
    font-size: 24px;
  }

  .feature-text {
    font-size: 13px;
    font-weight: 600;
    color: #4b5563;
  }

  /* Chat Interface Styles */
  .chat-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }

  .chat-header {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    padding: 24px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  }

  .header-content {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
  }

  .bot-identity {
    display: flex;
    gap: 16px;
    flex: 1;
    min-width: 300px;
  }

  .bot-avatar-large {
    width: 64px;
    height: 64px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 32px;
    flex-shrink: 0;
    box-shadow: 0 4px 16px rgba(102, 126, 234, 0.3);
  }

  .bot-info {
    flex: 1;
  }

  .bot-greeting {
    font-size: 24px;
    font-weight: 700;
    color: #1f2937;
    margin-bottom: 8px;
  }

  .username-highlight {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .bot-description {
    font-size: 14px;
    color: #6b7280;
    line-height: 1.6;
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 20px;
    background: white;
    border: 2px solid;
    border-radius: 24px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    animation: statusPulse 2s ease-in-out infinite;
  }

  @keyframes statusPulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .status-text {
    font-size: 14px;
    font-weight: 600;
    color: #374151;
  }

  .messages-container {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  .messages-inner {
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 300px;
    text-align: center;
  }

  .empty-icon {
    font-size: 64px;
    margin-bottom: 16px;
    opacity: 0.8;
  }

  .empty-text {
    font-size: 18px;
    color: white;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .empty-hint {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.8);
  }

  .message {
    display: flex;
    gap: 12px;
    animation: messageSlide 0.3s ease-out;
  }

  @keyframes messageSlide {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .message-user {
    flex-direction: row-reverse;
  }

  .message-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(10px);
  }

  .message-bubble {
    max-width: 70%;
    padding: 14px 18px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  }

  .message-user .message-bubble {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-bottom-right-radius: 4px;
  }

  .message-assistant .message-bubble {
    border-bottom-left-radius: 4px;
  }

  .message-text {
    font-size: 15px;
    line-height: 1.6;
    color: #1f2937;
  }

  .message-user .message-text {
    color: white;
  }

  .recording-bubble {
    background: rgba(239, 68, 68, 0.15) !important;
    border: 2px solid rgba(239, 68, 68, 0.3);
  }

  .recording-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .recording-dot {
    width: 8px;
    height: 8px;
    background: #ef4444;
    border-radius: 50%;
    animation: recordingPulse 1.4s ease-in-out infinite;
  }

  .recording-dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .recording-dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes recordingPulse {
    0%, 100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(1.5);
      opacity: 0.5;
    }
  }

  .thinking-animation {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .thinking-dots {
    display: flex;
    gap: 6px;
  }

  .thinking-dot {
    width: 8px;
    height: 8px;
    background: #667eea;
    border-radius: 50%;
    animation: thinkingBounce 1.4s ease-in-out infinite;
  }

  .thinking-dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .thinking-dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes thinkingBounce {
    0%, 60%, 100% {
      transform: translateY(0);
    }
    30% {
      transform: translateY(-10px);
    }
  }

  .controls-container {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    padding: 24px;
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.1);
  }

  .mic-controls {
    max-width: 600px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .mic-hint {
    font-size: 14px;
    color: #6b7280;
    text-align: center;
    font-weight: 500;
  }

  .mic-button {
    position: relative;
    width: 72px;
    height: 72px;
    border-radius: 50%;
    border: none;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    font-size: 32px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s;
    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
  }

  .mic-button:hover:not(.mic-disabled) {
    transform: translateY(-4px);
    box-shadow: 0 12px 32px rgba(102, 126, 234, 0.5);
  }

  .mic-button:active:not(.mic-disabled) {
    transform: translateY(-2px);
  }

  .mic-button.mic-active {
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    box-shadow: 0 8px 24px rgba(239, 68, 68, 0.4);
  }

  .mic-button.mic-disabled {
    background: linear-gradient(135deg, #9ca3af 0%, #6b7280 100%);
    cursor: not-allowed;
    opacity: 0.6;
  }

  .mic-icon {
    position: relative;
    z-index: 2;
  }

  .pulse-ring {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: 50%;
    border: 3px solid #ef4444;
    animation: pulseRing 1.5s ease-out infinite;
  }

  @keyframes pulseRing {
    0% {
      transform: scale(1);
      opacity: 1;
    }
    100% {
      transform: scale(1.5);
      opacity: 0;
    }
  }

  /* Responsive Design */
  @media (max-width: 768px) {
    .welcome-card {
      padding: 32px 24px;
    }

    .welcome-title {
      font-size: 28px;
    }

    .welcome-subtitle {
      font-size: 16px;
    }

    .language-tags {
      gap: 6px;
    }

    .language-tag {
      font-size: 11px;
      padding: 5px 12px;
    }

    .features-grid {
      grid-template-columns: 1fr;
    }

    .chat-header {
      padding: 16px;
    }

    .header-content {
      flex-direction: column;
    }

    .bot-greeting {
      font-size: 20px;
    }

    .bot-description {
      font-size: 13px;
    }

    .messages-container {
      padding: 16px;
    }

    .message-bubble {
      max-width: 85%;
    }

    .controls-container {
      padding: 20px;
    }

    .mic-button {
      width: 64px;
      height: 64px;
      font-size: 28px;
    }
  }


    .app-footer {
    width: 100%;
    text-align: center;
    font-size: 12px;
    font-weight: 500;
    padding: 10px 16px 18px;
    color: rgba(52, 92, 220, 0.9);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    opacity: 0.9;
  }

  .app-footer-chat {
    /* Optional: subtle divider above footer in chat screen */
    border-top: 1px solid rgba(255, 255, 255, 0.18);
    margin-top: 4px;
  }

  .heart {
    display: inline-block;
    transform: translateY(1px);
    animation: heartBeat 1.4s infinite;
  }

  @keyframes heartBeat {
    0%, 100% {
      transform: scale(1) translateY(1px);
    }
    50% {
      transform: scale(1.2) translateY(1px);
    }
  }


  @media (max-width: 480px) {
    .welcome-card {
      padding: 24px 20px;
    }

    .logo-circle {
      width: 80px;
      height: 80px;
    }

    .logo-icon {
      font-size: 40px;
    }

    .welcome-title {
      font-size: 24px;
    }

    .bot-avatar-large {
      width: 48px;
      height: 48px;
      font-size: 24px;
    }

    .bot-greeting {
      font-size: 18px;
    }

    .status-badge {
      padding: 8px 16px;
      font-size: 12px;
    }


    
  }
`;

document.head.appendChild(styleSheet);
