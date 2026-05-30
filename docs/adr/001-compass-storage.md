# ADR 001: Migration from SQLite to Compass Structured Storage

## Status
Accepted

## Context
The project initially used VS Code's globalState (v1) and then SQLite via sql.js (v2) for data persistence.

## Decision
Migrate to a custom structured storage system called "Compass" using multiple JSON/JSONL files.

## Rationale
1. **Readability**: Plain text format for easy debugging
2. **Version control friendly**: Easy to diff and manually fix
3. **No native dependencies**: sql.js is WASM-based, large and slow to start
4. **Efficient append**: JSONL supports message append without rewriting entire files
5. **Atomic writes**: Using .tmp + rename pattern prevents data corruption

## Consequences
Positive:
- Faster startup time
- Easier data recovery
- Better migration support

Negative:
- More complex file management
- Need custom migration logic
- No SQL query capabilities
