// CopilotKit runtime endpoint for the Glassbox cockpit.
//
// Stands up a CopilotRuntime over W&B Inference (OpenAI-compatible) so the
// in-cockpit command bar can talk to a real chat model and drive the launch
// tools defined client-side via useFrontendTool.
//
// The OpenAI client is pointed at W&B Inference through OPENAI_BASE_URL +
// OPENAI_API_KEY (the W&B key). The chat model is a STANDARD instruct model
// from GLASSBOX_CHAT_MODEL (default Llama 3.3 70B Instruct). We deliberately do
// NOT default to the gpt-oss reasoning model used by the Python swarm
// (GLASSBOX_LLM_MODEL), because reasoning models return empty completions
// unless given a large max_tokens budget and make for a poor chat experience.
//
// VERSION NOTES (verified against the installed 1.59.5 packages, not training
// data):
//  - copilotRuntimeNextJSAppRouterEndpoint mounts the v2 single-route endpoint.
//    Its BuiltInAgent resolves the model via the adapter's getLanguageModel(),
//    which uses the Vercel AI SDK (@ai-sdk/openai).
//  - The AI SDK's default createOpenAI(...)(model) call targets the OpenAI
//    "/responses" API, which W&B Inference does NOT serve (it returns 404). W&B
//    only serves "/chat/completions". So we override getLanguageModel() to use
//    the provider's .chat(model) variant, which targets "/chat/completions".

import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { createOpenAI } from "@ai-sdk/openai";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Standard instruct chat model. Overridable via env; never the reasoning model.
const CHAT_MODEL =
  process.env.GLASSBOX_CHAT_MODEL || "meta-llama/Llama-3.3-70B-Instruct";

/**
 * OpenAIAdapter variant that forces the Chat Completions API.
 *
 * The base adapter's getLanguageModel() does `createOpenAI({...})(model)`, which
 * the AI SDK routes to the Responses API. W&B Inference is Chat-Completions only,
 * so we override it to call `.chat(model)`.
 */
class ChatCompletionsOpenAIAdapter extends OpenAIAdapter {
  // Return type is inferred from the base method (ai's LanguageModel). The AI
  // SDK provider's .chat() yields a compatible LanguageModelV3.
  getLanguageModel() {
    const provider = createOpenAI({
      baseURL: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    });
    return provider.chat(this.model);
  }
}

// Build the endpoint lazily and memoize it. The OpenAI SDK validates the API key
// in its constructor, so constructing it at module-eval time would crash during
// `next build` (page-data collection runs route modules without secrets). Doing
// it on first request keeps the build clean and still reuses one client.
type Handler = ReturnType<typeof copilotRuntimeNextJSAppRouterEndpoint>;
let cached: Handler | null = null;

function getHandler(): Handler {
  if (cached) return cached;

  // Point the OpenAI SDK at W&B Inference. Both values live in the root .env.
  // The base adapter's process() path (v1) uses this client for streaming chat
  // completions; the v2 path uses our getLanguageModel() override above.
  const openai = new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
  });

  const serviceAdapter = new ChatCompletionsOpenAIAdapter({
    openai,
    model: CHAT_MODEL,
  });

  // Tools are supplied by the browser (useFrontendTool), so the server-side
  // runtime needs no tools of its own.
  const runtimeInstance = new CopilotRuntime();

  cached = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: runtimeInstance,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });
  return cached;
}

export const POST = (request: Request) => getHandler().handleRequest(request);

// A lightweight GET so the route is easy to smoke-test. The CopilotKit client
// uses POST (the v2 single-route protocol with a `method` field); this just
// confirms the endpoint is mounted and reports the active chat model without
// leaking keys.
export function GET() {
  return Response.json({
    ok: true,
    service: "copilotkit-runtime",
    model: CHAT_MODEL,
    baseURLConfigured: Boolean(process.env.OPENAI_BASE_URL),
  });
}
