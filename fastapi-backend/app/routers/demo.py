from __future__ import annotations
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db import get_db, Load, build_load
from app.schemas import LoadOut
from app.services.ratecon import parse_ratecon

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.post("/ratecon", response_model=LoadOut)
async def receive_from_extension(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    data = await file.read()
    parsed = await parse_ratecon(data, file.content_type or "application/pdf")
    load = build_load(parsed, source="gmail_extension")
    db.add(load)
    await db.commit()
    await db.refresh(load)
    return load


@router.get("/ratecon/latest")
async def latest_ratecon(db: AsyncSession = Depends(get_db)):
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=60)
    result = await db.execute(
        select(Load)
        .where(Load.source == "gmail_extension")
        .where(Load.created_at >= cutoff)
        .order_by(Load.created_at.desc())
        .limit(1)
    )
    load = result.scalar_one_or_none()
    if not load:
        return {"available": False}
    return {
        "available": True,
        "id": str(load.id),
        "timestamp": int(load.created_at.timestamp() * 1000),
    }
