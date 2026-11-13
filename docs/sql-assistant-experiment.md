# Self-hosted SQL assistant (future experiment, not started)

**Goal:** keep natural-language help in the SQL console without an
external AI API or an always-running inference server. A small quantized
language model runs **entirely in the user's browser**. It:

- understands analytical questions in plain language;
- writes SQL for the active backend: ClickHouse now, BigQuery if that
  experiment is adopted;
- adapts an existing query from one dialect to the other;
- reads query errors and proposes corrections, iteratively;
- uses the real schema and metadata as context;
- explains a query in plain language to users who don't know SQL.

The approach is **model-driven**: dialect adaptation and error correction
are done by the model, not by hand-written translation rules. The runtime
(WebLLM or Transformers.js) and the model are chosen later, on measured
accuracy, speed, browser coverage and resource needs.

**The model is never trusted for security.** Server-side validation,
read-only permissions, resource limits and cost controls stay exactly as
they are, independent of whatever wrote the query (§6).

**Today:**
- `POST /api/nl-to-sql` sends the question and schema prompt to Groq
  (`apps/api/app/services/gemini.py`).
- The answer is linted and guardrail-checked, then shown, not executed.
- Execution goes through `/api/query` as `tracker_api`, with ClickHouse
  limits.

## 1. Capabilities and how the model gets its context

The browser assembles the prompt; the model sees no data rows, only
descriptions.

| Capability | Prompt context | Output |
|---|---|---|
| Question → SQL | Schema for the active backend (tables, columns, types, one-line meaning each); key conventions (`snapshot_date` filter, `parent_path`/`path` prefix rules, size units); available snapshot dates; the dialect's allowed functions; 10–20 worked examples from real console usage | One `SELECT` in the active dialect |
| Adapt a query (ClickHouse ↔ BigQuery) | The query, both schemas, paired examples of the same query in both dialects | Equivalent query in the target dialect |
| Fix a failing query | The query, the server's validation message or database error (already returned today), the schema | Corrected query + one-line reason |
| Explain a query | The query, the schema meanings | Short plain-language explanation; no SQL needed to read it |

**Repair loop:** generate, then have the server validate (and, if valid,
dry-run or EXPLAIN). On an error, feed it back to the model. Stop after
2–3 rounds and show the last attempt and the error. Nothing runs without
the user pressing Run.

The schema and metadata context is generated from the backend itself
(`DESCRIBE`/`INFORMATION_SCHEMA`) plus a small hand-maintained
description file. It stays correct when tables change.

## 2. Runtimes

| | WebLLM (MLC) | Transformers.js (ONNX Runtime Web) |
|---|---|---|
| Acceleration | WebGPU only | WebGPU, automatic WASM (CPU) fallback |
| Models | Prebuilt q4f16 builds incl. Qwen2.5-Coder 0.5B / 1.5B / 3B / 7B | Any ONNX export with a supported architecture; q4f16 on WebGPU, q4 on WASM |
| Notes | Mature LLM chat API, KV cache, streaming | Broader device reach; some quantized ops fall back to slower paths on some GPUs |

## 3. Candidate models (to be measured, not chosen)

| Model | Approx. GPU memory* | Approx. download** | Expectation |
|---|---|---|---|
| Qwen2.5-Coder-0.5B-Instruct | about 0.95 GB | about 0.3–0.4 GB | Fast; weakest reasoning; only option on CPU/WASM |
| Qwen2.5-Coder-1.5B-Instruct | about 1.6 GB | about 0.9–1.0 GB | Likely the laptop sweet spot |
| Qwen2.5-Coder-3B-Instruct | about 2.5 GB | about 1.7–1.9 GB | Best accuracy that still fits common GPUs |
| Newer small coder/SQL models | — | — | Re-survey when the experiment starts |

\* WebLLM's published figures for same-size Qwen2.5 models at q4f16.
\*\* Estimated from parameter count at 4 bits; measure the real artifacts.

Published text-to-SQL results for fine-tuned 0.5–3B models are about
60–68% execution accuracy on BIRD dev and about 85% on Spider. Those are
research pipelines on unfamiliar multi-table schemas.
- **Easier here:** one domain, about 5 tables, examples from real use,
  and a repair loop.
- **Harder here:** dialect specifics.

Our own evaluation (§5) decides. If a base model falls short, the next
lever is fine-tuning a 1.5B model on our question/SQL pairs before
moving to a bigger model.

## 4. Browser compatibility and expected experience (2026-11; re-check)

| Platform | WebGPU |
|---|---|
| Chrome / Edge on Windows, macOS, ChromeOS | yes (since 113) |
| Chrome on Linux | Intel (144+) and NVIDIA (147+) GPUs; others may lack it |
| Chrome / Samsung Internet, Android 12+ (Qualcomm/ARM GPUs) | yes |
| Windows on ARM (Chromium) | behind a flag |
| Firefox on Windows, Apple-silicon macOS | yes (141+; macOS 145–147+) |
| Firefox on Linux, Android | pre-release builds only (Aug 2026) |
| Safari on macOS/iOS/iPadOS 26 | yes; not on iOS ≤ 25 |

`navigator.gpu` can exist while `requestAdapter()` returns null
(blocklisted driver, VM, remote desktop). Feature-detect, and compare
`adapter.limits` with the model's needs, before offering the assistant.

Estimates, to be replaced by measurements:
- **Download:** the 1.5B model (about 1 GB) takes about 3 min at
  50 Mbit/s. It downloads once, is cached in the browser, and only on
  opt-in ("Enable local assistant (≈1 GB)").
- **Load:** some seconds of shader compilation per session.
- **Generation (one query is about 80–200 tokens):**
  - WebGPU: published figures for 0.4–1.1B models are about 25–63
    tokens/s on discrete GPUs, less on integrated graphics and for 3B.
    Expect about 2–10 s per query.
  - WASM: about 1.6–5 tokens/s for small models, which is too slow for
    1.5B+.
- **Memory:** about 1.6–2.5 GB GPU memory for 1.5–3B, plus about 1 GB of
  page memory. That rules out many older laptops and most phones.

## 5. Evaluation (before any rollout)

- **Evaluation set:** about 100–150 (question, reference SQL) pairs.
  - Reference SQL comes from normalized real console queries
    (`system.query_log`, literals stripped, no paths). Each has a
    BigQuery twin.
  - Add paraphrases, ambiguous and cost-heavy questions, plus "fix this
    error" and "explain this" cases.
- **Metrics:**
  - execution accuracy on the anonymized dataset;
  - share valid on the first try and after the repair loop;
  - dialect-adaptation accuracy;
  - explanation correctness, rated by a reviewer;
  - p50/p95 latency and memory per device class (discrete GPU,
    integrated-GPU laptop, no WebGPU).
- **Baseline:** the current Groq setup, for comparison only.

## 6. Security and cost: independent of the model

The model only produces text. The server treats every generated query as
untrusted input, the same as a hand-typed one:

- **Parsing and guardrails:** one statement, read-only, allowlisted
  tables, no table functions, `SETTINGS` or `FORMAT`, a `snapshot_date`
  filter, a `LIMIT`.
- **ClickHouse:** runs as `tracker_api`, with `SELECT`-only grants and a
  settings profile pinning time, rows, bytes and memory. Clients cannot
  raise these limits.
- **BigQuery:**
  - a read-only service account;
  - a dry run first, which shows the estimated bytes and refuses above a
    threshold;
  - `maximum_bytes_billed` on every job;
  - per-day quotas;
  - tables partitioned and clustered so normal questions scan megabytes.
- **Rate limits and privacy:** per-client rate limits on execution. In
  the browser, questions never leave the user's device; the prompt holds
  schema and descriptions, not data.

## 7. Devices without WebGPU

In order:
1. A smaller model on WASM (0.5B), for short tasks such as explanation
   or small fixes, with a clear "slow on this device" notice.
2. The existing form-based query builder in the Search Console, which
   needs no model.
3. Optionally, an external API if explicitly configured. It is off by
   default once the local assistant is adopted. There is no
   always-running inference server.

## 8. Milestones (on a separate `experiment/` branch)

1. Evaluation set plus an offline scorer that can run any generator.
2. A schema/metadata context generator for both backends.
3. Browser prototype behind a feature flag. WebLLM and Transformers.js
   side by side with 2–3 candidate models, all four capabilities and the
   repair loop. Telemetry stays local to the session.
4. **Decision:** adopt if, on the target devices, execution accuracy
   (with repair) is at least the Groq baseline minus 10 points and median
   latency is under 10 s. Choose the runtime and model on those numbers
   and browser coverage.
