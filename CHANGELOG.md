# Changelog

All notable changes to RUBIX Protocol. Format: [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Comprehensive documentation audit — fix stats, line counts, missing features
- `.env.example` for onboarding
- `.github/` issue templates, PR template
- `CONTRIBUTING.md`
- Architecture docs: orchestra, comms.db, hooks, AFK mode

## 2026-03-05

### Added
- Comms-based permission relay for multi-instance orchestration
- Rubix Orchestra multi-instance launcher scripts (tmux + Windows Terminal)

### Fixed
- Clean stale unread messages during comms cleanup

## 2026-03-04

### Added
- Plan validation hard gate with smart false-positive handling
- Two-stage plan validation — capture on ExitPlanMode, validate before first Write/Edit
- ExitPlanMode preflight validation hook
- QC diagnostics enforcement on edited files via Stop hook

### Changed
- Trim verbose hook prompts — remove box art, compress directives

### Fixed
- Route stop hook output to stderr to avoid polluting MCP stdout
- Bump Auto-STM store timeout from 8s to 15s in stop hook

## 2026-03-01

### Fixed
- Resolve all 165 test failures — exclude dist/ dupes, fix timeouts and DB races
- Install missing Babel deps, delete orphaned dist/test/
- Remove broken tests, unused deps, fix test script
- Make LSP availability checks work without eager server startup

### Changed
- Remove dead files, broken tests, and spent migration scripts

## 2026-02-27

### Added
- JSON memory import script and core memories export

### Fixed
- Override stale API keys from .env, deduplicate project context storage
- Remove auto-deny for destructive commands

## 2026-02-25

### Added
- Replace HNSW file-based vectors with sqlite-vec for in-database vector search
- QC ledger — track diagnostics completion + enforce debt gate
- QC nudges — LSP/linter reminders on file edits and plan mode entry

### Fixed
- Wire GNN embeddings, ReflexionService, and ShadowSearch into execution pipeline
- Correct plan hook timeout from 5000 to 5 seconds

## 2026-02-20

### Added
- Session-start gate to enforce /recall + comms check on first prompt
- Inter-instance trigger system for autonomous session spawning
- Mandatory MemRL rating enforcement and auto-STM signal collection
- Polyglot skill detection, causal auto-linking, instance-aware comms hooks
- Inter-instance communication system (comms.db)

### Changed
- License changed from MIT to AGPL-3.0 with Additional Terms

## 2026-02-15

### Added
- CLI hooks for auto-recall, AFK remote control, and Q-score feedback
- SessionEnd auto-save hook
- Open-source documentation, LICENSE, README

### Fixed
- Add default 30min TTL for status-type comms messages
