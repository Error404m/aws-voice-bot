import asyncio
import os
import json
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from google import genai
from google.genai import types
from dotenv import load_dotenv

# ---------------------------------------------------------------------
#   ENV + FASTAPI
# ---------------------------------------------------------------------

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
    print("⚠️ WARNING: GOOGLE_API_KEY not set!")

client = genai.Client(api_key=GOOGLE_API_KEY)

MODEL_ID = "gemini-2.5-flash-native-audio-preview-09-2025"



BASE_SYSTEM_INSTRUCTION = """
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


# ---------------------------------------------------------------------
#   HEALTH CHECK
# ---------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------
#   WEBSOCKET: TURN-BASED AUDIO CHAT WITH PERSONALIZATION
# ---------------------------------------------------------------------

@app.websocket("/ws/live-audio")
async def ws_live_audio(ws: WebSocket):
    await ws.accept()
    print("🔗 WebSocket connected (Turn-based)")

    user_name: Optional[str] = None   # Set once from UI
    has_greeted = False               # Greet only on first turn

    try:
        while True:
            audio_chunks = []
            print("\n🎤 Waiting for user audio...")

            # --------------------------
            #   RECEIVE LOOP
            # --------------------------
            while True:
                try:
                    message = await ws.receive()
                except WebSocketDisconnect:
                    print("❌ Client disconnected")
                    return

                msg_type = message.get("type")

                if msg_type == "websocket.disconnect":
                    print("❌ Client disconnected")
                    return

                if msg_type != "websocket.receive":
                    continue

                text_data = message.get("text")
                byte_data = message.get("bytes")

                # --------------------------
                #   Handle CONFIG message
                # --------------------------
                if text_data:
                    try:
                        data = json.loads(text_data)
                        if data.get("type") == "config":
                            user_name = data.get("userName")
                            print(f"🧑 User name set → {user_name}")
                            continue
                    except:
                        pass

                # --------------------------
                #   END TURN
                # --------------------------
                if text_data == "END_TURN":
                    print(f"✋ End turn ({len(audio_chunks)} chunks)")
                    break

                # --------------------------
                #   AUDIO CHUNK
                # --------------------------
                if byte_data:
                    audio_chunks.append(byte_data)
                    print(f"📥 Received chunk {len(audio_chunks)}")

            if not audio_chunks:
                print("⚠️ No audio received, skipping turn")
                continue

            # -----------------------------------------------------------------
            #   SYSTEM INSTRUCTIONS WITH PERSONALIZATION
            # -----------------------------------------------------------------
            if user_name:
                personalized = (
                        f"\nThe user's name is {user_name}. "
                        f"Use their name naturally sometimes during explanations.\n"
                    )
 

            final_instruction = BASE_SYSTEM_INSTRUCTION + personalized

            # -----------------------------------------------------------------
            #   GEMINI LIVE TURN
            # -----------------------------------------------------------------
            print("🤖 Sending audio to Gemini...")

            try:
                async with client.aio.live.connect(
                    model=MODEL_ID,
                    config={
                        "response_modalities": ["AUDIO"],
                        "system_instruction": final_instruction,
                    },
                ) as session:
                    print("🔗 Gemini Live session started")

                    # Send all audio chunks
                    for i, chunk in enumerate(audio_chunks):
                        await session.send_realtime_input(
                            audio=types.Blob(
                                data=chunk,
                                mime_type="audio/pcm;rate=16000"
                            )
                        )
                        print(f"📤 Sent chunk {i+1}/{len(audio_chunks)}")

                    await session.send_realtime_input(audio_stream_end=True)
                    print("📤 Sent audio_stream_end=True")

                    # Stream Gemini response
                    response_chunks = 0
                    async for response in session.receive():
                        if getattr(response, "data", None) is not None:
                            await ws.send_bytes(response.data)
                            response_chunks += 1
                            print(f"🔊 Sent response chunk {response_chunks}")

                        if getattr(getattr(response, "server_content", None), "turn_complete", False):
                            print("✅ Gemini turn complete")
                            break

                has_greeted = True  # Greeting done
                await ws.send_text("RESPONSE_COMPLETE")

            except Exception as e:
                print(f"❌ Gemini error: {e}")
                await ws.send_text("ERROR")
                continue

    except Exception as e:
        print(f"❌ Unexpected WebSocket error: {e}")

    finally:
        try:
            await ws.close()
        except:
            pass
        print("🔌 WebSocket closed")
