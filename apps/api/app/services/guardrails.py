"""SQL query guardrails and validation."""
import re


# Forbidden DDL/DML keywords
FORBIDDEN = re.compile(
    r"\b(INSERT|ALTER|DELETE|DROP|TRUNCATE|OPTIMIZE|SYSTEM|CREATE|ATTACH|DETACH)\b",
    re.IGNORECASE,
)

# Forbidden external table functions
DENY_FUNCS = re.compile(
    r"\b(url|remote|s3|file|input|mysql|jdbc|odbc|hdfs)\s*\(",
    re.IGNORECASE,
)

# Forbidden format/output overrides
DENY_OUTPUT = re.compile(
    r"\b(INTO\s+OUTFILE|FORMAT\s+\w+)\b",
    re.IGNORECASE,
)


class QueryValidationError(ValueError):
    """Raised when a query fails validation."""

    pass


def enforce_sql_guardrails(sql: str, limit: int = 5000) -> str:
    """
    Enforce strict SQL guardrails for user-provided queries.

    Rules enforced:
    1. Only SELECT queries allowed
    2. No multiple statements (semicolons)
    3. No forbidden DDL/DML keywords
    4. No external table functions
    5. Must include snapshot_date filter
    6. Auto-append LIMIT if missing
    7. No output redirection

    Args:
        sql: User-provided SQL query
        limit: Maximum LIMIT to enforce

    Returns:
        Validated and sanitized SQL query

    Raises:
        QueryValidationError: If query fails validation
    """
    s = sql.strip()

    # Check for multiple statements
    if ";" in s:
        raise QueryValidationError("Multiple statements are not allowed.")

    # Must be SELECT only
    if not s.lower().startswith("select"):
        raise QueryValidationError("Only SELECT queries are allowed.")

    # Check for forbidden keywords
    if FORBIDDEN.search(s):
        raise QueryValidationError("Forbidden DDL/DML keywords detected (INSERT, ALTER, DELETE, DROP, etc.).")

    # Check for forbidden functions
    if DENY_FUNCS.search(s):
        raise QueryValidationError("Forbidden table functions detected (url, remote, s3, file, etc.).")

    # Check for output redirection
    if DENY_OUTPUT.search(s):
        raise QueryValidationError("Output redirection (INTO OUTFILE, FORMAT overrides) is not allowed.")

    # Require snapshot_date filter (case-insensitive)
    if not re.search(r"\bsnapshot_date\b", s, re.IGNORECASE):
        raise QueryValidationError("Query must include a snapshot_date filter.")

    # Auto-append LIMIT if missing
    if not re.search(r"\bLIMIT\b", s, re.IGNORECASE):
        s = f"{s}\nLIMIT {limit}"
    else:
        # Validate existing LIMIT doesn't exceed max
        limit_match = re.search(r"\bLIMIT\s+(\d+)", s, re.IGNORECASE)
        if limit_match:
            user_limit = int(limit_match.group(1))
            if user_limit > limit:
                # Replace with max allowed limit
                s = re.sub(
                    r"\bLIMIT\s+\d+",
                    f"LIMIT {limit}",
                    s,
                    flags=re.IGNORECASE,
                )

    return s


def validate_scope_path(path: str) -> str:
    """
    Validate and sanitize a scope path.

    Args:
        path: User-provided path

    Returns:
        Sanitized path

    Raises:
        QueryValidationError: If path is invalid
    """
    if not path:
        raise QueryValidationError("Scope path cannot be empty.")

    # Must be absolute path
    if not path.startswith("/"):
        raise QueryValidationError("Scope path must be absolute (start with /).")

    # Basic path traversal protection
    if ".." in path:
        raise QueryValidationError("Path traversal (..) is not allowed.")

    # Remove trailing slash for consistency (except root)
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")

    return path
