import asyncio
import os
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types

from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

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
MODEL_ID = "gemini-2.5-flash-native-audio-preview-09-2025"

SYSTEM_INSTRUCTION = """
You are "AWS Help Bot", an expert assistant for Amazon Web Services (AWS).

Your ONLY job is to help with AWS-related questions:
- AWS core services (EC2, S3, RDS, Lambda, API Gateway, ECS/EKS, DynamoDB, CloudFront, Route 53, IAM, VPC, CloudWatch, CloudTrail, etc.)
- AWS architecture, best practices, security, networking, cost optimization, troubleshooting.
- AWS Console, AWS CLI, SDKs, and IaC tools like CloudFormation and CDK.

Behavior rules:
1. If the user asks something NOT related to AWS or cloud, briefly say you are focused only on AWS and gently redirect them back.
2. Always answer in the SAME LANGUAGE as the user's speech.
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
    Turn-based conversation:
    1. Client connects and sends audio chunks
    2. Client sends "END_TURN" when done speaking
    3. Server processes with Gemini Live and streams response
    4. Server sends "RESPONSE_COMPLETE" when done
    5. Client can start next turn (repeat from step 1)
    """
    await ws.accept()
    print("✅ WebSocket client connected (turn-based mode)")

    try:
        while True:
            print("\n🎤 Waiting for user to speak...")
            
            # Phase 1: Collect audio from user until "END_TURN"
            audio_chunks = []
            
            while True:
                try:
                    message = await ws.receive()
                except WebSocketDisconnect:
                    print("❌ WebSocket disconnected by client")
                    return
                except Exception as e:
                    print(f"❌ Error receiving: {e}")
                    return

                msg_type = message.get("type")
                
                if msg_type == "websocket.disconnect":
                    print("❌ Client disconnected")
                    return

                if msg_type != "websocket.receive":
                    continue

                text_data = message.get("text")
                byte_data = message.get("bytes")

                # Check for end of turn signal
                if text_data == "END_TURN":
                    print(f"✋ User finished speaking ({len(audio_chunks)} chunks collected)")
                    break

                # Collect audio chunk
                if byte_data:
                    audio_chunks.append(byte_data)
                    print(f"📥 Received audio chunk {len(audio_chunks)} ({len(byte_data)} bytes)")

            # Phase 2: Process with Gemini Live (single turn)
            if not audio_chunks:
                print("⚠️ No audio received, skipping turn")
                continue

            print(f"🤖 Processing {len(audio_chunks)} audio chunks with Gemini...")
            
            try:
                async with client.aio.live.connect(
                    model=MODEL_ID,
                    config={
                        "response_modalities": ["AUDIO"],
                        "system_instruction": SYSTEM_INSTRUCTION,
                    },
                ) as session:
                    print("🔗 Gemini Live session opened")

                    # Send all collected audio chunks
                    for i, chunk in enumerate(audio_chunks):
                        await session.send_realtime_input(
                            audio=types.Blob(
                                data=chunk,
                                mime_type="audio/pcm;rate=16000",
                            )
                        )
                        print(f"📤 Sent chunk {i+1}/{len(audio_chunks)} to Gemini")

                    # Signal end of audio input
                    await session.send_realtime_input(audio_stream_end=True)
                    print("✅ Sent audio_stream_end=True to Gemini")

                    # Stream response back to client
                    response_chunk_count = 0
                    async for response in session.receive():
                        if getattr(response, "data", None) is not None:
                            await ws.send_bytes(response.data)
                            response_chunk_count += 1
                            print(f"🔊 Sent audio response chunk {response_chunk_count} ({len(response.data)} bytes)")

                        # Check for turn complete
                        server_content = getattr(response, "server_content", None)
                        if server_content:
                            turn_complete = getattr(server_content, "turn_complete", False)
                            if turn_complete:
                                print("✅ Turn complete from Gemini")
                                break

                    # Notify client that response is complete
                    await ws.send_text("RESPONSE_COMPLETE")
                    print("✅ Sent RESPONSE_COMPLETE to client\n")

            except Exception as e:
                print(f"❌ Error in Gemini Live session: {e}")
                await ws.send_text("ERROR")
                continue

    except Exception as e:
        print(f"❌ WebSocket error: {e}")
    finally:
        try:
            await ws.close()
        except:
            pass
        print("🔌 WebSocket closed")