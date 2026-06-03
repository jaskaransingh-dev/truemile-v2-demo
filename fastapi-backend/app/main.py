import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.db import engine, Base
from app.routers import demo, loads, drivers


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Add new columns to d2_drivers if not already present (handles pre-existing tables)
        for col in [
            "ALTER TABLE d2_drivers ADD COLUMN IF NOT EXISTS truck_number VARCHAR(50)",
            "ALTER TABLE d2_drivers ADD COLUMN IF NOT EXISTS trailer_number VARCHAR(50)",
            "ALTER TABLE d2_drivers ADD COLUMN IF NOT EXISTS phone VARCHAR(50)",
        ]:
            await conn.execute(text(col))
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_d2_drivers_phone ON d2_drivers (phone) WHERE phone IS NOT NULL"
        ))
        # Add driver_id FK to d2_loads if not already present (handles pre-existing tables)
        await conn.execute(text(
            "ALTER TABLE d2_loads ADD COLUMN IF NOT EXISTS driver_id UUID"
        ))
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


@app.get("/health")
async def health():
    return {"status": "ok"}
