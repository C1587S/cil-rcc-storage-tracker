# shellcheck shell=bash
# rcc_curl: curl for users.rcc.uchicago.edu without blindly disabling TLS.
#
# The RCC web server's certificate expired on 2025-08-15 and its chain is
# incomplete, so normal verification fails. Scripts used `curl -k`, which
# lets anyone on the network path inject scan data. Instead, when this file
# is sourced, one probe decides the mode for the whole run:
#   verified - normal TLS works (e.g. after RCC renews): plain curl.
#   pinned   - certificate verification fails (curl exit 60/51): curl -k
#              with --pinnedpubkey, so only the server holding the pinned
#              key is accepted, before any data is exchanged (curl enforces
#              the pin even alongside -k).
# Deciding once avoids retrying individual calls, which would duplicate
# their -w output. Same pin as apps/api/app/rcc_tls.py; override with
# RCC_TLS_PIN (curl's "sha256//<base64>[;sha256//...]" syntax).
#
# Usage: source this file, then call rcc_curl with normal curl arguments.

RCC_TLS_PIN="${RCC_TLS_PIN:-sha256//w6iqCvC9V4imthG/Tg+i3s46kYB0IZM7NVDvEHQ6SAs=}"
RCC_TLS_HOST="${RCC_TLS_HOST:-users.rcc.uchicago.edu}"

if [ -z "${RCC_TLS_MODE:-}" ]; then
  _rcc_rc=0
  curl -sS -o /dev/null --max-time 20 "https://${RCC_TLS_HOST}/" 2>/dev/null || _rcc_rc=$?
  if [ "$_rcc_rc" -eq 60 ] || [ "$_rcc_rc" -eq 51 ]; then
    RCC_TLS_MODE=pinned
  else
    RCC_TLS_MODE=verified   # includes "unreachable": later calls fail normally
  fi
  unset _rcc_rc
fi

rcc_curl() {
  if [ "$RCC_TLS_MODE" = pinned ]; then
    curl -k --pinnedpubkey "$RCC_TLS_PIN" "$@"
  else
    curl "$@"
  fi
}
