"""Query-embedding microservice (ADR 003: ML stays out of the read API).

Loads the same sentence-transformers model used to build core.cve_embedding and
exposes POST /embed → 768-dim vector, so the API can turn a free-text query into
a point in the same space and run pgvector kNN. Kept deliberately tiny.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

MODEL_NAME = os.environ.get(
    "EMBED_MODEL", "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
)

_state: dict[str, Any] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Load once at startup (CPU). Multilingual → русскоязычные запросы тоже ок.
    _state["model"] = SentenceTransformer(MODEL_NAME, device="cpu")
    yield
    _state.clear()


app = FastAPI(title="Irida embedder", lifespan=lifespan)


class EmbedRequest(BaseModel):
    text: str


class EmbedResponse(BaseModel):
    model_name: str
    dim: int
    vector: list[float]


@app.get("/healthz")
def healthz() -> dict[str, object]:
    return {"status": "ok", "model": MODEL_NAME, "loaded": "model" in _state}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    model: SentenceTransformer = _state["model"]
    vec = model.encode(req.text, normalize_embeddings=False)
    return EmbedResponse(model_name=MODEL_NAME, dim=int(len(vec)), vector=[float(x) for x in vec])
