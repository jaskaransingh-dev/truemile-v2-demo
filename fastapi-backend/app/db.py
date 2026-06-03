import uuid
from datetime import datetime, timezone
from typing import Any
from sqlalchemy import String, Numeric, Integer, Boolean, Text, DateTime, JSON, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from app.config import settings

# Strip pgbouncer params; swap driver to asyncpg
_url = settings.database_url.split("?")[0]
_url = _url.replace("postgresql://", "postgresql+asyncpg://").replace("postgres://", "postgresql+asyncpg://")

engine = create_async_engine(
    _url,
    echo=False,
    pool_size=5,
    max_overflow=10,
    connect_args={"statement_cache_size": 0},
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Driver(Base):
    __tablename__ = "d2_drivers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    driver_name: Mapped[str] = mapped_column(String(255), nullable=False)
    trailer_type: Mapped[str | None] = mapped_column(String(50))
    truck_number: Mapped[str | None] = mapped_column(String(50))
    trailer_number: Mapped[str | None] = mapped_column(String(50))
    phone: Mapped[str | None] = mapped_column(String(50), unique=True)

    loads: Mapped[list["Load"]] = relationship("Load", back_populates="driver")


class Load(Base):
    __tablename__ = "d2_loads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # gmail_extension | manual_upload
    driver_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("d2_drivers.id"), nullable=True)

    load_number: Mapped[str | None] = mapped_column(String(100))
    driver_name: Mapped[str | None] = mapped_column(String(255))
    trailer_type: Mapped[str | None] = mapped_column(String(50))

    driver: Mapped["Driver | None"] = relationship("Driver", back_populates="loads")

    broker_name: Mapped[str | None] = mapped_column(String(255))
    broker_agent_name: Mapped[str | None] = mapped_column(String(255))
    broker_email: Mapped[str | None] = mapped_column(String(255))
    broker_phone: Mapped[str | None] = mapped_column(String(100))
    broker_mc: Mapped[str | None] = mapped_column(String(50))

    pickup_city: Mapped[str | None] = mapped_column(String(100))
    pickup_state: Mapped[str | None] = mapped_column(String(2))
    pickup_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))

    dropoff_city: Mapped[str | None] = mapped_column(String(100))
    dropoff_state: Mapped[str | None] = mapped_column(String(2))
    dropoff_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))

    rate: Mapped[float | None] = mapped_column(Numeric(10, 2))
    loaded_miles: Mapped[int | None] = mapped_column(Integer)
    deadhead_miles: Mapped[int | None] = mapped_column(Integer)
    rpm: Mapped[float | None] = mapped_column(Numeric(10, 4))

    stop_count: Mapped[int | None] = mapped_column(Integer)
    stops: Mapped[Any | None] = mapped_column(JSON)

    status: Mapped[str] = mapped_column(String(50), default="PENDING")
    cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    cancellation_reason: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def build_load(parsed: dict, source: str) -> Load:
    rate = parsed.get("rate")
    miles = parsed.get("loadedMiles")
    rpm = round(float(rate) / float(miles), 4) if rate and miles else None
    return Load(
        id=uuid.uuid4(),
        source=source,
        load_number=parsed.get("loadNumber"),
        driver_name=parsed.get("driverName"),
        trailer_type=parsed.get("trailerType"),
        broker_name=parsed.get("brokerName"),
        broker_agent_name=parsed.get("brokerAgentName"),
        broker_email=parsed.get("brokerEmail"),
        broker_phone=parsed.get("brokerPhone"),
        broker_mc=parsed.get("brokerMC"),
        pickup_city=parsed.get("pickupCity"),
        pickup_state=parsed.get("pickupState"),
        pickup_date=_parse_dt(parsed.get("pickupTime")),
        dropoff_city=parsed.get("dropoffCity"),
        dropoff_state=parsed.get("dropoffState"),
        dropoff_date=_parse_dt(parsed.get("deliveryTime")),
        rate=rate,
        loaded_miles=miles,
        deadhead_miles=parsed.get("deadheadMiles"),
        rpm=rpm,
        stop_count=parsed.get("stopCount"),
        stops=parsed.get("stops"),
    )


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
