# Contributing to RUBIX Protocol

## Setup

```bash
git clone https://github.com/BobbyRuby/rubix-protocol.git
cd rubix-protocol
npm install
npm run build
```

See [README.md](README.md) for MCP configuration.

## Development

- **Language**: TypeScript (strict mode)
- **Build**: `npm run build` — compiles to `dist/`
- **Test**: `npm test` — vitest
- **Clean**: `npm run clean:temp` — removes `tmpclaude-*-cwd` directories

Build before testing. The test suite runs against compiled output.

## Code Style

- Match existing patterns in the file you're modifying
- TypeScript strict mode — no `any` types without justification
- Error handling at system boundaries (user input, external APIs)
- No unnecessary abstractions — three similar lines > premature helper

## Pull Requests

1. Fork and create a feature branch
2. One logical change per PR
3. Run `npm run build && npm test` before submitting
4. Write a descriptive title (under 70 chars) and summary
5. Link related issues

## Issues

Use the issue templates:
- **Bug reports**: steps to reproduce, expected vs actual, environment
- **Feature requests**: use case, proposed approach

## Architecture

Read [docs/architecture/](docs/architecture/index.md) before making structural changes. Key files:

| File | Purpose |
|------|---------|
| `src/mcp-server.ts` | MCP tool definitions (12,900+ lines) |
| `src/core/MemoryEngine.ts` | Memory facade (1,650 lines) |
| `src/codex/PhasedExecutor.ts` | 6-phase execution pipeline (2,160 lines) |
| `src/communication/CommsStore.ts` | Inter-instance message bus |

## License

By contributing, you agree that your contributions will be licensed under [AGPL-3.0 with Additional Terms](LICENSE). See [NOTICE](NOTICE) for details.
