
### Gemini Real-Time Voice Assistant Server

Welcome! This is a Node.js & TypeScript  that powers a real-time voice assistant. It connects three powerful technologies to create a seamless conversational experience:

Google Cloud Speech-to-Text: Listens to live audio streams and converts them to text.

Gemini 2.5 Flash: Thinks about what the user said and generates a text response.

Gemini TTS: Converts the AI's response back into audio for playback.

It uses WebSockets for low-latency communication, making the conversation feel natural and snappy.

![Welcome](https://raw.githubusercontent.com/Error404m/aws-voice-bot/main/REALTIME_AWS_BOT/ss.png)


## Features

Real-Time Streaming: Transcribes audio chunks as they arrive, rather than waiting for the whole file.

Bi-Directional Communication: Uses WebSockets (ws) to handle simultaneous audio uploading and response downloading.

Multilingual Support: Configured for Indian English (en-IN) with fallbacks for Hindi, Tamil, and French.

Type-Safe: Built completely in TypeScript for robust and maintainable code.

## Prerequisites

Before you start, make sure you have:

Node.js (v18 or higher recommended).

A Google Cloud Project with the Cloud Speech-to-Text API enabled.

A Google Service Account Key (JSON file) for the Cloud project.

A Gemini API Key from Google AI Studio.

### Installation & Setup

1. Clone & Install

Grab the code and install the dependencies:

# Install dependencies
npm install


2. Configure Environment Variables

This server relies on specific environment variables to authenticate with Google's services. You can set these in your terminal session or use a .env file manager (note: dotenv isn't currently in package.json, so setting them in the shell is safer).

Required Variables:

GOOGLE_API_KEY: Your key for Gemini (LLM & TTS).

GOOGLE_APPLICATION_CREDENTIALS: Absolute path to your Google Cloud Service Account JSON file (for Speech-to-Text).

Mac/Linux Example:

export GOOGLE_API_KEY="AIzaSyD-your-gemini-key"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/me/keys/my-service-account.json"


Windows (PowerShell) Example:

$env:GOOGLE_API_KEY="AIzaSyD-your-gemini-key"
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\keys\my-service-account.json"


🏃‍♂️ Running the Server

Development Mode

Use this for coding. It watches for file changes and restarts automatically.

npm run dev


Production Build

Use this for deployment.

npm run build
npm start


Once running, you should see:

Server listening on http://localhost:4000
WebSocket endpoint ws://localhost:4000/ws/audio


📡 API Documentation

WebSocket Endpoint

URL: ws://localhost:4000/ws/audio

This is the main channel for interaction.

1. Client -> Server Messages

Start the Stream (JSON):
Send this immediately after connecting.

{
  "type": "start",
  "sampleRate": 16000,
  "languageCode": "en-US"  // Optional
}


Audio Data (Binary):
Send raw audio chunks (e.g., PCM 16-bit) as binary messages after the start command.

Stop the Stream (JSON):

{
  "type": "stop"
}


2. Server -> Client Messages

Transcription Update:

{
  "type": "transcript",
  "transcript": "Hello Gemini",
  "isFinal": true,
  "languageCode": "en-US"
}


AI Text Response:

{
  "type": "llmResponse",
  "text": "Hello! How can I help you today?"
}


AI Audio Response:
Contains the base64 encoded PCM audio of the AI speaking.

{
  "type": "llmResponseAudio",
  "audioBase64": "UklGRji..."
}


📂 Project Structure

src/index.ts: Entry point. Sets up Express and the WebSocket server.

src/speech/: Handles Google Cloud Speech-to-Text streaming logic.

src/llm/:

geminiAudioFromText.ts: Generates text answers + TTS audio.

geminiLiveText.ts: Logic for text-only interactions.

src/types/: TypeScript interfaces for WebSocket messages.

📝 License

ISC
