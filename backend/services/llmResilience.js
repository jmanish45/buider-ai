/**
 * llmResilience.js — Fault-Tolerant Multi-Model Fallback Tier & Rate Limiter
 * 
 * Scalability & Resilience Advancement:
 * Solves OpenRouter free-tier rate limits (HTTP 429), provider outages (503s), and model-specific failures.
 * Automatically tries fallback models in prioritized order with randomized exponential jitter backoff.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';

// Prioritized pool of high-quality free/efficient models on OpenRouter
export const DEFAULT_MODEL_POOL = [
    process.env.OPENROUTER_MODEL || 'cohere/north-mini-code:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemini-2.0-flash-exp:free',
    'deepseek/deepseek-r1-distill-llama-70b:free',
    'mistralai/mistral-small-3.2-24b-instruct:free',
    'openrouter/free'
].filter((m, idx, arr) => m && arr.indexOf(m) === idx); // deduplicate

const openrouter = createOpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
});

/**
 * Sleep helper with exponential backoff and randomized jitter
 */
function sleepWithJitter(baseDelayMs, attempt) {
    const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 500; // 0-500ms random jitter to avoid thundering herd
    const delay = Math.min(exponentialDelay + jitter, 10000); // cap at 10s
    return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Execute an LLM call with multi-model fallback and rate-limit retry logic.
 * 
 * @param {Object} options
 * @param {Object} options.schema - Zod schema for structured output
 * @param {string} options.system - System prompt
 * @param {string} options.prompt - User message / instruction
 * @param {number} [options.temperature=0.3]
 * @param {Array<string>} [options.modelPool=DEFAULT_MODEL_POOL]
 * @param {Function} [options.onFallback] - Callback when model switches (agent, fallbackModel, error)
 * @returns {Promise<{ object: any, modelUsed: string, attempts: number }>}
 */
export async function executeResilientLLM(options) {
    const {
        schema,
        system,
        prompt,
        temperature = 0.3,
        modelPool = DEFAULT_MODEL_POOL,
        onFallback,
    } = options;

    let lastError = null;
    let attempt = 0;

    for (let modelIdx = 0; modelIdx < modelPool.length; modelIdx++) {
        const modelName = modelPool[modelIdx];
        const model = openrouter(modelName);

        // Try up to 2 attempts per model (for transient network/rate spikes)
        for (let retry = 0; retry < 2; retry++) {
            attempt++;
            try {
                const startTime = Date.now();
                const result = await generateObject({
                    model,
                    schema,
                    system,
                    prompt,
                    temperature,
                    maxRetries: 0, // We handle retries and fallbacks ourselves
                });

                const duration = Date.now() - startTime;
                if (modelIdx > 0 || retry > 0) {
                    console.log(`[LLM Resilience] Succeeded on model '${modelName}' after ${attempt} attempt(s) (${duration}ms)`);
                }

                return {
                    object: result.object,
                    modelUsed: modelName,
                    attempts: attempt,
                };
            } catch (err) {
                lastError = err;
                const errMsg = err.message || String(err);
                const isRateLimit = errMsg.includes('429') || errMsg.includes('rate') || errMsg.includes('quota');
                const isServerError = errMsg.includes('500') || errMsg.includes('502') || errMsg.includes('503') || errMsg.includes('504');

                console.warn(`[LLM Resilience] Model '${modelName}' attempt ${retry + 1} failed: ${errMsg.slice(0, 120)}`);

                if (isRateLimit || isServerError) {
                    // Wait with jitter before next attempt
                    await sleepWithJitter(1000, retry);
                }
            }
        }

        // If this model exhausted retries, notify and fallback to next model
        if (modelIdx < modelPool.length - 1) {
            const nextModel = modelPool[modelIdx + 1];
            console.warn(`[LLM Resilience] ⚠️ Falling back from '${modelName}' to next tier model '${nextModel}'...`);
            if (typeof onFallback === 'function') {
                try {
                    onFallback(modelName, nextModel, lastError);
                } catch { }
            }
        }
    }

    throw new Error(`[LLM Resilience] All ${modelPool.length} models in fallback pool failed. Last error: ${lastError?.message || lastError}`);
}

/**
 * Get an instance of the primary OpenRouter model for standard calls
 */
export function getPrimaryModel() {
    return openrouter(DEFAULT_MODEL_POOL[0]);
}
