"""HTTPS fetches from users.rcc.uchicago.edu without disabling verification.

As of 2026-11 the RCC web server presents a certificate that expired on
2025-08-15, with an incomplete chain, so normal verification fails. The
code previously turned verification off entirely, which lets anyone on the
network path feed the dashboard forged reports (including the login
allowlist). Instead:

1. Try normal, fully verified TLS first. This works again automatically
   once RCC renews the certificate.
2. Only if verification fails, connect without CA checks, then require
   the server's public key to match a known pin (the same
   "sha256//<base64>" form curl's --pinnedpubkey uses) BEFORE sending the
   request. A different key, i.e. an impostor, is refused.

RCC_TLS_PIN (comma-separated) overrides the built-in pin.
"""
import base64
import hashlib
import http.client
import os
import ssl
import urllib.error
import urllib.request
from urllib.parse import urlsplit

# users.rcc.uchicago.edu key, recorded 2026-11-13 (cert valid 2024-08-15..2025-08-15).
DEFAULT_PINS = ("sha256//w6iqCvC9V4imthG/Tg+i3s46kYB0IZM7NVDvEHQ6SAs=",)


def _pins() -> set[str]:
    raw = os.environ.get("RCC_TLS_PIN", "")
    pins = {p.strip() for p in raw.split(",") if p.strip()}
    return pins or set(DEFAULT_PINS)


def _tlv(b: bytes, i: int) -> tuple[int, int, int]:
    """DER tag-length at offset i -> (tag, content_start, content_length)."""
    tag = b[i]
    n = b[i + 1]
    i += 2
    if n & 0x80:
        k = n & 0x7F
        n = int.from_bytes(b[i:i + k], "big")
        i += k
    return tag, i, n


def spki_pin(cert_der: bytes) -> str:
    """curl-style pin of the certificate's SubjectPublicKeyInfo."""
    _, tbs_start, _ = _tlv(cert_der, 0)           # Certificate ::= SEQUENCE
    _, pos, _ = _tlv(cert_der, tbs_start)         # tbsCertificate ::= SEQUENCE
    tag, cs, cl = _tlv(cert_der, pos)
    if tag == 0xA0:                               # [0] version (optional)
        pos = cs + cl
    for _ in range(5):                            # serial, sigAlg, issuer, validity, subject
        _, cs, cl = _tlv(cert_der, pos)
        pos = cs + cl
    _, cs, cl = _tlv(cert_der, pos)               # subjectPublicKeyInfo
    spki = cert_der[pos:cs + cl]
    return "sha256//" + base64.b64encode(hashlib.sha256(spki).digest()).decode()


def _is_verify_failure(e: Exception) -> bool:
    reason = getattr(e, "reason", e)
    return isinstance(reason, ssl.SSLCertVerificationError)


def _pinned_get(url: str, timeout: float, headers: dict[str, str]) -> bytes:
    u = urlsplit(url)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # authenticated by the pin below instead
    conn = http.client.HTTPSConnection(u.hostname, u.port or 443, timeout=timeout, context=ctx)
    try:
        conn.connect()
        der = conn.sock.getpeercert(binary_form=True)
        if not der or spki_pin(der) not in _pins():
            raise ssl.SSLError(f"TLS public key of {u.hostname} does not match the pinned key")
        path = (u.path or "/") + (f"?{u.query}" if u.query else "")
        conn.request("GET", path, headers={"Host": u.hostname, **headers})
        resp = conn.getresponse()
        if resp.status != 200:
            raise urllib.error.HTTPError(url, resp.status, resp.reason, resp.headers, None)
        return resp.read()
    finally:
        conn.close()


def fetch(url: str, timeout: float = 15, headers: dict[str, str] | None = None) -> bytes:
    """GET url: verified TLS, else pinned-key TLS. Raises on any failure."""
    headers = headers or {"User-Agent": "cil-tracker/1.0"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as resp:
            return resp.read()
    except (urllib.error.URLError, ssl.SSLError) as e:
        if not _is_verify_failure(e):
            raise
    return _pinned_get(url, timeout, headers)
