# 🔮 Weavify - W&B Weave Integration Skill

Add [Weights & Biases Weave](https://wandb.ai/site/weave) observability to any LLM project with minimal code changes.

## What is Weave?

[Weave](https://docs.wandb.ai/weave/) is W&B's observability toolkit for LLM applications. It automatically traces LLM calls, captures token usage, latency, and costs, and provides a powerful UI for debugging and evaluation.

### Key Features
- 🔄 **Auto-patching** - Automatic tracing for OpenAI, Anthropic, and 20+ providers
- 📊 **Token tracking** - Full visibility into input/output tokens and costs
- ⏱️ **Latency metrics** - TTFB and total response time
- 🔍 **Debug UI** - Visual trace explorer in W&B dashboard
- 📈 **Evaluations** - Built-in support for LLM evals

---

## Installation

### Option 1: Vercel Agent Skills (Recommended)

Works with Claude Code, Cursor, Codex, and other AI coding agents:

```bash
npx add-skill altryne/weavify-skill
```

This adds the skill to your project's `.cursor/skills/` or agent config.

### Option 2: Clawdbot

```bash
# Clone to your skills directory
git clone https://github.com/altryne/weavify-skill.git ~/clawd/skills/weave-integration
```

The skill will be automatically available to your Clawdbot agent.

### Option 3: Manual

Copy `SKILL.md` to your project's agent instructions folder.

---

## Quick Start (for your code)

### 1. Install Weave

```bash
# TypeScript/Node.js
npm install weave

# Python
pip install weave
```

### 2. Get API Key

Set `WANDB_API_KEY` environment variable. Get key from [wandb.ai/settings](https://wandb.ai/settings).

```bash
export WANDB_API_KEY="your-key-here"
```

### 3. Initialize & Trace

**TypeScript:**
```typescript
import * as weave from 'weave';
import OpenAI from 'openai';

await weave.init('your-team/project-name');

const client = new OpenAI();
// All OpenAI calls are now automatically traced!
```

**Python:**
```python
import weave
import openai

weave.init('your-team/project-name')

client = openai.OpenAI()
# All OpenAI calls are now automatically traced!
```

---

## Supported Providers

Weave auto-patches these providers (no code changes needed):

| Provider | TypeScript | Python |
|----------|------------|--------|
| OpenAI | ✅ | ✅ |
| Anthropic | ✅ | ✅ |
| Google AI | ✅ | ✅ |
| Mistral | ✅ | ✅ |
| Cohere | ✅ | ✅ |
| Groq | ✅ | ✅ |
| Together | ✅ | ✅ |
| LiteLLM | ❌ | ✅ |
| LangChain | ❌ | ✅ |

---

## Manual Tracing

For custom functions, use the `@weave.op()` decorator:

**TypeScript:**
```typescript
const myFunction = weave.op(async (input: string) => {
  // Your code here
  return result;
}, { name: 'myFunction' });
```

**Python:**
```python
@weave.op()
def my_function(input: str) -> str:
    # Your code here
    return result
```

---

## Documentation

- 📚 [Weave Documentation](https://docs.wandb.ai/weave/)
- 🚀 [Quickstart Guide](https://docs.wandb.ai/weave/quickstart)
- 🔧 [TypeScript Integration](https://docs.wandb.ai/weave/guides/integrations/js)
- 🐍 [Python Integration](https://docs.wandb.ai/weave/guides/integrations/python)
- 📊 [Tracing Guide](https://docs.wandb.ai/weave/guides/tracking/tracing)
- 📈 [Evaluations](https://docs.wandb.ai/weave/guides/evaluation)

---

## Skill Structure

```
weavify-skill/
├── README.md           # This file
├── SKILL.md            # Agent instructions
└── references/
    └── typescript.md   # TypeScript-specific docs
```

## License

MIT

---

Built with 🐺 by [Wolfred](https://x.com/wooolfred) • Maintained by [@altryne](https://x.com/altryne)
