# Gemini Real-Time Voice Assistant Server

Welcome! This is a **Node.js & TypeScript real-time voice assistant server** that connects three powerful Google technologies to deliver a natural, low-latency conversational experience:

- **Google Cloud Speech-to-Text** – Listens to live audio streams and converts them into text.  
- **Gemini 2.5 Flash** – Understands the user’s input and generates smart responses.  
- **Gemini TTS** – Converts AI responses back into audio.

The system uses **WebSockets** for bi-directional streaming, making conversations feel instant and smooth.

![Welcome](https://raw.githubusercontent.com/Error404m/aws-voice-bot/main/REALTIME_AWS_BOT/ss.png)

---

## 🚀 Features

- **Real-Time Streaming**  
  Transcribes audio chunks instantly without waiting for complete audio.

- **Bi-Directional WebSocket Communication**  
  Simultaneous audio input and AI audio output.

- **Multilingual Support**  
  Default: **Indian English (en-IN)**  
  Fallbacks: **Hindi, Tamil, French**

- **100% TypeScript**  
  Strong types and maintainable code.

---

## 📌 Prerequisites

Before starting, ensure you have:

- **Node.js v18+**
- **Google Cloud Project** with Speech-to-Text enabled  
- **Google Service Account Key (JSON)**
- **Gemini API Key** from Google AI Studio

---

## 🛠️ Installation & Setup

### 1. Clone & Install

```bash
npm install
````

---

### 2. Configure Environment Variables

These authenticate with Google's services.

#### Required Vars:

| Variable                         | Description                               |
| -------------------------------- | ----------------------------------------- |
| `GOOGLE_API_KEY`                 | Gemini API key (LLM + TTS)                |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Google Cloud Service Account JSON |

#### Mac / Linux Example:

```bash
export GOOGLE_API_KEY="AIzaSyD-your-gemini-key"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/me/keys/my-service-account.json"
```

#### Windows PowerShell Example:

```powershell
$env:GOOGLE_API_KEY="AIzaSyD-your-gemini-key"
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\keys\my-service-account.json"
```

---

## 🏃‍♂️ Running the Server

### Development Mode

Auto-restart on file save:

```bash
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

Server output:

```
Server listening on http://localhost:4000
WebSocket endpoint ws://localhost:4000/ws/audio
```

---

## 📡 WebSocket API Documentation

### **Endpoint**

```
ws://localhost:4000/ws/audio
```

---

## 1. **Client → Server Messages**

### **Start Stream (JSON)**

Send immediately on connection:

```json
{
  "type": "start",
  "sampleRate": 16000,
  "languageCode": "en-US"
}
```

### **Audio Data (Binary)**

Send raw PCM 16-bit audio frames.

### **Stop Stream (JSON)**

```json
{
  "type": "stop"
}
```

---

## 2. **Server → Client Messages**

### **Transcription Output**

```json
{
  "type": "transcript",
  "transcript": "Hello Gemini",
  "isFinal": true,
  "languageCode": "en-US"
}
```

### **AI Text Response**

```json
{
  "type": "llmResponse",
  "text": "Hello! How can I help you today?"
}
```

### **AI Audio Response**

```json
{
  "type": "llmResponseAudio",
  "audioBase64": "UklGRji..."
}
```

---

## 📂 Project Structure

```
src/
│── index.ts               # Entry point (Express + WebSockets)
│
├── speech/                # Google STT streaming logic
│
├── llm/
│   ├── geminiAudioFromText.ts   # Text → TTS audio generation
│   └── geminiLiveText.ts        # Text-only LLM responses
│
└── types/                 # Shared TypeScript interfaces
```
