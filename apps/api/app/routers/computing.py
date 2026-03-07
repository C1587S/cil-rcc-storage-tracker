"""Computing monitoring API — live data proxy + historical ingestion."""
import json
import time
import urllib.request
import ssl
from datetime import date
from fastapi import APIRouter, HTTPException

from app.settings import get_settings

router = APIRouter(prefix="/api/computing", tags=["computing"])

# In-memory cache for the live report
_cache: dict = {"data": None, "ts": 0}
_CACHE_TTL = 300  # 5 minutes


def _fetch_report() -> dict | None:
    """Fetch latest report from RCC, with caching."""
    now = time.time()
    if _cache["data"] and (now - _cache["ts"]) < _CACHE_TTL:
        return _cache["data"]

    settings = get_settings()
    url = settings.computing_report_url
    if not url:
        return None

    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(url, headers={"User-Agent": "cil-tracker/1.0"})
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            data = json.loads(resp.read().decode())
        _cache["data"] = data
        _cache["ts"] = now
        return data
    except Exception:
        # Return stale cache if available
        if _cache["data"]:
            return _cache["data"]
        return None


def _get_write_client():
    """Get a ClickHouse client that can write (no readonly)."""
    from clickhouse_driver import Client
    settings = get_settings()
    return Client(
        host=settings.clickhouse_host,
        port=settings.clickhouse_port,
        user=settings.clickhouse_user,
        password=settings.clickhouse_password,
    )


@router.get("/latest")
async def get_latest_report():
    """Return the latest computing report from RCC (cached 5 min)."""
    import asyncio
    data = await asyncio.to_thread(_fetch_report)
    if not data:
        raise HTTPException(status_code=503, detail="Computing report unavailable")
    return data


@router.post("/ingest")
async def ingest_latest():
    """Fetch latest report and store historical data in ClickHouse."""
    import asyncio
    data = await asyncio.to_thread(_fetch_report)
    if not data:
        raise HTTPException(status_code=503, detail="No report to ingest")

    today = date.today()

    try:
        client = _get_write_client()

        # SU summary (from combined or midway3 which has burn rate)
        combined_su = data.get("combined", {}).get("service_units", {})
        if combined_su.get("allocated"):
            client.execute(
                "INSERT INTO computing.su_summary_daily VALUES",
                [{
                    "date": today,
                    "su_allocated": combined_su.get("allocated") or 0,
                    "su_consumed": combined_su.get("consumed") or 0,
                    "su_remaining": combined_su.get("remaining") or 0,
                    "su_burn_rate": combined_su.get("burn_rate_per_day") or 0,
                }]
            )

        # SU by user (prefer midway3 which has all users)
        clusters = data.get("clusters", {})
        m3 = clusters.get("midway3") or clusters.get("midway2")
        if m3:
            su_by_user = m3.get("service_units", {}).get("by_user", [])
            if su_by_user:
                rows = [{"date": today, "user": u["user"], "su_consumed": u["consumed"]}
                        for u in su_by_user if u.get("user")]
                if rows:
                    client.execute("INSERT INTO computing.su_usage_daily VALUES", rows)

        # Quotas from all clusters
        for cluster_name, cluster_data in clusters.items():
            if not cluster_data:
                continue
            quota = cluster_data.get("quota")
            if not quota:
                continue
            filesystems = quota.get("filesystems", [])
            rows = []
            for fs in filesystems:
                rows.append({
                    "date": today,
                    "cluster": cluster_name,
                    "filesystem": fs.get("filesystem", ""),
                    "quota_type": fs.get("type", ""),
                    "space_used_gb": fs.get("space_used_gb") or 0,
                    "space_limit_gb": fs.get("space_limit_gb") or 0,
                    "space_pct": fs.get("space_pct") or 0,
                    "files_used": fs.get("files_used") or 0,
                    "files_limit": fs.get("files_limit") or 0,
                    "files_pct": fs.get("files_pct") or 0,
                })
            if rows:
                client.execute("INSERT INTO computing.quota_daily VALUES", rows)

        return {"status": "ok", "date": today}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")


@router.get("/history/su")
async def su_history(days: int = 90):
    """SU summary over time."""
    from app.db import execute_query
    rows = execute_query(
        "SELECT date, su_allocated, su_consumed, su_remaining, su_burn_rate "
        "FROM computing.su_summary_daily "
        "WHERE date >= today() - %(days)s "
        "ORDER BY date",
        {"days": days}
    )
    return rows


@router.get("/history/su-by-user")
async def su_by_user_history(days: int = 90):
    """SU usage per user over time."""
    from app.db import execute_query
    rows = execute_query(
        "SELECT date, user, su_consumed "
        "FROM computing.su_usage_daily "
        "WHERE date >= today() - %(days)s "
        "ORDER BY date, user",
        {"days": days}
    )
    return rows


@router.get("/history/quotas")
async def quota_history(days: int = 90):
    """Quota usage over time."""
    from app.db import execute_query
    rows = execute_query(
        "SELECT date, cluster, filesystem, quota_type, "
        "space_used_gb, space_limit_gb, space_pct, "
        "files_used, files_limit, files_pct "
        "FROM computing.quota_daily "
        "WHERE date >= today() - %(days)s "
        "ORDER BY date, cluster, filesystem",
        {"days": days}
    )
    return rows
