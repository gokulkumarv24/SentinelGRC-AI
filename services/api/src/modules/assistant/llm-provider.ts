import { loadEnv, type Env } from '../../config/env.js';

export interface LlmRequest {
  system: string;
  user: string;
  maxOutputTokens: number;
}

export interface LlmResponse {
  text: string;
  /** Model that actually answered (differs from the configured one when a fallback was used). */
  model?: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Provider-independent adapter (spec §11.2). Keys live only on the server. */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /** False for providers that send data off the host and therefore need explicit approval. */
  readonly local: boolean;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    readonly code: 'timeout' | 'rate_limited' | 'provider_error' | 'invalid_response' | 'auth_failed',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Deterministic local provider: produces extractive drafts from the supplied sources without any model.
 * Task code builds the output directly; this class only marks the artifact as "mock".
 */
export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'deterministic-extractive-v1';
  readonly local = true;
  complete(): Promise<LlmResponse> {
    return Promise.reject(new LlmError('provider_error', 'The mock provider does not call a model'));
  }
}

/** OpenAI-compatible chat completions (for example Groq). JSON mode, timeout and bounded retries. */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible';
  readonly local = false;

  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly maxAttempts = 2,
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    let lastError: LlmError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.once(req);
      } catch (error) {
        lastError = error instanceof LlmError ? error : new LlmError('provider_error', 'The AI provider request failed');
        if (!['timeout', 'rate_limited', 'provider_error'].includes(lastError.code) || attempt === this.maxAttempts) break;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    throw lastError!;
  }

  private async once(req: LlmRequest): Promise<LlmResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.1,
          max_tokens: req.maxOutputTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
        redirect: 'error', // never follow redirects to another host
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new LlmError('timeout', 'The AI provider did not respond in time');
      throw new LlmError('provider_error', 'Could not reach the AI provider');
    }
    if (res.status === 401 || res.status === 403) throw new LlmError('auth_failed', 'The AI provider rejected the credentials');
    if (res.status === 429) throw new LlmError('rate_limited', 'The AI provider rate limit was reached');
    if (!res.ok) throw new LlmError('provider_error', `The AI provider returned HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null;
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new LlmError('invalid_response', 'The AI provider returned no content');
    return { text, model: this.model, inputTokens: body?.usage?.prompt_tokens ?? null, outputTokens: body?.usage?.completion_tokens ?? null };
  }
}

/**
 * Primary provider with a fallback for when it is rate limited or unavailable (e.g. a free tier's daily cap).
 * Credential and response-format errors are not retried elsewhere: they need fixing, not hiding.
 */
export class FallbackProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly local = false;

  constructor(
    private readonly primary: LlmProvider,
    private readonly secondary: LlmProvider,
  ) {
    this.name = primary.name;
    this.model = primary.model;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    try {
      return await this.primary.complete(req);
    } catch (error) {
      if (!(error instanceof LlmError) || !['rate_limited', 'provider_error', 'timeout'].includes(error.code)) throw error;
      return this.secondary.complete(req);
    }
  }
}

function assertSafeBaseUrl(name: string, value: string) {
  const url = new URL(value);
  // The base URL comes only from server configuration; plain HTTP is allowed only for a local endpoint.
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error(`${name} must use https`);
}

export function createProvider(env: Env = loadEnv()): LlmProvider {
  if (env.AI_PROVIDER === 'openai-compatible') {
    if (!env.AI_API_KEY) throw new Error('AI_API_KEY is required for the openai-compatible provider');
    assertSafeBaseUrl('AI_BASE_URL', env.AI_BASE_URL);
    const primary = new OpenAiCompatibleProvider(env.AI_BASE_URL, env.AI_MODEL, env.AI_API_KEY, env.AI_TIMEOUT_MS);
    if (!env.AI_FALLBACK_BASE_URL || !env.AI_FALLBACK_MODEL || !env.AI_FALLBACK_API_KEY) return primary;
    assertSafeBaseUrl('AI_FALLBACK_BASE_URL', env.AI_FALLBACK_BASE_URL);
    return new FallbackProvider(primary, new OpenAiCompatibleProvider(env.AI_FALLBACK_BASE_URL, env.AI_FALLBACK_MODEL, env.AI_FALLBACK_API_KEY, env.AI_TIMEOUT_MS));
  }
  return new MockProvider();
}
