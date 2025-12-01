import asyncio
import io
import os
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types

from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# Allow your Vite dev client
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    print("WARNING: GOOGLE_API_KEY is not set – Gemini Live calls will fail.")

client = genai.Client(api_key=GOOGLE_API_KEY)

# Native audio model (from your example)
MODEL_ID = "gemini-2.5-flash-native-audio-preview-09-2025"

# System instruction focused on AWS
SYSTEM_INSTRUCTION = """
You are “AWS Help Bot”, an expert assistant for Amazon Web Services (AWS).

Your ONLY job is to help with AWS-related questions:
- AWS core services (EC2, S3, RDS, Lambda, API Gateway, ECS/EKS, DynamoDB, CloudFront, Route 53, IAM, VPC, CloudWatch, CloudTrail, etc.)
- AWS architecture, best practices, security, networking, cost optimization, troubleshooting.
- AWS Console, AWS CLI, SDKs, and IaC tools like CloudFormation and CDK.

Behavior rules:
1. If the user asks something NOT related to AWS or cloud, briefly say you are focused only on AWS and gently redirect them back.
2. Always answer in the SAME LANGUAGE as the user’s speech.
3. Provide clear step-by-step instructions.
4. Always highlight AWS best practices (IAM least privilege, encryption, HA, cost optimization).
5. If unsure about limits/pricing/new features, say it may vary and advise checking AWS docs.

Tone: Friendly, calm, supportive. Act like a senior AWS cloud engineer.
"""


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.websocket("/ws/live-audio")
async def websocket_live_audio(ws: WebSocket):
    """
    WebSocket endpoint (multi-turn, call-style):

    - Receives binary PCM 16kHz audio chunks from browser.
    - Forwards them into Gemini Live native audio session.
    - Streams Gemini's 24kHz audio chunks back to browser as binary.
    - Stays open for multiple turns until the client disconnects or an error occurs.

    IMPORTANT: Frontend should send the text frame "AUDIO_STREAM_END"
    when the user stops speaking (mic button ⏹). That lets us call
    `audio_stream_end=True` so Gemini cleanly ends the current turn.
    """
    await ws.accept()
    print("WebSocket client connected.")

    send_task: Optional[asyncio.Task] = None

    try:
        # Open Gemini Live session for the lifetime of this WebSocket
        async with client.aio.live.connect(
            model=MODEL_ID,
            config={
                "response_modalities": ["AUDIO"],
                "system_instruction": SYSTEM_INSTRUCTION,
            },
        ) as session:
            print("Gemini Live session opened.")

            async def forward_model_audio():
                """
                Read streaming responses from Gemini Live
                and forward the raw audio bytes to the browser.

                We don't stop on 'turn_complete'; the session stays
                open for multiple turns. Ending a turn is controlled
                via audio_stream_end=True when the client stops talking.
                """
                try:
                    async for response in session.receive():
                        # AUDIO bytes from Gemini
                        if getattr(response, "data", None) is not None:
                            try:
                                await ws.send_bytes(response.data)
                                print(f"Sent {len(response.data)} bytes of audio to client.")
                            except Exception as e:
                                print("Error sending audio to WebSocket:", repr(e))
                                break

                        # Optional: inspect non-audio parts if you want
                        server_content = getattr(response, "server_content", None)
                        if server_content is not None:
                            # e.g. transcription, markers, etc.
                            pass

                except Exception as e:
                    # Typically fires if WS or session closes
                    print("Error in forward_model_audio (receive loop):", repr(e))

            # Start background task that sends model audio to browser
            send_task = asyncio.create_task(forward_model_audio())

            # Read audio + control messages from browser and feed into Live session
            while True:
                try:
                    message = await ws.receive()
                except WebSocketDisconnect:
                    print("WebSocket disconnected by client.")
                    break
                except Exception as e:
                    print("Error receiving from WebSocket:", repr(e))
                    break

                msg_type = message.get("type")

                if msg_type == "websocket.disconnect":
                    print("WebSocket disconnect message from client.")
                    break

                if msg_type != "websocket.receive":
                    # Ignore pings or other control frames
                    continue

                # We can get text (control) or bytes (audio)
                text_data = message.get("text")
                byte_data = message.get("bytes")

                # 1) Control messages
                if text_data:
                    if text_data == "AUDIO_STREAM_END":
                        print("Received AUDIO_STREAM_END from client.")
                        try:
                            # Signal to Gemini that current audio turn has ended
                            await session.send_realtime_input(audio_stream_end=True)
                            print("Sent audio_stream_end=True to Gemini Live.")
                        except Exception as e:
                            print("Error sending audio_stream_end to Gemini Live:", repr(e))
                            break
                    # Ignore other text frames for now
                    continue

                # 2) Binary audio frames (16-bit PCM mono, 16kHz)
                if not byte_data:
                    # No useful payload
                    continue

                print(f"Received {len(byte_data)} bytes of audio from client.")

                try:
                    await session.send_realtime_input(
                        audio=types.Blob(
                            data=byte_data,
                            mime_type="audio/pcm;rate=16000",
                        )
                    )
                except Exception as e:
                    # If the Live session closed (keepalive / normal end),
                    # stop reading audio and exit loop.
                    print("Error sending audio to Gemini Live:", repr(e))
                    break

            print("Exiting WebSocket loop, closing Gemini Live session...")

    except WebSocketDisconnect:
        print("WebSocket disconnected (WebSocketDisconnect).")
    except Exception as e:
        print("Error in websocket_live_audio:", repr(e))
    finally:
        if send_task:
            send_task.cancel()
        try:
            await ws.close()
        except Exception:
            pass
        print("WebSocket closed.")
