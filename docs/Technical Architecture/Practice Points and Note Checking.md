# Practice Points & Note Checking — How It Works

This note explains, in plain language, the two core processes behind Clerky:

1. **How a guideline becomes practice points and values** (done once per guideline, stored).
2. **How a clinical note is checked against them** (runs live when a clinician analyses a note).

It is written to be readable by both clinical and technical team members. A developer "where this lives in the code" map is at the end.

---

## Process 1 — Turning a guideline into practice points + values

Think of this as **"digesting" a guideline document into checkable rules.**

1. **Start with the document.** A guideline PDF is converted to plain text (e.g. the diabetes-in-pregnancy guideline is ~62,000 characters) and stored.

2. **Split it into sections** using the document's own structure (headings, fonts, layout), so each chunk is a coherent topic rather than an arbitrary slice.

3. **Pull out "practice points."** For each section, an AI extracts **atomic if/then rules** — one action each. For example:
   > *"IF the patient has gestational diabetes AND is in labour, THEN counsel them about the intrapartum glucose management protocol."*

   Each practice point carries three things:
   - **condition** — when it is triggered,
   - **action** — what should happen,
   - **applicability context** — a plain-English note on when it does and does not apply (e.g. "applies in labour; not antenatally").

4. **Sweep for completeness and remove duplicates** — re-check that nothing was missed, and collapse near-identical points.

5. **Identify the data values each point needs.** For the rule above, the values are things like *"established labour status," "diabetes status," "VRIII status"* — the specific facts you'd need to know to check whether the rule was followed.

6. **Match values to a shared registry.** The same concept (e.g. "blood glucose level") appears across many guidelines, so values are reconciled against one **canonical list** — one value reused everywhere, rather than many slightly-different copies.

**End result, stored per guideline:** a list of practice points, plus the data values each one depends on.

---

## Process 2 — Checking a clinical note against them

This runs live when a clinician analyses a note.

1. **Pick the relevant guidelines** for this note (e.g. a diabetic-in-labour note → the diabetes-in-pregnancy guideline).

2. **Decide which practice points actually apply to *this* patient.** The **applicability** step: an AI reads the note plus each practice point's condition/context and judges "applies" or "not applicable." For a patient *in labour*, the VRIII-in-labour point applies; the *preconception* HbA1c point does not.

3. **Gather the values those applicable points need, and fill them in:**
   - **Extract** what's already documented in the note,
   - **Infer** what can be reasonably derived (without inventing measurements),
   - **Ask** the clinician to confirm the rest — the "Confirm required values" pop-up.

4. **Check the note against the applicable points.** For each one: is it addressed in the note, or missing? The missing ones become **suggestions / flags** — "you haven't documented X, which this guideline expects here."

---

## The one-line version

> **Process 1** turns a guideline into a checklist of *if/then rules* and *the facts each rule needs.*
> **Process 2** takes a patient's note, works out *which rules apply to this patient*, makes sure *the needed facts are present*, and flags *which rules aren't satisfied.*

The defensible product wedge is Process 2's note-completeness checking against local protocols — the part generic Q&A tools don't do.

A key dependency: **Process 2 is only as good as Process 1's output.** If extraction produces junk practice points, the clinician gets flooded with junk flags.

---

## Where this lives in the code (developer map)

**Process 1 (extraction):**
- `server.js` → `identifyAndStructurePracticePoints()` and `packAnchorsIntoChunks()` — section chunking, per-section LLM extraction, completeness sweep, dedup. Triggered via `/regeneratePracticePoints` (async; poll `/getExtractionJobStatus`).
- `modules/required-values.js` → `PER_PP_SYSTEM` extraction identifies each practice point's data values; reconciliation/promotion against the canonical value registry (`canonicalValues` collection / bootstrap JSON).
- Stored on each `guidelines/{id}` Firestore doc: `practicePoints[]` (each `{ name, condition, action, description, applicabilityContext }`) and `requiredValues { values[], proposedNewValues[] }`, where each value carries `usedByPPs: [serials]`.

**Process 2 (note checking):**
- Required-values gather: `modules/required-values.js` → `gatherValuesForApplicablePPs()` → `evaluatePPApplicability()` (the per-point applies/not-applicable judgment), then `extractValuesFromNote()` / `inferMissingValues()`. Endpoint `/gatherValuesForApplicablePPs`; client call in `script.js` (`gatherRequiredValuesForGuidelines`).
- Completeness/compliance checking of the note against the applicable practice points produces the clinician-facing suggestions.

---

## Known caveats (as of 2026-06)

- **Extraction can hallucinate by enumeration.** The "be MAXIMALLY granular" extraction (v477–479) once turned a single source idea ("counsel about fetal growth monitoring") into ~88 fabricated per-modality practice points (CTG, BPP, kick counts, NST…) absent from the source — 40% of the diabetes guideline. Those were deleted; the extraction prompt still needs fixing so it doesn't recur across the other ~376 guidelines. See `scripts/analyze-pp-duplication.js`.
- **Test the gather like the browser does.** When testing `/gatherValuesForApplicablePPs` from a script, serialise the note with real JSON (`JSON.stringify` / Node) — PowerShell 5.1's `ConvertTo-Json` mangles multi-line strings into an object, so the note arrives as `[object Object]` and every point is (correctly) judged not-applicable. Use `scripts/test-gather-http.js`.
