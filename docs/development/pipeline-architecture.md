# Clerky pipeline architecture

Clerky is really **two pipelines** that meet at one shared asset — the *practice
points* and *required values* distilled from each guideline:

1. **Ingestion** (offline, once per guideline): `guideline PDF → practice points → required values`.
   Turns an unstructured trust/NICE PDF into atomic, machine-checkable rules and the
   data those rules depend on.
2. **Clinical practice** (online, per encounter): `clinical note + practice points → a
   more comprehensive, evidence-based note`.
   Uses the distilled rules to find what a clinician's note is missing or contradicts,
   and to fold confirmed values + accepted suggestions back into the note.

This document maps **every step** of both, with the file/function that owns each.
Keep it current when the pipeline changes.

---

## Shared data model (Firestore)

- **`guidelines/{id}`** — per guideline. Key fields:
  - `content` — full extracted PDF text.
  - `structure` — derived section outline / heading anchors.
  - `practicePoints[]` — `{ name, condition, action, description, sourceQuote, applicabilityContext, usedByPPs… }`.
  - `requiredValues` — `{ values[], proposedNewValues[], _curation }` (see Ingestion §9).
  - `vectorDbIngested`, `processingStatus.*`, `practicePointsRegeneratedAt`.
- **`canonicalValues/{id}`** — the global required-value registry: `{ label, type, options?, aliases[], neverInfer?, _origin, _fromGuideline }`. Shared across all guidelines.
- **`aiInteractions/{id}`** — persistent log of every routed LLM call (prompt + response + model). The source of truth for debugging either pipeline (`scripts/dump-interactions-matching.js`).

---

## Project 1 — Ingestion: guideline → practice points → required values

Orchestrated by a job queue; the terminal `PROCESSING_COMPLETE` stage chains the
analysis steps (`server.js`).

### 1. Upload & register
PDF uploaded → stored → `guidelines/{id}` created with `filename` + metadata
(hospitalTrust, scope).

### 2. Content + structure extraction — `jobExtractContent` (`server.js:1343`)
- `fetchPDFBuffer` → `extractTextFromPDF` → full `content` text.
- `deriveGuidelineStructure(buffer, fullText)` → section outline from the embedded
  PDF outline, else font-based heading detection → **section anchors** (offsets into
  `content`). Best-effort; never blocks.
- (For oversized text, `chunkTextOnBoundaries` + `condenseChunk` condense it
  paragraph/sentence-wise — `server.js:643`, `676`.)

### 3. Display name — `generate_display_name` job.

### 4. Practice-point extraction — `extractPracticePoints(content, …, { sectionAnchors })` (`server.js:1454`)
Structure-aware: chunks the text by real section boundaries (the anchors from §2) so
each chunk is coherent, then extracts **atomic if/then practice points**
`{ name, condition, action, description }`. Stamps `practicePointsRegeneratedAt`.
> Known failure mode: maximally-granular prompts hallucinate enumerated variants —
> see the `project_pp_extraction_hallucination` memory.

### 5. Verbatim `sourceQuote` backfill
Per PP, an LLM extracts the **exact** span from `content` the recommendation came from
(character-for-character). Powers the "Link to guideline" deep link (the *action* is a
paraphrase and won't phrase-match the PDF).

### 6. Applicability contexts — `generateApplicabilityContexts` (`required-values.js:399`)
Per PP, drafts a 1–3 sentence `applicabilityContext`: **which** population/situation and
**at what care stage** the point applies — and when it explicitly does NOT (e.g. a
postnatal action doesn't apply to a patient still pregnant). This is what stops
wrong-stage points leaking in Project 2's applicability gate.

### 7. Vector DB ingestion (`server.js:1668`, `modules/vector-db.js`)
Chunks `content` and upserts embeddings (with scope + hospitalTrust metadata) for RAG
retrieval.

### 8. Required-values generation — `getOrGenerateRequiredValues` (`required-values.js:315`)
The **standardised pipeline** (v9.0.567). For the guideline's practice points:
1. **Extract** per PP (`extractValuesForPP`) — the atomic clinical data each PP depends on.
2. **Aggregate** (`aggregate`) — exact/alias string-match to the `canonicalValues`
   registry; unmatched concepts collected as a *proposed* pool with `usedByPPs`.
3. **Curate** (`curateProposedAgainstRegistry`) — one LLM-driven pass per proposed concept:
   - **map** → an existing registry entry (add the phrasing as an alias).
   - **new, ≥2 fragments** → **promote** to the registry: mint one clean canonical
     entry with the variants as aliases (collapses duplicates like `oxytocin_dose` ×3).
   - **new, singleton** → keep **guideline-local** (`proposedNewValues`).
   - **drop** → derived/trivial/noise.
   - **Guardrails:** additive-only registry writes (`merge`; never re-types/re-labels an
     existing entry); ≥2-fragment promotion gate; idempotent (a re-run seeds from the
     current registry, so prior promotions are *mapped* not re-minted → converges);
     `_curation` provenance stamp per run.
4. **Store** `requiredValues = { values[], proposedNewValues[], _curation }` on the guideline.

The same engine is callable standalone for back-catalogue cleanup:
`scripts/reconcile-proposed-values.js <guidelineId> [--commit]` (dry-run by default).

---

## Project 2 — Clinical practice: note → augmented evidence-based note

Triggered when a clinician analyses a note against selected guidelines (`script.js`
front-end + server endpoints). Runs left-to-right; the suggestion stage fans out per
practice point. (See the per-call flow in `aiInteractions`.)

### A. Note entry + guideline scope
Clinician writes/loads a note → guideline checkpoint selects the in-scope guidelines
(by trust/scope).

### B. Required-values gather (runs BEFORE suggestions)
Goal: know every value the in-scope guidelines need to judge this patient.
1. **`aggregateAcrossGuidelines`** — union of required values across the selected guidelines.
2. **`extractValuesFromNote`** — auto-fill values already documented in the note (`found: true`).
3. **`filterValuesByRelevance`** — hide values whose population/stage doesn't match this patient.
4. **`gatherValuesForApplicablePPs` / `evaluatePPApplicability`** — scope to values whose
   practice points actually apply now. (Proposed-new values admitted on the same footing
   as canonical — see the singleton-volume note below.)
5. **`inferMissingValues`** — infer still-blank values from the note (documentation flags;
   **never fabricates measurements**); review-only.
6. **Confirm-values modal** (`showRequiredValuesModal`, `script.js:8517`) — three buckets:
   *auto-filled* (already in the note), *AI-filled / review*, *sought* (clinician fills).

### C. Note augmentation — `augmentNoteWithValues` (`required-values.js:1116`)
Weaves **only what the clinician actually added** into the note: sought values they typed,
or auto-filled values they *corrected* (v9.0.565 — values read out of the note are not
pasted back in, which avoids duplication and the augment LLM overwriting the clinician's
own wording). Routed via `routeToAI` (v9.0.564 — no pinned model).

### D. Suggestion generation (fan-out per applicable practice point)
Reconstructed from `aiInteractions` (endpoint labels in parentheses):
1. **Per-point applicability** (`evaluation:perPoint`) — for each PP: does it apply to
   this note, and if so write one precise suggestion. (Recall-maximising; isolated.)
2. **Re-extract quote** (`evaluation:reExtractQuote`) — verbatim guideline span for the deep link.
3. **PP match** (`simple:ppMatch`) — map each suggestion back to its PP serial.
4. **Cross-PP suppression** (`simple:crossPPsuppress`) — within one guideline, drop
   *premature/contraindicated* downstream suggestions when another negates the intervention.
5. **Duplicates** (`sendToAI` dedup) — collapse genuine repeats **across** guidelines (conservative; keep-both when unsure).
6. **Placement** (`simple:placement`) — per surviving suggestion: `target_section` + `amend`/`add`/`replace`.
7. **Valid suggestions** (`sendToAI`) — final validity gate → the list shown.

### E. Suggestion wizard → final note
Clinician reviews suggestions; accepted ones are woven into the note → a more
comprehensive, evidence-based note. Each suggestion links back to its guideline passage.

---

## Known open issues (cross-cutting)

- **Singleton volume (gather):** the gather admits guideline-local *singleton* proposed
  values on equal footing with canonical ones, so a hyper-granular guideline (PPH: 234 PPs)
  surfaces a long tail of one-off asks. The intended fix is a gather-side frequency gate
  (don't surface a singleton unless ≥2 applicable PPs need it). Not yet implemented.
- **Relevance stage-awareness:** cross-domain values can leak (e.g. antenatal glucose
  values for a postnatal PPH patient).
- **PP extraction granularity/hallucination** — see `project_pp_extraction_hallucination`.

## Where to look when debugging
- Per-call LLM logs: `aiInteractions` (`scripts/dump-interactions-matching.js`, Dev page).
- Volatile server console (`[PROCESSING_COMPLETE]`, `[AUGMENT-NOTE]`, `[PER-POINT]`): Render logs.
- A guideline's distilled assets: `guidelines/{id}.practicePoints` / `.requiredValues`.
