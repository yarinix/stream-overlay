import os
import secrets

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
JARVIS_TOKEN = os.environ["JARVIS_TOKEN"]
MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

BASE_PROMPT = "Ты Джарвис, личный помощник. Отвечай по-русски, по делу, без лишней воды."
MODES = {
    "short": "Отвечай очень кратко: 1-3 предложения.",
    "detailed": "Отвечай подробно, с примерами и структурой.",
    "simple": "Объясняй простыми словами, как новичку.",
}

app = FastAPI()


class Ask(BaseModel):
    text: str
    mode: str | None = None


@app.get("/")
def health():
    return {"ok": True}


@app.post("/ask")
async def ask(body: Ask, x_token: str = Header(default="")):
    if not secrets.compare_digest(x_token, JARVIS_TOKEN):
        raise HTTPException(status_code=401, detail="bad token")

    system = BASE_PROMPT + " " + MODES.get(body.mode or "", MODES["short"])
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": body.text}]}],
    }

    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            URL,
            headers={"x-goog-api-key": GEMINI_API_KEY},
            json=payload,
        )

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=r.text[:300])

    try:
        answer = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        answer = "Пустой ответ от модели."

    return {"answer": answer}
