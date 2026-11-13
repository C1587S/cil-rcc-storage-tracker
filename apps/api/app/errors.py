"""Server errors without leaking internals to clients.

Exception text from ClickHouse, Postgres or the filesystem can carry
hostnames, account names, paths and query fragments. Clients get a short
reference; the full traceback goes to the server log under that reference.
"""
import logging
import secrets

from fastapi import HTTPException

log = logging.getLogger("app.errors")


def internal_error(what: str, exc: BaseException, status_code: int = 500) -> HTTPException:
    """Log `exc` with a reference id and return a generic HTTPException.

    Call inside the `except` block:  raise internal_error("Database error", e) from e
    """
    ref = secrets.token_hex(4)
    log.error("%s [ref %s]", what, ref, exc_info=exc)
    return HTTPException(status_code=status_code, detail=f"{what} (ref {ref}; details in the server log)")
