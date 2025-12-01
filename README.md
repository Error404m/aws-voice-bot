# AWS Live Voice Bot (Gemini Native Audio + FastAPI + React)

A real-time **voice-first** assistant for AWS, powered by **Gemini 2.5 Native Audio**, with:

- Streaming mic → model audio
- Streaming model audio → browser
- Live **transcripts** (user + bot)
- Multi-turn, **call-like** experience
- **Multilingual** support (Hindi, English, Marathi, Gujarati, Tamil, Kannada, etc.)

---
![Welcome](https://raw.githubusercontent.com/Error404m/aws-voice-bot/main/Welcome.png)


## What this project does

This app lets you talk to an **AWS expert bot** as if you’re on a call:

1. Click 🎙️ to start talking.
2. Your voice is streamed to the backend over WebSocket.
3. Gemini Native Audio:
   - Understands your speech (any supported language),
   - Generates an answer,
   - Streams back **audio** + **text transcripts** in real time.
4. The frontend:
   - Plays the bot’s audio,
   - Shows your live transcript,
   - Shows the bot’s live transcript,
   - Stores final responses in a chat-like UI.

All of this happens in a **continuous session** .

---

## Architecture

- **Backend:** FastAPI + `google-genai` Python SDK  
  - WebSocket endpoint: `ws://localhost:8000/ws/live-audio`
  - Uses `gemini-2.5-flash-native-audio-preview-09-2025`
  - Streams:
    - 16 kHz PCM Int16 audio from browser → Gemini
    - 24 kHz PCM Int16 audio from Gemini → browser
    - JSON text messages (transcripts, model text, turn markers)

- **Frontend:** React (TypeScript)  
  - Single-page UI with `VoiceBotUI.tsx`
  - Connects to WebSocket backend
  - Captures mic audio with Web Audio API
  - Shows chat bubbles + live transcript + connection status
  - Plays PCM audio from Gemini

---

## Features

- 🗣️ **Live voice to voice** via Gemini Native Audio
- 💬 **Live transcription**:
  - `input_transcript` → user speech transcript
  - `output_transcript` → bot speech transcript
  - `model_text` → bot’s final text answer
-  **Multi-turn conversation** in a single session (call-style)
- **Multilingual**:
  - Hindi, English, Marathi, Gujarati, Tamil, Kannada, and many more
- ☁️ **AWS-focused assistant**:
  - EC2, S3, RDS, Lambda, VPC, IAM, CloudFront, Route 53, etc.
  - System prompt instructs it to stay on AWS topics
  - Answers in **same language** as user’s speech

---

## 📂 Project Structure

```text
.
├── main.py             # FastAPI backend + Gemini Live WebSocket
├── requirements.txt    # Python dependencies (optional)
├── frontend/
│   ├── src/
│   │   ├── VoiceBotUI.tsx  # React UI for the voice bot
│   │   ├── main.tsx        # React entry
│   │   ├── App.tsx         # App wrapper
│   │   └── index.css       # Global styles
│   ├── package.json
│   └── vite.config.ts
└── README.md
````

Adjust to match your actual folder structure if needed.

---

## Prerequisites

* **Python** 3.10+
* **Node.js** 18+
* A **Google API key** with access to **Gemini 2.5 Native Audio**

  * Set it as `GOOGLE_API_KEY` in your environment

---

## ⚙️ Backend Setup (FastAPI + Gemini)

1. Create & activate a virtualenv (optional but recommended):

   ```bash
   python -m venv venv
   source venv/bin/activate  # Linux / macOS
   # venv\Scripts\activate   # Windows
   ```

2. Install dependencies:

   ```bash
   pip install fastapi uvicorn python-dotenv google-genai
   ```

3. Create a `.env` file in the backend folder:

   ```bash
   echo "GOOGLE_API_KEY=YOUR_API_KEY_HERE" > .env
   ```

4. Run the backend:

   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

5. (Optional) Health check:

   * Open `http://localhost:8000/health`
   * You should see: `{"status": "ok"}`

---

## 🖥️ Frontend Setup (React + Vite)

From the `frontend` directory:

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the dev server:

   ```bash
   npm run dev
   ```

3. Open the URL shown in the console (usually):

   ```text
   http://localhost:5173
   ```

4. Make sure CORS in `main.py` allows your frontend origin:

   ```python
   app.add_middleware(
       CORSMiddleware,
       allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
       allow_credentials=True,
       allow_methods=["*"],
       allow_headers=["*"],
   )
   ```

---

## 🎧 Using the App

1. Start **backend** (`uvicorn`) and **frontend** (`npm run dev`).

2. Open the frontend in your browser.

3. Click the **mic button 🎙️**:

   * Browser will ask for mic permission (first time).
   * Audio starts streaming to the backend.

4. **Ask your AWS question** in any supported language:

   * Example (Hindi):
     `Amazon S3 bucket ka access kaise secure karen?`
   * Example (Marathi):
     `AWS madhye Lambda function kase deploy karayche?`

5. Watch the UI:

   * User transcript shows as you speak.
   * Bot audio plays back.
   * Bot transcript & final text appear in the chat.

6. Click **⏹** to stop sending mic audio.

7. Click 🎙️ again any time to continue the “call”.

---

## Customization

### Change the system prompt

In `main.py`:

```python
SYSTEM_INSTRUCTION = """
You are “AWS Help Bot”, an expert assistant for Amazon Web Services (AWS).
...
"""
```

You can:

* Broaden the scope (e.g., general cloud)
* Lock it to your company’s AWS guidelines
* Change tone (more formal, more friendly, etc.)

### Change the model

Change this line in `main.py`:

```python
MODEL_ID = "gemini-2.5-flash-native-audio-preview-09-2025"
```

Make sure your chosen model supports **native audio** and **streaming**.

---

## Troubleshooting

* **No audio response?**

  * Check browser console for WebSocket errors.
  * Confirm backend is running on `localhost:8000`.
  * Verify `GOOGLE_API_KEY` is set and valid.

* **CORS errors?**

  * Make sure your frontend origin is added in `allow_origins` in `main.py`.

* **Mic issues in browser?**

  * Ensure HTTPS if you deploy on the web.
  * Check browser permission settings for microphone.

---

## License

Add your preferred license here, for example:

```text
MIT License
```

---

## Built with:

* [FastAPI](https://fastapi.tiangolo.com/)
* [Vite + React + TypeScript](https://vitejs.dev/)
* [Google Gemini 2.5 Native Audio](https://ai.google.dev/)


