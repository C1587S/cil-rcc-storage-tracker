"""RCC fetches: verified TLS, else only the pinned key. Offline tests.

Run from apps/api: python3 -m unittest discover -s tests
"""
import os
import pathlib
import ssl
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app import rcc_tls  # noqa: E402

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "users.rcc.uchicago.edu.pem"


class TestPin(unittest.TestCase):
    def test_spki_pin_matches_openssl(self):
        # openssl x509 -pubkey | openssl pkey -pubin -outform der | sha256 | base64
        der = ssl.PEM_cert_to_DER_cert(FIXTURE.read_text())
        self.assertEqual(rcc_tls.spki_pin(der), rcc_tls.DEFAULT_PINS[0])

    def test_env_override(self):
        with mock.patch.dict(os.environ, {"RCC_TLS_PIN": "sha256//a=, sha256//b="}):
            self.assertEqual(rcc_tls._pins(), {"sha256//a=", "sha256//b="})


class FakeSock:
    def __init__(self, der):
        self._der = der

    def getpeercert(self, binary_form=False):
        return self._der


class TestPinnedFallback(unittest.TestCase):
    def _conn(self, der):
        conn = mock.MagicMock()
        conn.sock = FakeSock(der)
        conn.getresponse.return_value.status = 200
        conn.getresponse.return_value.read.return_value = b'{"ok": 1}'
        return conn

    def test_mismatched_key_is_refused_before_any_request(self):
        conn = self._conn(b"\x30\x03\x02\x01\x00")  # not the pinned cert
        with mock.patch("http.client.HTTPSConnection", return_value=conn), \
             mock.patch.object(rcc_tls, "spki_pin", return_value="sha256//other="):
            with self.assertRaises(ssl.SSLError):
                rcc_tls._pinned_get("https://users.rcc.uchicago.edu/x.json", 5, {})
        conn.request.assert_not_called()

    def test_pinned_key_is_accepted(self):
        der = ssl.PEM_cert_to_DER_cert(FIXTURE.read_text())
        conn = self._conn(der)
        with mock.patch("http.client.HTTPSConnection", return_value=conn):
            body = rcc_tls._pinned_get("https://users.rcc.uchicago.edu/x.json?a=1", 5, {})
        self.assertEqual(body, b'{"ok": 1}')
        self.assertEqual(conn.request.call_args[0][:2], ("GET", "/x.json?a=1"))

    def test_fallback_only_on_verification_failure(self):
        import urllib.error
        other = urllib.error.URLError(ConnectionRefusedError())
        with mock.patch("urllib.request.urlopen", side_effect=other), \
             mock.patch.object(rcc_tls, "_pinned_get") as pinned:
            with self.assertRaises(urllib.error.URLError):
                rcc_tls.fetch("https://users.rcc.uchicago.edu/x")
            pinned.assert_not_called()


if __name__ == "__main__":
    unittest.main()
