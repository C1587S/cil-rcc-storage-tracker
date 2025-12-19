"""Query API endpoints for advanced SQL queries."""
from fastapi import APIRouter, HTTPException
from time import time
from app.db import execute_query_raw
from app.models import QueryRequest, QueryResponse
from app.services.guardrails import enforce_sql_guardrails, QueryValidationError

router = APIRouter(prefix="/api/query", tags=["query"])


@router.post("", response_model=QueryResponse)
async def execute_sql_query(request: QueryRequest):
    """
    Execute a user-provided SQL query with strict guardrails.

    Guardrails enforced:
    - Only SELECT queries allowed
    - No multiple statements
    - No DDL/DML keywords (INSERT, DELETE, etc.)
    - No external table functions (url, remote, s3, etc.)
    - Must include snapshot_date filter
    - LIMIT automatically enforced
    - Read-only mode enforced at connection level

    Args:
        request: Query request with SQL and parameters

    Returns:
        Query results with columns and rows
    """
    try:
        # Enforce guardrails
        sanitized_sql = enforce_sql_guardrails(request.sql, limit=request.limit)

        # Add snapshot_date parameter
        params = {"snapshot_date": request.snapshot_date.isoformat()}

        # Execute query and measure time
        start_time = time()
        rows, columns_with_types = execute_query_raw(sanitized_sql, params)
        execution_time_ms = (time() - start_time) * 1000

        # Extract column names
        column_names = [col[0] for col in columns_with_types]

        # Convert rows to lists (handle various types)
        row_data = []
        for row in rows:
            row_list = []
            for value in row:
                # Convert complex types to JSON-serializable format
                if isinstance(value, (list, tuple)):
                    row_list.append(list(value))
                elif isinstance(value, dict):
                    row_list.append(value)
                else:
                    row_list.append(value)
            row_data.append(row_list)

        return QueryResponse(
            snapshot_date=request.snapshot_date,
            sql=sanitized_sql,
            columns=column_names,
            rows=row_data,
            row_count=len(rows),
            execution_time_ms=execution_time_ms,
        )

    except QueryValidationError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Query validation failed",
                "message": str(e),
                "help": "Ensure your query is a SELECT statement with snapshot_date filter and LIMIT clause",
            },
        )
    except ValueError as e:
        # Pydantic validation errors (e.g., missing snapshot_date in request body)
        raise HTTPException(
            status_code=422,
            detail={
                "error": "Invalid request",
                "message": str(e),
                "help": "Request body must include 'snapshot_date' (YYYY-MM-DD), 'sql' (string), and 'limit' (integer)",
            },
        )
    except Exception as e:
        error_msg = str(e)
        # Provide helpful hints for common errors
        if "snapshot_date" in error_msg.lower():
            hint = "Make sure snapshot_date is included in WHERE clause as: WHERE snapshot_date = '2025-12-12'"
        elif "content-type" in error_msg.lower() or "json" in error_msg.lower():
            hint = "Set Content-Type header to 'application/json'"
        else:
            hint = "Check the query syntax and ensure all referenced columns exist"

        raise HTTPException(
            status_code=500,
            detail={"error": "Database error", "message": error_msg, "help": hint},
        )
