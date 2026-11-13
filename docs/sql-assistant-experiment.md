# Self-hosted SQL assistant (future experiment, not started)

**Goal:** keep natural-language query help in the SQL console without
sending questions to an external AI API. A nontechnical user describes
what they want and receives a valid, read-only query for whichever
analytical backend is active (ClickHouse now, possibly BigQuery later).

**Today:**
- `POST /api/nl-to-sql` sends the question, plus the schema prompt, to
  Groq (`apps/api/app/services/gemini.py`).
- The answer is linted (`lint_clickhouse_sql`) and checked by the
  guardrails. It is shown to the user, not executed.
- Execution goes through `/api/query`, as `tracker_api`, with ClickHouse
  limits.

**This does not change:** whatever generates SQL, the server stays the
only authority. Every generated query is re-validated and runs under the
read-only account and limits.

## 1. Two complementary pieces

### SQLGlot: deterministic dialect translation and validation

- **Translate** between the dialect the model writes and the dialect of
  the active backend (ClickHouse ↔ BigQuery), on the server, in Python.
  Exact mappings are covered by tests; no model is involved.
- **Validate structure before any database sees the query.** Parse it into
  an AST and enforce:
  - exactly one `SELECT` (or `WITH … SELECT`);
  - only allowlisted tables;
  - no table functions, `SETTINGS`, `FORMAT` or `INTO OUTFILE`;
  - a `snapshot_date` predicate on `entries`;
  - a `LIMIT`.

  This is sturdier than today's regex guardrails, which stay as a second
  layer.
- **Known limits:**
  - Some ClickHouse functions pass through untranslated to BigQuery (e.g.
    `isNaN`, `arrayReverse`, `JSONExtractString`, as reported in sqlglot
    issues).
  - Semantic differences (integer division, NULL ordering, time zones,
    implicit casts) are not detected.
  - Mitigation: a project-specific function map with tests (the
    BigQuery-experiment table), an allowlist of functions the assistant
    may emit, and execution checks on the anonymized dataset.

### A small quantized model, ideally in the browser

The model writes SQL in one canonical dialect (ClickHouse, matching the
existing prompt and examples). SQLGlot handles the rest.

| Candidate (WebLLM q4f16 builds exist) | Approx. GPU memory* | Approx. download** | Fit |
|---|---|---|---|
| Qwen2.5-Coder-0.5B-Instruct | about 0.95 GB | about 0.3–0.4 GB | Fast. Weakest SQL; candidate for the CPU fallback |
| Qwen2.5-Coder-1.5B-Instruct | about 1.6 GB | about 0.9–1.0 GB | Likely sweet spot for laptops |
| Qwen2.5-Coder-3B-Instruct | about 2.5 GB | about 1.7–1.9 GB | Best accuracy that still fits common GPUs |

\* WebLLM's published VRAM figures for the same-size Qwen2.5 Instruct
models; the Coder variants are similar. \*\* Estimated from parameter
count at 4-bit; measure the real artifacts.

Text-to-SQL-specific fine-tunes of 0.5–3B models report about 60–68%
execution accuracy on BIRD dev and about 85% on Spider. Those are
research pipelines on unfamiliar multi-table schemas.
- **Easier here:** one domain, about 5 tables, well-known column
  meanings, and examples drawn from real console usage.
- **Harder here:** ClickHouse dialect specifics.

Accuracy must therefore be measured on our own evaluation set (§4), not
taken from benchmarks.

**Runtimes:**
- **WebLLM (MLC):** has prebuilt Qwen2.5-Coder 0.5B–7B builds. It needs
  WebGPU and offers no CPU path.
- **Transformers.js (ONNX Runtime Web):** uses WebGPU when available and
  falls back to WASM automatically. Use q4f16 on WebGPU and q4 on WASM.

## 2. Browser compatibility (as of 2026-11; re-check)

| Platform | WebGPU |
|---|---|
| Chrome / Edge, Windows · macOS · ChromeOS | yes (since 113) |
| Chrome, Linux | Intel (144+) and NVIDIA (147+) GPUs; others may lack it |
| Chrome / Samsung Internet, Android 12+ (Qualcomm/ARM GPUs) | yes |
| Windows on ARM (Chromium) | behind a flag |
| Firefox, Windows · Apple-silicon macOS | yes (141+, macOS 145–147+) |
| Firefox, Linux · Android | pre-release builds only (Aug 2026) |
| Safari, macOS/iOS/iPadOS 26 | yes; not on iOS ≤ 25 |

Even where `navigator.gpu` exists, `requestAdapter()` can return null
(blocklisted driver, VM, remote desktop). The app must feature-detect and
check `adapter.limits` against the model's needs before offering
in-browser generation.

## 3. Expected experience (estimates to be replaced by measurements)

- **Download:**
  - The 1.5B model (about 1 GB) takes about 3 min at 50 Mbit/s.
  - It happens once, is cached (Cache API / IndexedDB), and is opt-in
    ("Enable local assistant (1 GB)"), never automatic.
- **Load:** some seconds of shader compilation per session.
- **Generation (one query is about 80–200 tokens):**
  - WebGPU: published browser numbers for 0.4–1.1B models are about
    25–63 tokens/s on discrete GPUs, slower on integrated graphics and for
    3B. Expect about 2–10 s per query.
  - WASM: about 1.6–5 tokens/s for small models, which is too slow for
    1.5B+ (minutes).
- **Memory:** about 1.6–2.5 GB of GPU memory for 1.5–3B models, plus about
  1 GB of page memory. That excludes many older laptops and most phones.

## 4. Evaluation before any rollout

- **Evaluation set:** about 100–150 (question, reference SQL) pairs.
  - Reference SQL comes from normalized real console queries in
    `system.query_log`, with literals stripped and no paths. Questions
    are written for them.
  - Add held-out paraphrases and "trick" questions (cost-heavy,
    ambiguous).
- **Metric:** execution accuracy on the anonymized dataset (same result
  as the reference), plus:
  - the share of outputs that pass validation;
  - the share fixed by one automatic repair round, in which validation or
    ClickHouse errors are fed back to the model, as `/nl-to-sql/fix` does
    today;
  - p50/p95 latency per device class.
- **Compare:** current Groq model (baseline) vs. 0.5B/1.5B/3B in-browser
  vs. the same models server-side on CPU (llama.cpp), on 3 device classes
  (discrete GPU, integrated GPU laptop, no WebGPU).
- **Quality levers before choosing a bigger model:**
  - Schema plus 10–20 real examples in the prompt.
  - Constrained output (one statement, allowlisted functions).
  - A repair loop.
  - Optionally, fine-tuning a 1.5B model on the evaluation set's
    training split.

## 5. Fallback chain (no WebGPU, too little memory, or user declines the download)

1. In-browser model (WebGPU), if feature-detected and sufficient.
2. A self-hosted small model on the server (llama.cpp, CPU, 0.5–1.5B
   q4). Questions stay on infrastructure we control. Needs one modest
   always-on or scale-to-zero container. It fits the hosting plan only if
   kept small.
3. The existing form-based query builder in the Search Console, which
   builds SQL without any model.
4. The external API (Groq) only if explicitly configured. It is off by
   default once a self-hosted path exists.

## 6. Safety and cost controls (unchanged principle: the model has no privileges)

- Generated SQL is untrusted input. The server parses and validates it
  (SQLGlot allowlist plus guardrails), then executes it as `tracker_api`
  (ClickHouse: `SELECT`-only grants and a profile pinning time, rows,
  bytes and memory).
- **BigQuery:**
  - A read-only service account (dataset `dataViewer` plus `jobUser`).
  - A dry run first, to show the estimated bytes and refuse above a
    threshold.
  - `maximum_bytes_billed` on every job.
  - Custom per-day quotas.
  - Partitioned and clustered tables so typical questions scan megabytes.
- Existing per-client rate limits apply to generation and execution.
- **Privacy:** in-browser generation keeps questions on the user's
  device. The prompt contains the schema and examples, never data.

## 7. Milestones and exit criteria

1. **Evaluation set** and an offline harness that scores any generator,
   API or local.
2. **SQLGlot validation** in `/api/query` and `/api/nl-to-sql`, alongside
   the regex guardrails. No behavior change for valid queries; measured
   on the real query corpus.
3. **Browser prototype:** Transformers.js and WebLLM side by side behind a
   feature flag, with download/load/latency telemetry kept local to the
   session.
4. **Decision:** adopt in-browser generation if, on the target devices,
   execution accuracy is at least that of the Groq baseline minus 10
   points, with median latency under 10 s. Keep the server-side small
   model as the fallback; retire the external API.
