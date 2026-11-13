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


_ARITH_TOKEN = re.compile(r"\d+|[+\-*]")
# number (op number)*, whitespace only around operators: "5 5" is not 55
_ARITH_SHAPE = re.compile(r"\s*\d+(?:\s*[+\-*]\s*\d+)*\s*")
_MAX_OPERAND_DIGITS = 9
_MAX_RESULT = 10**9


def _safe_int_arith(expr: str):
    """Evaluate `a*b+c-d` style integer arithmetic; None if not that shape.

    Deliberately not eval(): only non-negative integer literals joined by
    single +, - or * are accepted (no `**`, no unary operators), operands are
    bounded in length and the result in magnitude, so no input can make the
    linter burn CPU or memory.
    """
    if not _ARITH_SHAPE.fullmatch(expr):
        return None
    tokens = _ARITH_TOKEN.findall(expr)  # alternates number, op, number, ...
    if any(t.isdigit() and len(t) > _MAX_OPERAND_DIGITS for t in tokens):
        return None
    total, term, sign = 0, int(tokens[0]), 1
    for op, num in zip(tokens[1::2], tokens[2::2]):
        n = int(num)
        if op == "*":
            term *= n
        else:
            total += sign * term
            sign, term = (1 if op == "+" else -1), n
        if abs(term) > _MAX_RESULT or abs(total) > _MAX_RESULT:
            return None
    total += sign * term
    return total if abs(total) <= _MAX_RESULT else None


def lint_clickhouse_sql(sql: str) -> str:
    """Auto-fix common LLM mistakes that produce invalid ClickHouse SQL.

    Applied between AI generation and guardrails validation. Fixes syntax
    that the LLM tends to get wrong (PostgreSQL/MySQL habits).
    """
    s = sql.strip()

    # Remove trailing semicolons (LLM often adds them, guardrails reject them)
    s = s.rstrip(";").strip()

    # Strip multiple statements: keep only the first SELECT
    # (LLM sometimes prepends SET statements or adds comments with semicolons)
    if ";" in s:
        parts = [p.strip() for p in s.split(";") if p.strip()]
        select_parts = [p for p in parts if p.upper().lstrip().startswith("SELECT")]
        if select_parts:
            s = select_parts[0]

    # Fix DATEDIFF(DAY, ...) -> dateDiff('day', ...)
    # PostgreSQL: DATEDIFF(DAY, a, b)  ClickHouse: dateDiff('day', a, b)
    s = re.sub(
        r"\bDATEDIFF\s*\(\s*(YEAR|MONTH|WEEK|DAY|HOUR|MINUTE|SECOND)\s*,",
        lambda m: f"dateDiff('{m.group(1).lower()}',",
        s,
        flags=re.IGNORECASE,
    )

    # Fix INTERVAL N DAY -> INTERVAL N DAY (ensure proper spacing)
    # Also fix: INTERVAL 5*365 DAY -> INTERVAL 1825 DAY
    def fix_interval_expr(m):
        expr = m.group(1).strip()
        unit = m.group(2).upper()
        # Evaluate simple arithmetic like 5*365, 2*30
        val = _safe_int_arith(expr)
        if val is None:
            return m.group(0)
        return f"INTERVAL {val} {unit}"

    s = re.sub(
        r"\bINTERVAL\s+([\d\s\*\+\-]+)\s+(YEAR|MONTH|WEEK|DAY|HOUR|MINUTE|SECOND)\b",
        fix_interval_expr,
        s,
        flags=re.IGNORECASE,
    )

    # Fix CURRENT_DATE -> today()
    s = re.sub(r"\bCURRENT_DATE\b", "today()", s, flags=re.IGNORECASE)

    # Fix CURRENT_TIMESTAMP -> now()
    s = re.sub(r"\bCURRENT_TIMESTAMP\b", "now()", s, flags=re.IGNORECASE)

    # Fix NOW() with no args (some LLMs capitalize differently)
    # Already valid in CH, but ensure lowercase for consistency
    s = re.sub(r"\bNOW\s*\(\s*\)", "now()", s, flags=re.IGNORECASE)

    # Fix LIKE '%pattern%' -> positionCaseInsensitive(col, 'pattern') > 0
    # Only for simple cases: WHERE col LIKE '%word%'
    s = re.sub(
        r"(\w+)\s+LIKE\s+'%([^%']+)%'",
        r"positionCaseInsensitive(\1, '\2') > 0",
        s,
        flags=re.IGNORECASE,
    )

    # Fix LIKE 'prefix%' -> startsWith(col, 'prefix')
    s = re.sub(
        r"(\w+)\s+LIKE\s+'([^%']+)%'",
        r"startsWith(\1, '\2')",
        s,
        flags=re.IGNORECASE,
    )

    # Fix EXTRACT(YEAR FROM ...) -> toYear(...)
    s = re.sub(
        r"\bEXTRACT\s*\(\s*YEAR\s+FROM\s+([^)]+)\)",
        r"toYear(\1)",
        s,
        flags=re.IGNORECASE,
    )
    s = re.sub(
        r"\bEXTRACT\s*\(\s*MONTH\s+FROM\s+([^)]+)\)",
        r"toMonth(\1)",
        s,
        flags=re.IGNORECASE,
    )

    # Fix DATE_TRUNC('day', ...) -> toStartOfDay(...)
    s = re.sub(
        r"\bDATE_TRUNC\s*\(\s*'day'\s*,\s*([^)]+)\)",
        r"toStartOfDay(\1)",
        s,
        flags=re.IGNORECASE,
    )

    # Fix COALESCE with 0 for numeric -> use ifNull (more idiomatic CH)
    # Leave COALESCE as-is since CH supports it

    # Fix LENGTH() -> length() (case normalization)
    s = re.sub(r"\bLENGTH\s*\(", "length(", s, flags=re.IGNORECASE)

    # Fix LOWER() -> lower()
    s = re.sub(r"\bLOWER\s*\(", "lower(", s, flags=re.IGNORECASE)

    # Fix UPPER() -> upper()
    s = re.sub(r"\bUPPER\s*\(", "upper(", s, flags=re.IGNORECASE)

    return s


def enforce_sql_guardrails(sql: str, limit: int = 8000) -> str:
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
