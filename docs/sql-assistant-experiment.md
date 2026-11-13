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

The approach is **model-driven, with a deterministic fallback**:

1. **The local LLM is the primary assistant.** It handles natural-language
   questions, SQL generation, dialect adaptation and iterative error
   correction.
2. **SQLGlot is an optional fallback** for translating existing SQL
   between ClickHouse and BigQuery. It is used when the model is
   unavailable (no WebGPU, not downloaded, too little memory) or when its
   adaptation fails validation.
3. **The manual SQL editor is always available**, with or without either
   of the above.

There are no external AI inference APIs and no third-party model hosting
at run time. Questions, SQL, schemas, paths, file names, usernames,
errors and results never leave infrastructure we control for AI
inference (§9). The runtime (WebLLM or Transformers.js) and the model are
chosen later, on measured accuracy, speed, browser coverage and resource
needs.

> Note: today's NL-to-SQL feature does send the question and the schema
> prompt (plus, for `/fix`, the failed SQL and error text) to Groq. It
> does not meet these requirements and is retired when the local
> assistant ships.

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
- **Targets are absolute** (§8), so the evaluation never needs to send
  questions or schema to an external model for comparison.

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

## 7. Fallbacks: model unavailable or failing

The goal is a seamless experience. Each step is offered automatically
when the previous one is not available:

| Need | Primary | Fallback |
|---|---|---|
| Question → SQL | Local LLM (WebGPU) | Small model on WASM (0.5B), with a "slow on this device" notice; then the form-based query builder in the Search Console |
| Adapt existing SQL between ClickHouse and BigQuery | Local LLM | **SQLGlot** transpilation (deterministic) |
| Fix an error | Local LLM repair loop | The server's validation/database message shown as-is; manual edit |
| Explain a query | Local LLM | — (the query stays editable) |
| Anything | — | **Manual SQL editor, always available** |

**SQLGlot as the fallback translator:**
- It is used only for dialect adaptation of a query that already
  exists.
- It runs where the server already runs Python (an endpoint such as
  `/api/sql/translate`, rate-limited). No inference server is needed.
- Its output goes through the same server validation as everything
  else.
- It is known to pass some ClickHouse functions through untranslated
  (e.g. `isNaN`, `arrayReverse`, `JSONExtractString`), and it does not
  detect semantic differences such as integer division, NULL ordering
  or time zones. The UI marks the result as "translated automatically —
  review before running", and a validation failure is shown with the
  translated text.
- A small project test suite (pairs of known-equivalent queries from the
  evaluation set) checks the dialect pairs the dashboard relies on.

An external AI API is not part of the design and is not kept as an
option.

## 8. Milestones (on a separate `experiment/` branch)

1. Evaluation set plus an offline scorer that can run any locally hosted
   generator.
2. A schema/metadata context generator for both backends.
3. A model-asset pipeline (§9): pinned revision, checksums, license
   files, upload to our own storage.
4. Browser prototype behind a feature flag. WebLLM and Transformers.js
   side by side with 2–3 candidate models, all four capabilities and the
   repair loop. CSP enforcing first-party-only connections. Telemetry,
   if any, stays local to the session.
5. **Decision:** adopt if, on the target devices:
   - execution accuracy with repair is at least 70% on the evaluation
     set (initial proposal, to be confirmed once the set exists);
   - dialect adaptation of at least 90% of console queries validates;
   - median latency is under 10 s;
   - a network audit shows no request leaves our origins.

   Choose the runtime and model on those numbers and browser coverage.

## 9. Privacy: model assets and inference stay on our infrastructure

**Requirement:** sensitive lab information never needs to leave our
controlled environment for AI inference. Normal authenticated
communication between the browser and our own API/database is fine.

### What is never sent to third parties

User questions, generated SQL, schemas, directory paths, file names,
usernames, query errors and query results. That includes no OpenAI,
Anthropic, Hugging Face Inference API or other inference endpoint, and no
AI telemetry or analytics.

### Model assets: obtained once, then served by us

- **Obtain during development only.** Download one candidate from its
  source (e.g. Hugging Face) at a **pinned revision** (commit hash, not a
  branch name), after checking its license.
- **Asset manifest (small, committed):** model id, source revision, the
  runtime (WebLLM library build or ONNX export), file list, SHA-256 of
  every file, license name and file. The binaries themselves are **not**
  committed to Git (about 0.3–2 GB).
- **Reproducible deploy:** one script downloads the pinned revision,
  verifies every SHA-256 against the manifest, and uploads to our
  storage. Use first-party object storage behind our domain now (e.g. an
  R2 bucket on a route of the dashboard domain), and the same domain or
  approved institutional storage under UChicago hosting.
- **Serving:** same origin as the app (e.g. `/models/<id>/<revision>/…`),
  with immutable cache headers, HTTP range support, the correct
  `application/wasm` type, and COOP/COEP headers (cross-origin isolation
  enables multithreaded WASM for the CPU fallback).
- **Integrity in the browser:** the loader fetches the manifest from our
  origin and verifies each file's SHA-256 before handing it to the
  runtime. A mismatch aborts with a clear message.
- **Opt-in download:** the dashboard never downloads a model just
  because a page opened. The user enables the assistant and sees the size
  first.

### Licensing (verify per candidate before selection)

Redistribution terms decide whether we may host the weights. Many
small coder models are Apache-2.0, which allows redistribution with the
LICENSE/NOTICE files. Some sizes in the same family use more restrictive
research licenses. For example, check whether the 3B Qwen2.5-Coder
variant differs from the 0.5B/1.5B/7B. The asset manifest records the
license, and the license files are served next to the weights.

### Runtime configuration without third-party requests

- **WebLLM:** supply our own `appConfig.model_list`, with the model
  weights URL and the compiled model library (`model_lib` `.wasm`) both
  pointing to our origin. Do not use the prebuilt list, which points at
  public hosts.
- **Transformers.js:** set `env.allowRemoteModels = false`,
  `env.localModelPath = '/models/'`, and point
  `env.backends.onnx.wasm.wasmPaths` at self-hosted ONNX Runtime files.
  By default these runtime files come from a public CDN, so this must be
  set explicitly.
- **Belt and braces:** a Content-Security-Policy with
  - `connect-src 'self'` (plus our API, if on another first-party
    origin);
  - `script-src 'self' 'wasm-unsafe-eval'`;
  - `worker-src 'self' blob:`.

  The browser then blocks any third-party fetch, even if a library
  default changes. Roll it out as `Content-Security-Policy-Report-Only`
  first, with reports sent to our own endpoint, then enforce.
- **Verification:** an automated browser test that loads the assistant,
  runs a question, and fails if any request goes to an origin other than
  ours.

### Offline and caching

- After the first download, weights stay in the browser cache (Cache API
  or IndexedDB). Inference then works offline; only running the query
  needs our API.
- A versioned cache key, the model id plus revision, makes upgrades
  explicit and lets old versions be evicted.

### No accidental disclosure through logs or errors

- **Client:** no third-party error reporting or analytics in the app (none
  today; keep it that way). Prompts, schemas and generated SQL are not
  written to the console in production builds.
- **Server:**
  - Generated SQL reaches the API only when the user runs or validates
    it, in a POST body, which is not logged by the proxy (it logs only
    URLs).
  - Server errors already return reference ids instead of internals.
  - The schema/metadata endpoint that feeds the prompt returns structure
    and descriptions only, under the same access rules as the rest of the
    API.

### Unchanged: security does not depend on the model

Final query authorization, read-only enforcement, execution limits and
BigQuery cost controls stay on the server (§6). The model only proposes
text.
