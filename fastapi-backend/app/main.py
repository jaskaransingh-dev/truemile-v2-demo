import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.db import engine, Base
from app.routers import demo, loads, drivers, analytics


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Transaction 1: schema changes + dedup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for col in [
            "ALTER TABLE d2_drivers ADD COLUMN IF NOT EXISTS truck_number VARCHAR(50)",
            "ALTER TABLE d2_drivers ADD COLUMN IF NOT EXISTS trailer_number VARCHAR(50)",
            "ALTER TABLE d2_drivers ADD COLUMN IF NOT EXISTS phone VARCHAR(50)",
            "ALTER TABLE d2_loads ADD COLUMN IF NOT EXISTS driver_id UUID",
        ]:
            await conn.execute(text(col))
        await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                    WHERE constraint_name = 'fk_d2_loads_driver_id'
                ) THEN
                    ALTER TABLE d2_loads
                    ADD CONSTRAINT fk_d2_loads_driver_id
                    FOREIGN KEY (driver_id) REFERENCES d2_drivers(id);
                END IF;
            END
            $$;
        """))
        # Deduplicate before creating unique indexes
        await conn.execute(text("""
            DELETE FROM d2_loads
            WHERE id IN (
                SELECT id FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY load_number
                               ORDER BY created_at DESC
                           ) AS rn
                    FROM d2_loads
                    WHERE load_number IS NOT NULL
                ) ranked
                WHERE rn > 1
            )
        """))

    # Transaction 2: unique indexes (must be after dedup is committed)
    async with engine.begin() as conn:
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_d2_drivers_phone ON d2_drivers (phone) WHERE phone IS NOT NULL"
        ))
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_d2_loads_load_number ON d2_loads (load_number) WHERE load_number IS NOT NULL"
        ))
    yield


app = FastAPI(title="TrueMile v2 API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(demo.router)
app.include_router(loads.router)
app.include_router(drivers.router)
app.include_router(analytics.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
