# Feedback Management

## Status Taxonomy

All feedback items have a `status` field with one of three values:

### `open`
- Newly reported feedback
- Not yet being worked on
- Needs review and prioritization

### `in-progress`
- Actively being addressed
- Code changes are underway or planned
- Will transition to `closed` when resolved

### `closed`
- Issue has been resolved or addressed
- No further action needed
- May include a note explaining what was done

## Feedback Categories

Feedback is also categorized by the `phase` field, which indicates which part of the system it relates to:

- `practice-points` — Suggestions for clinical practice points in notes
- `completeness` — Missing information or gaps in clinical documentation
- `unknown` — Uncategorized or miscellaneous feedback

## Submitting Feedback

Users submit feedback through the feedback modal with:
- `explanation` — What the issue is
- `suggestion` — Proposed text or solution
- `why` — Clinical rationale
- `type` — Priority level (high, medium, low, unknown)

## Actioning Feedback

When feedback is addressed:
1. Update `status` from `open` to `closed`
2. Add brief note to explain what was done
3. Keep `lastAction` and `actionedAt` for audit trail

## Related Issues

- **Category 1: Duplicate Detection** — System now scans existing note content before suggesting additions to prevent redundant suggestions (CLOSED)
- **Category 2: Provisional Text Visibility** — Pending insertions are now highlighted in green to clearly distinguish them from confirmed text (CLOSED)
- **Category 3: Wrong Placement** — Suggestions now include intelligent placement information determined by the LLM:
  - `analyzeNoteStructure()` analyzes existing sections in the clinical note
  - Each suggestion includes placement context: which section it belongs in, whether to create a new section, etc.
  - LLM reasons about placement rather than using programmatic section parsing
  - Suggestions can specify creating new sections with semantically appropriate titles
  - Never defaults to appending at the end (IN PROGRESS)
