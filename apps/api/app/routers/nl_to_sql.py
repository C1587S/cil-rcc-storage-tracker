"""Natural language to SQL translation endpoint."""
import asyncio

from fastapi import APIRouter, HTTPException

from app.models import NLToSQLRequest, NLToSQLResponse, FixSQLRequest
from app.services.gemini import generate_sql, fix_sql, GeminiError
from app.services.guardrails import enforce_sql_guardrails, QueryValidationError

router = APIRouter(prefix="/api/nl-to-sql", tags=["nl-to-sql"])


@router.post("", response_model=NLToSQLResponse)
async def nl_to_sql(request: NLToSQLRequest):
    """Translate a natural language question to a ClickHouse SQL query.

    The generated SQL is validated through existing guardrails but NOT executed.
    The frontend displays the SQL for user review before running it via /api/query.
    """
    try:
        raw_sql = await asyncio.to_thread(generate_sql, request.question)
        validated_sql = enforce_sql_guardrails(raw_sql, limit=5000)

        return NLToSQLResponse(
            question=request.question,
            sql=validated_sql,
            snapshot_date=request.snapshot_date,
        )

    except GeminiError as e:
        raise HTTPException(
            status_code=502,
            detail={"error": "AI generation failed", "message": str(e)},
        )
    except QueryValidationError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "Generated SQL failed validation",
                "message": str(e),
                "help": "The AI generated an unsafe query. Try rephrasing your question.",
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "Unexpected error", "message": str(e)},
        )


@router.post("/fix", response_model=NLToSQLResponse)
async def fix_failed_sql(request: FixSQLRequest):
    """Send a failed SQL query + error back to the LLM to fix it."""
    try:
        raw_sql = await asyncio.to_thread(fix_sql, request.sql, request.error)
        validated_sql = enforce_sql_guardrails(raw_sql, limit=5000)

        return NLToSQLResponse(
            question=f"Fix: {request.error[:100]}",
            sql=validated_sql,
            snapshot_date=request.snapshot_date,
        )

    except GeminiError as e:
        raise HTTPException(
            status_code=502,
            detail={"error": "AI fix failed", "message": str(e)},
        )
    except QueryValidationError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "Fixed SQL failed validation",
                "message": str(e),
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "Unexpected error", "message": str(e)},
        )
