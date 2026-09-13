# PD Documentation Test Results

Tested: 2026-05-28
Agent: Codex sub-agent navigation pass, source verified locally
Repo: AgoraIO-Conversational-AI/agent-quickstart-nextjs

## Summary

- Total questions: 8
- Passed: 8 (correct answer, right level)
- L1 gaps: 0 (needed L2 but L1 should have sufficed)
- L2 gaps: 0 (needed L2 that does not exist)
- Cross-ref issues: 0 (L2 exists but was not found)

## Structural Checks

- L0 exists and is under 50 lines.
- All 8 L1 files exist, start with a one-line purpose statement, and end with `## Related Deep Dives`.
- L1 combined line count is under 1,600 lines.
- `docs/ai/L1/L2/_index.md` exists and lists all L2 files.
- Every L2 content file starts with `> **When to Read This:**`.
- Markdown relative links resolve.
- `AGENTS.md` has How to Load, Git Conventions, and Doc Commands.
- `CLAUDE.md` references `@AGENTS.md`.

## Results

### Setup & Build

| # | Question | Answer Correct? | Files Read | Level Loaded | Result |
| - | -------- | --------------- | ---------- | ------------ | ------ |
| 1 | How do I install dependencies, bind env, and build this project? | Yes | `AGENTS.md`, `README.md`, L0, `01_setup`, `05_workflows`, `package.json` | L0+L1 | Pass |
| 2 | What environment variables are required for the base quickstart? | Yes | `README.md`, `env.local.example`, `01_setup`, `06_interfaces`, `RECIPE.md` | L1+Recipe | Pass |

### Test & Run

| # | Question | Answer Correct? | Files Read | Level Loaded | Result |
| - | -------- | --------------- | ---------- | ------------ | ------ |
| 3 | How do I run the API contract validation flow? | Yes | `package.json`, `01_setup`, `03_code_map`, `04_conventions`, `06_interfaces` | L1 | Pass |

### Conventions

| # | Question | Answer Correct? | Files Read | Level Loaded | Result |
| - | -------- | --------------- | ---------- | ------------ | ------ |
| 4 | What branch and commit conventions apply? | Yes | `AGENTS.md`, `CONTRIBUTING.md`, `04_conventions`, `05_workflows` | L1 | Pass |
| 8 | What docs must change when a workflow, interface, or recipe stable contract changes? | Yes | `AGENTS.md`, `CONTRIBUTING.md`, L0, `RECIPE.md`, `01_setup`, `04_conventions`, `05_workflows`, `06_interfaces`, `07_gotchas` | L1+Recipe | Pass |

### Development

| # | Question | Answer Correct? | Files Read | Level Loaded | Result |
| - | -------- | --------------- | ---------- | ------------ | ------ |
| 5 | How would I change the agent prompt/model/VAD settings safely? | Yes | `AGENTS.md`, `README.md`, `RECIPE.md`, `03_code_map`, `05_workflows`, `invite_agent_config.md` | L1+L2 | Pass |

### Deep Dive

| # | Question | Answer Correct? | Files Read | Level Loaded | Result |
| - | -------- | --------------- | ---------- | ------------ | ------ |
| 6 | Why does transcript rendering remap `uid="0"` and keep `INTERRUPTED` turns? | Yes | `AGENTS.md`, `RECIPE.md`, `04_conventions`, `07_gotchas`, `transcript_pipeline.md` | L1+L2 | Pass |
| 7 | How does token renewal handle RTC and RTM identities? | Yes | `README.md`, `02_architecture`, `04_conventions`, `08_security`, `token_model.md` | L1+L2 | Pass |

## Recommended Fixes

- None.

## Notes on Test Method

- A read-only sub-agent answered the navigation questions without being told specific docs to read.
- Structural checks and source-sensitive claims were verified locally with shell checks and direct source reads.
- This run supersedes the 2026-05-22 results after adding recipe-profile metadata, missing human guides, and L2 callout structure fixes.

## Recipe Bootstrap Retest

Retested: 2026-05-28

| Finding | Source checked | Docs changed | Result | Notes |
| ------- | -------------- | ------------ | ------ | ----- |
| Recipe needed official-baseline guidance without bloating `RECIPE.md` | `docs/ai/RECIPE.md`, `docs/ai/L1/03_code_map.md`, `docs/ai/L1/05_workflows.md`, `docs/ai/L1/L2/_index.md` | `docs/ai/RECIPE.md`, `docs/ai/L1/L2/from_scratch_bootstrap.md`, L1 links, L2 index | Pass | `RECIPE.md` now links to a dedicated L2 bootstrap doc; new links resolve and the L2 starts with the required callout. |
| Old human guide docs were removed as obsolete artifacts | `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/ai/L1/*`, `docs/ai/L1/L2/from_scratch_bootstrap.md` | Removed obsolete guide files; redirected references to `RECIPE.md`, L1, and L2 docs | Pass | No stale guide references remain; markdown links resolve. |
