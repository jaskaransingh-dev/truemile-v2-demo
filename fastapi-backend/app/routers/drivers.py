from __future__ import annotations
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db import get_db, Driver
from app.schemas import DriverOut, DriverCreate

router = APIRouter(prefix="/api/drivers", tags=["drivers"])


@router.post("", response_model=DriverOut, status_code=201)
async def create_driver(body: DriverCreate, db: AsyncSession = Depends(get_db)):
    driver = Driver(id=uuid.uuid4(), **body.model_dump())
    db.add(driver)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"A driver with phone {body.phone} already exists")
    await db.refresh(driver)
    return driver


@router.get("", response_model=list[DriverOut])
async def list_drivers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Driver).order_by(Driver.driver_name))
    return result.scalars().all()


@router.get("/{driver_id}", response_model=DriverOut)
async def get_driver(driver_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    driver = await db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    return driver


@router.delete("/{driver_id}", status_code=204)
async def delete_driver(driver_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    driver = await db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    await db.delete(driver)
    await db.commit()
