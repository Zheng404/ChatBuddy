# ADR 004: Layered Architecture with VS Code Decoupling

## Status
Accepted

## Context
VS Code extensions often mix business logic with VS Code API calls, making testing difficult.

## Decision
Adopt a strict layered architecture:
- `extension/` — VS Code API adapter layer
- `chatbuddy/` — Business logic core layer (no VS Code dependencies)

## Rationale
1. **Testability**: Core layer can be tested without VS Code environment
2. **Portability**: Core logic could be reused in other contexts
3. **Maintainability**: Clear separation of concerns
4. **No circular dependencies**: Strict one-way dependency from adapter to core

## Consequences
Positive:
- Easy unit testing
- Clear module boundaries
- Reduced coupling

Negative:
- More boilerplate for adapter layer
- Need to define clear interfaces between layers
