# TypeScript Weave Integration Details

## Module Systems

### CommonJS
No special configuration needed. Auto-patching works automatically.

```javascript
const weave = require('weave');
const OpenAI = require('openai');

await weave.init('my-project');
const client = new OpenAI();
// Automatically traced
```

### ESM (ES Modules)

ESM requires explicit instrumentation via Node's `--import` flag:

```bash
# Option 1: CLI flag
node --import=weave/instrument dist/main.js

# Option 2: Environment variable (when CLI flags unavailable)
export NODE_OPTIONS="--import=weave/instrument"
node dist/main.js
```

Then in code:
```typescript
import * as weave from 'weave';
import OpenAI from 'openai';

await weave.init('my-project');
const client = new OpenAI();
```

## Bundler Configuration

### Next.js

Mark LLM libraries as external to prevent bundling:

```javascript
// next.config.js
module.exports = {
  webpack: (config) => {
    config.externals = {
      ...config.externals,
      'openai': 'commonjs openai',
      'anthropic': 'commonjs @anthropic-ai/sdk',
    };
    return config;
  },
};
```

### Vite

```javascript
// vite.config.ts
export default {
  build: {
    rollupOptions: {
      external: ['openai', '@anthropic-ai/sdk'],
    },
  },
};
```

### esbuild

```javascript
// build.js
require('esbuild').build({
  external: ['openai', '@anthropic-ai/sdk'],
  // ...
});
```

## Manual Patching Fallback

When auto-patching fails, wrap clients manually:

```typescript
import { wrapOpenAI } from 'weave';
import OpenAI from 'openai';

const client = wrapOpenAI(new OpenAI());
// Now traced
```

## Wrapping Custom Functions

```typescript
import * as weave from 'weave';

// Wrap any function
const tracedFunction = weave.op(async (input: string) => {
  return `Processed: ${input}`;
});

// Wrap with options
const namedOp = weave.op(myFunction, {
  callDisplayName: (input) => `MyOp: ${input.slice(0, 20)}`
});
```

## Class Method Decorators

```typescript
import * as weave from 'weave';

class Agent {
  constructor() {
    // Wrap in constructor for non-decorator approach
    this.chat = weave.op(this.chat.bind(this));
  }

  async chat(message: string) {
    return "response";
  }
}

// Or with decorator (requires decorator support)
class Agent2 {
  @weave.op
  async chat(message: string) {
    return "response";
  }
}
```

## TypeScript Configuration

Ensure your tsconfig.json has:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,  // For @weave.op decorator
    "esModuleInterop": true,
    "moduleResolution": "node"
  }
}
```

## Known Limitations

- TypeScript SDK less mature than Python
- Some Python features not available (parallel tracing, manual Call tracking)
- Async generators may have limited support
- Check latest docs for current feature parity
