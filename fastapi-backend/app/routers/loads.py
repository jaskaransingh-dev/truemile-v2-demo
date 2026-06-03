from __future__ import annotations
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.db import get_db, Load, Driver, build_load
from app.schemas import LoadOut, LoadUpdate
from app.services.ratecon import parse_ratecon
from app.services.google_drive import _get_service, list_subfolders, list_pdfs, download_file

LOCAL_RATECONS_DIR = Path("/app/old_data")

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/loads", tags=["loads"])


@router.post("/parse-ratecon")
async def upload_and_parse(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    data = await file.read()
    parsed = await parse_ratecon(data, file.content_type or "application/pdf")
    load = build_load(parsed, source="manual_upload")
    db.add(load)
    await db.commit()
    await db.refresh(load)
    return {**parsed, "id": str(load.id)}


class DriveImportRequest(BaseModel):
    folder_ids: list[str]


async def _resolve_driver_id(db: AsyncSession, name: str) -> uuid.UUID | None:
    result = await db.execute(
        select(Driver.id).where(func.lower(Driver.driver_name) == name.lower())
    )
    return result.scalar_one_or_none()


@router.post("/import-drive")
async def import_from_drive(
    body: DriveImportRequest,
    db: AsyncSession = Depends(get_db),
):
    service = await run_in_threadpool(_get_service)
    inserted, failed = [], []

    for month_folder_id in body.folder_ids:
        # Level 1: Month Year folder → Driver Name subfolders
        driver_folders = await run_in_threadpool(list_subfolders, service, month_folder_id)
        logger.info(f"[import-drive] {month_folder_id}: {len(driver_folders)} driver folders")

        for driver_folder in driver_folders:
            driver_name = driver_folder["name"]
            driver_id = await _resolve_driver_id(db, driver_name)

            # Level 2: Driver Name folder → PDF files
            pdfs = await run_in_threadpool(list_pdfs, service, driver_folder["id"])
            logger.info(f"[import-drive] {driver_name}: {len(pdfs)} PDFs")

            for f in pdfs:
                try:
                    data = await run_in_threadpool(download_file, service, f["id"])
                    parsed = await parse_ratecon(data, "application/pdf")
                    load = build_load(parsed, source="google_drive")
                    # Folder name is more reliable than what the parser finds
                    load.driver_name = driver_name
                    load.driver_id = driver_id
                    db.add(load)
                    await db.flush()
                    inserted.append({
                        "file": f["name"],
                        "driver": driver_name,
                        "id": str(load.id),
                    })
                except Exception as e:
                    logger.warning(f"[import-drive] failed {f['name']}: {e}")
                    failed.append({"file": f["name"], "driver": driver_name, "error": str(e)})

    await db.commit()
    return {
        "inserted": len(inserted),
        "failed": len(failed),
        "loads": inserted,
        "errors": failed,
    }


@router.post("/import-local")
async def import_from_local(db: AsyncSession = Depends(get_db)):
    if not LOCAL_RATECONS_DIR.exists():
        raise HTTPException(status_code=404, detail=f"{LOCAL_RATECONS_DIR} not found")

    inserted, failed = [], []

    # Walk: Month Year / Driver Name / *.pdf
    for month_dir in sorted(LOCAL_RATECONS_DIR.iterdir()):
        if not month_dir.is_dir():
            continue
        for driver_dir in sorted(month_dir.iterdir()):
            if not driver_dir.is_dir():
                continue
            driver_name = driver_dir.name
            driver_id = await _resolve_driver_id(db, driver_name)
            pdfs = sorted(driver_dir.glob("*.pdf"))
            logger.info(f"[import] {month_dir.name} / {driver_name} — {len(pdfs)} files")

            for i, pdf in enumerate(pdfs, 1):
                logger.info(f"[import] [{i}/{len(pdfs)}] {driver_name} — {pdf.name}")
                try:
                    data = pdf.read_bytes()
                    parsed = await parse_ratecon(data, "application/pdf")
                    load = build_load(parsed, source="local_import")
                    load.driver_name = driver_name
                    load.driver_id = driver_id
                    db.add(load)
                    await db.flush()
                    inserted.append({"file": pdf.name, "driver": driver_name, "id": str(load.id)})
                    logger.info(f"[import] ✓ {pdf.name} — rate={parsed.get('rate')} {parsed.get('pickupCity')} → {parsed.get('dropoffCity')}")
                except Exception as e:
                    logger.warning(f"[import] ✗ {pdf.name} — {e}")
                    failed.append({"file": pdf.name, "driver": driver_name, "error": str(e)})

    await db.commit()
    return {"inserted": len(inserted), "failed": len(failed), "loads": inserted, "errors": failed}


@router.get("", response_model=list[LoadOut])
async def list_loads(
    # Filters
    driver_id: uuid.UUID | None = None,
    driver_name: str | None = None,
    month: int | None = None,   # 1-12
    year: int | None = None,    # e.g. 2026
    trailer_type: str | None = None,
    # Pagination
    page: int = 1,
    page_size: int = 50,
    db: AsyncSession = Depends(get_db),
):
    query = select(Load)

    if driver_id:
        query = query.where(Load.driver_id == driver_id)
    if driver_name:
        query = query.where(func.lower(Load.driver_name) == driver_name.lower())
    if trailer_type:
        query = query.where(func.lower(Load.trailer_type) == trailer_type.lower())
    if month:
        query = query.where(func.extract("month", Load.pickup_date) == month)
    if year:
        query = query.where(func.extract("year", Load.pickup_date) == year)

    query = (
        query.order_by(Load.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{load_id}", response_model=LoadOut)
async def get_load(load_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    load = await db.get(Load, load_id)
    if not load:
        raise HTTPException(status_code=404, detail="Load not found")
    return load


@router.patch("/{load_id}", response_model=LoadOut)
async def update_load(
    load_id: uuid.UUID,
    update: LoadUpdate,
    db: AsyncSession = Depends(get_db),
):
    load = await db.get(Load, load_id)
    if not load:
        raise HTTPException(status_code=404, detail="Load not found")
    for field, value in update.model_dump(exclude_none=True).items():
        setattr(load, field, value)
    load.updated_at = datetime.now(timezone.utc)
    if load.rate and load.loaded_miles:
        load.rpm = round(float(load.rate) / float(load.loaded_miles), 4)
    await db.commit()
    await db.refresh(load)
    return load
