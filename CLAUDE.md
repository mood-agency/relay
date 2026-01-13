# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rohan is an OpenAPI test generator for k6. It uses LLMs to generate k6 test scripts from OpenAPI specifications. The workflow is two-phase: `plan` generates a test plan JSON, then `build` generates k6 JavaScript test files.

## Common Commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode for development
npm run dev

# Run tests
npm test

# Run a single test (vitest)
npm test -- --filter "test name"

# Run CLI (after build)
npm run rohan -- <command>

# Example workflow
npm run rohan -- plan api-spec.json -o test-plan.json
npm run rohan -- build test-plan.json -o tests/
```

## Architecture

```
src/
├── cli.ts              # Commander setup, CLI entry point
├── commands/           # Command implementations (plan, build, exec, validate)
├── generator/
│   ├── planner.ts      # Test plan generation (single + batched modes)
│   ├── builder.ts      # k6 script generation (single + batched modes)
│   └── templates.ts    # Prompt loading and template rendering
├── llm/
│   ├── client.ts       # Unified LLM client using Vercel AI SDK
│   └── providers.ts    # Provider detection and API key handling
├── utils/
│   ├── openapi.ts      # OpenAPI spec parsing and endpoint extraction
│   ├── files.ts        # File system utilities
│   └── progress.ts     # CLI progress indicators
└── types.ts            # TypeScript interfaces
```

### Key Patterns

- **Two-phase generation**: `plan` creates TestPlan JSON with test entries, `build` generates k6 scripts from the plan
- **Batching**: Both phases support batching multiple items per LLM request (`--batch-size`)
- **Parallel workers**: Uses p-limit for concurrent LLM calls (`--workers`)
- **Rate limiting**: Optional RPM limiting (`--rpm`)
- **E2E mode**: Alternative flow analyzing full spec for workflow patterns (`--e2e`)

### LLM Integration

The `LLMClient` class in `src/llm/client.ts` provides a unified interface using Vercel AI SDK. Supported providers:
- Groq (default)
- OpenAI
- Anthropic
- Together, Fireworks, Ollama (via OpenAI-compatible API)

Provider auto-detection is based on model name patterns in `src/llm/providers.ts`.

### Prompts

Prompt templates in `prompts/` directory:
- `planner_*.md` - Test scenario planning
- `builder_*.md` - k6 script generation
- `*_batch_*.md` - Batched variants
- `e2e_*.md` - E2E workflow variants

Override with `--prompt-dir`.

## Environment Variables

```bash
GROQ_API_KEY      # Groq API key
OPENAI_API_KEY    # OpenAI API key
ANTHROPIC_API_KEY # Anthropic API key
TOGETHER_API_KEY  # Together API key
FIREWORKS_API_KEY # Fireworks API key

# Defaults
ROHAN_MODEL       # Default model
ROHAN_PROVIDER    # Default provider
ROHAN_WORKERS     # Default worker count
ROHAN_BATCH_SIZE  # Default batch size
ROHAN_RPM         # Default rate limit
ROHAN_PROMPT_DIR  # Default prompt directory
```
