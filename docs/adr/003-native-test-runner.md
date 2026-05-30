# ADR 003: Using Node.js Native Test Runner

## Status
Accepted

## Context
The project needs a test framework. Popular options include Jest, Mocha, Vitest, and Node.js built-in test runner.

## Decision
Use Node.js native test runner (`node --test`) instead of Jest/Mocha/Vitest.

## Rationale
1. **No extra dependencies**: Built into Node.js 20+
2. **Native ESM support**: Works seamlessly with ES modules
3. **Simple configuration**: No config files needed
4. **Fast**: No overhead from test framework itself
5. **Standard**: Uses official Node.js APIs

## Consequences
Positive:
- Zero test framework dependencies
- Fast test execution
- Native async/await support

Negative:
- Less features than Jest (no snapshots, limited mocking)
- Smaller ecosystem
- IDE integration not as mature
