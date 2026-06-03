from __future__ import annotations
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case, and_, Numeric
from app.db import get_db, Load

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _month_filter(query, month: int | None, year: int | None):
    if month:
        query = query.where(func.extract("month", Load.pickup_date) == month)
    if year:
        query = query.where(func.extract("year", Load.pickup_date) == year)
    return query


@router.get("/summary")
async def summary(
    month: int | None = None,
    year: int | None = None,
    driver_name: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(
        func.coalesce(func.sum(Load.rate), 0).label("total_revenue"),
        func.count(Load.id).label("loads_count"),
        func.avg(Load.rpm).label("avg_rpm"),
        func.coalesce(func.sum(Load.loaded_miles), 0).label("total_loaded_miles"),
    ).where(Load.rate.isnot(None))

    query = _month_filter(query, month, year)
    if driver_name:
        query = query.where(func.lower(Load.driver_name) == driver_name.lower())

    row = (await db.execute(query)).one()
    return {
        "total_revenue": float(row.total_revenue or 0),
        "loads_count": row.loads_count,
        "avg_rpm": round(float(row.avg_rpm), 2) if row.avg_rpm else None,
        "total_loaded_miles": int(row.total_loaded_miles or 0),
    }


@router.get("/revenue-by-month")
async def revenue_by_month(
    year: int | None = None,
    driver_name: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(
        func.extract("year", Load.pickup_date).label("year"),
        func.extract("month", Load.pickup_date).label("month"),
        func.sum(Load.rate).label("revenue"),
        func.count(Load.id).label("loads"),
    ).where(
        Load.pickup_date.isnot(None),
        Load.rate.isnot(None),
    )

    if year:
        query = query.where(func.extract("year", Load.pickup_date) == year)
    if driver_name:
        query = query.where(func.lower(Load.driver_name) == driver_name.lower())

    query = query.group_by("year", "month").order_by("year", "month")
    rows = (await db.execute(query)).all()

    month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return [
        {
            "year": int(r.year),
            "month": int(r.month),
            "month_label": month_names[int(r.month) - 1],
            "revenue": float(r.revenue),
            "loads": r.loads,
        }
        for r in rows
    ]


@router.get("/by-driver")
async def by_driver(
    month: int | None = None,
    year: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    util_expr = case(
        (
            and_(Load.loaded_miles.isnot(None), Load.deadhead_miles.isnot(None),
                 (Load.loaded_miles + Load.deadhead_miles) > 0),
            func.round(
                func.cast(Load.loaded_miles, Numeric) * 100
                / (Load.loaded_miles + Load.deadhead_miles),
                1,
            ),
        ),
        else_=None,
    )

    query = select(
        Load.driver_name,
        func.count(Load.id).label("loads"),
        func.coalesce(func.sum(Load.rate), 0).label("revenue"),
        func.avg(Load.rpm).label("avg_rpm"),
        func.avg(util_expr).label("avg_utilization"),
    ).where(Load.driver_name.isnot(None))

    query = _month_filter(query, month, year)
    query = query.group_by(Load.driver_name).order_by(func.sum(Load.rate).desc().nulls_last())

    rows = (await db.execute(query)).all()
    return [
        {
            "driver_name": r.driver_name,
            "loads": r.loads,
            "revenue": float(r.revenue or 0),
            "avg_rpm": round(float(r.avg_rpm), 2) if r.avg_rpm else None,
            "utilization": round(float(r.avg_utilization), 1) if r.avg_utilization else None,
        }
        for r in rows
    ]


@router.get("/recent-loads")
async def recent_loads(
    limit: int = 12,
    driver_name: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Load).where(Load.pickup_date.isnot(None))
    if driver_name:
        query = query.where(func.lower(Load.driver_name) == driver_name.lower())
    query = query.order_by(Load.pickup_date.desc()).limit(limit)

    rows = (await db.execute(query)).scalars().all()
    return [
        {
            "load_number": r.load_number,
            "driver": r.driver_name,
            "lane": _lane(r),
            "pickup_date": r.pickup_date.date().isoformat() if r.pickup_date else None,
            "rate": float(r.rate) if r.rate else None,
            "rpm": float(r.rpm) if r.rpm else None,
            "broker": r.broker_name,
        }
        for r in rows
    ]


def _lane(load: Load) -> str | None:
    origin = f"{load.pickup_city}, {load.pickup_state}" if load.pickup_city else None
    dest = f"{load.dropoff_city}, {load.dropoff_state}" if load.dropoff_city else None
    if origin and dest:
        return f"{origin} → {dest}"
    return origin or dest
