"""LLM service for natural language to SQL translation (Groq / llama-3.3-70b)."""
import json
import re
import urllib.request
import urllib.error

from app.settings import get_settings

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"

SYSTEM_PROMPT = """You are a ClickHouse SQL query generator for a filesystem snapshot database.

## Schema

**Table: filesystem.entries** (main table — every file and directory)
Columns:
- snapshot_date (Date) — partition key, ALWAYS required in WHERE
- path (String) — full absolute path, e.g. /project/cil/gcp/foo/bar.csv
- parent_path (String) — parent directory path
- name (String) — file or directory basename
- depth (UInt16) — path depth
- top_level_dir (String) — first directory component
- size (UInt64) — size in bytes
- file_type (String) — file extension (e.g. "csv", "py", "nc")
- is_directory (UInt8) — 0 = file, 1 = directory
- modified_time (UInt32) — Unix timestamp of last modification
- accessed_time (UInt32) — Unix timestamp of last access
- created_time (UInt32) — Unix timestamp of creation
- owner (String) — file owner username
- group_name (String) — file group name
- uid (UInt32) — user ID
- gid (UInt32) — group ID
- permissions (UInt16) — Unix permissions

**Table: filesystem.directory_recursive_sizes** (precomputed directory totals)
Columns:
- snapshot_date (Date)
- path (String) — directory path
- recursive_size_bytes (UInt64) — total size of all descendants
- recursive_file_count (UInt64) — count of all descendant files
- recursive_dir_count (UInt64) — count of all descendant directories
- direct_size_bytes (UInt64) — sum of immediate children sizes
- direct_file_count (UInt64) — count of immediate children files
- last_modified (UInt32), last_accessed (UInt32)

## ClickHouse function reference
- formatReadableSize(size) — converts bytes to human-readable (e.g. "1.23 GiB")
- startsWith(path, '/prefix/') — prefix match (use INSTEAD of LIKE 'prefix%')
- positionCaseInsensitive(name, 'pattern') > 0 — substring search (use INSTEAD of LIKE '%x%')
- toDateTime(unix_timestamp) — convert Unix timestamp to DateTime
- dateDiff('day', toDateTime(accessed_time), now()) — days since last access
- toUnixTimestamp(now() - INTERVAL 180 DAY) — for time-range filters on Unix timestamps
- splitByChar('/', path)[N] — extract Nth path component (1-indexed)
- count(), sum(), avg(), max(), min() — standard aggregates

## ClickHouse version: 24.1
Only use functions that exist in ClickHouse 24.1. Do NOT use groupArray, arrayJoin, or window functions unless certain they exist. Stick to the functions listed above.

## Rules — follow these EXACTLY
1. ONLY generate SELECT statements. Never INSERT, UPDATE, DELETE, DROP, or any DDL.
2. ALWAYS include: WHERE snapshot_date = %(snapshot_date)s
3. ALWAYS include a LIMIT clause. Default to small limits (20-100). Never exceed 1000.
4. Use startsWith() for path prefix matching, NOT LIKE with %.
5. Use positionCaseInsensitive() for substring search, NOT LIKE '%x%'.
6. Use formatReadableSize(size) AS readable_size when showing sizes to humans.
7. The snapshot_date parameter placeholder is %(snapshot_date)s — use exactly this syntax.
8. The main filesystem root is /project/cil/. Most paths start with this.
9. Return ONLY the raw SQL query. No explanations, no markdown fences, no commentary.
10. When filtering by time (e.g. "not accessed in 2 years"), compare accessed_time against toUnixTimestamp(now() - INTERVAL N DAY).
11. When asked about directory sizes, prefer filesystem.directory_recursive_sizes for efficiency.
12. Keep queries simple. Prefer basic GROUP BY, ORDER BY, and WHERE clauses. Avoid complex subqueries or CTEs when a simpler approach works.
"""


class GeminiError(Exception):
    """Raised when the LLM API call fails."""


def generate_sql(question: str) -> str:
    """Send a natural language question to Groq and return generated SQL.

    Args:
        question: Natural language question from the user.

    Returns:
        Generated SQL string.

    Raises:
        GeminiError: If the API call fails or returns no usable SQL.
    """
    settings = get_settings()

    if not settings.groq_api_key:
        raise GeminiError(
            "Groq API key not configured. Set GROQ_API_KEY environment variable."
        )

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": question},
        ],
        "temperature": 0,
        "max_tokens": 1024,
    }

    req = urllib.request.Request(
        GROQ_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.groq_api_key}",
            "User-Agent": "cil-rcc-tracker/1.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        raise GeminiError(f"Groq API returned {e.code}: {error_body}")
    except urllib.error.URLError as e:
        raise GeminiError(f"Failed to reach Groq API: {e.reason}")

    # Extract text from OpenAI-compatible response
    try:
        text = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise GeminiError("Unexpected Groq response format.")

    sql = _extract_sql(text)

    if not sql.strip():
        raise GeminiError("LLM returned empty SQL.")

    return sql.strip()


def fix_sql(failed_sql: str, error_message: str) -> str:
    """Send a failed SQL query + error to the LLM and ask it to fix it.

    Args:
        failed_sql: The SQL that failed execution.
        error_message: The error message from ClickHouse.

    Returns:
        Fixed SQL string.

    Raises:
        GeminiError: If the API call fails.
    """
    settings = get_settings()

    if not settings.groq_api_key:
        raise GeminiError(
            "Groq API key not configured. Set GROQ_API_KEY environment variable."
        )

    fix_prompt = (
        f"This ClickHouse SQL query failed:\n\n{failed_sql}\n\n"
        f"Error: {error_message}\n\n"
        "Fix the query. Return ONLY the corrected SQL, no explanations."
    )

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": fix_prompt},
        ],
        "temperature": 0,
        "max_tokens": 1024,
    }

    req = urllib.request.Request(
        GROQ_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.groq_api_key}",
            "User-Agent": "cil-rcc-tracker/1.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        raise GeminiError(f"Groq API returned {e.code}: {error_body}")
    except urllib.error.URLError as e:
        raise GeminiError(f"Failed to reach Groq API: {e.reason}")

    try:
        text = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise GeminiError("Unexpected Groq response format.")

    sql = _extract_sql(text)

    if not sql.strip():
        raise GeminiError("LLM returned empty SQL.")

    return sql.strip()


def _extract_sql(text: str) -> str:
    """Extract SQL from LLM response, stripping markdown code fences if present."""
    match = re.search(r"```(?:sql)?\s*\n?(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text.strip()
