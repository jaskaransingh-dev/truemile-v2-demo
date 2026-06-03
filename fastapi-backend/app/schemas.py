from __future__ import annotations
import uuid
from datetime import datetime
from typing import Any
from pydantic import BaseModel


class DriverOut(BaseModel):
    id: uuid.UUID
    driver_name: str
    trailer_type: str | None
    truck_number: str | None
    trailer_number: str | None
    phone: str | None

    model_config = {"from_attributes": True}


class DriverCreate(BaseModel):
    driver_name: str
    trailer_type: str | None = None
    truck_number: str | None = None
    trailer_number: str | None = None
    phone: str | None = None


class LoadOut(BaseModel):
    id: uuid.UUID
    source: str
    driver_id: uuid.UUID | None
    load_number: str | None
    driver_name: str | None
    trailer_type: str | None
    broker_name: str | None
    broker_agent_name: str | None
    broker_email: str | None
    broker_phone: str | None
    broker_mc: str | None
    pickup_city: str | None
    pickup_state: str | None
    pickup_date: datetime | None
    dropoff_city: str | None
    dropoff_state: str | None
    dropoff_date: datetime | None
    rate: float | None
    loaded_miles: int | None
    deadhead_miles: int | None
    rpm: float | None
    stop_count: int | None
    stops: Any
    status: str
    cancelled: bool
    cancellation_reason: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class LoadUpdate(BaseModel):
    driver_id: uuid.UUID | None = None
    driver_name: str | None = None
    trailer_type: str | None = None
    rate: float | None = None
    loaded_miles: int | None = None
    deadhead_miles: int | None = None
    status: str | None = None
    cancelled: bool | None = None
    cancellation_reason: str | None = None
