/**
 * Orchestrator — Controls the multi-agent workflow.
 * 
 * Coordinates: Planner → Coder → Reviewer → Fixer (loop)
 * 
 * This is the entry point that projectController.js calls instead of
 * the old generateProject() function. It manages:
 * - Agent execution order
 * - Self-correcting review/fix loops (max 2 iterations)
 * - WebSocket event emissions at each stage
 * - Timeline logging for the frontend dashboard
 * 
 * The orchestrator does NOT generate code itself — it delegates to agents.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { AgentContext } from './agentContext.js';
import { PlannerAgent } from './plannerAgent.js';
import { CoderAgent } from './coderAgent.js';
import { ReviewerAgent } from './reviewerAgent.js';
import { FixerAgent } from './fixerAgent.js';
import { socketManager } from '../socketManager.js';

// --- Model setup (same as ai.js) ---
const MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';

const openrouter = createOpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
});

const model = openrouter(MODEL);

// Quality threshold: if reviewer score is below this, run the fixer
const QUALITY_THRESHOLD = 7;
// Maximum review→fix iterations to prevent infinite loops
const MAX_FIX_ITERATIONS = 2;

export class Orchestrator {
    constructor(projectId) {
        this.projectId = projectId;
        this.context = new AgentContext(projectId);

        // Initialize all agents (they utilize resilient multi-model fallback execution)
        this.agents = {
            planner: new PlannerAgent(),
            coder: new CoderAgent(),
            reviewer: new ReviewerAgent(),
            fixer: new FixerAgent(),
        };
    }

    /**
     * Emit a WebSocket event + add to timeline.
     */
    emit(event, data) {
        socketManager.emitToProject(this.projectId, event, data);
    }

    /**
     * Execute the full agent pipeline.
     * 
     * @param {string} prompt - The user's original prompt
     * @param {object} callbacks - Progress callbacks for database updates:
     *   - onPlan(plan) — called when planner finishes
     *   - onFileStart(path) — called when coder starts a file
     *   - onFileComplete(path, code) — called when coder finishes a file
     *   - onReview(review) — called when reviewer finishes
     *   - onFixStart() — called when fixer starts
     *   - onFixComplete() — called when fixer finishes
     * @returns {{ files, description }} — same shape as the old generateProject()
     */
    async execute(prompt, callbacks = {}) {
        this.context.prompt = prompt;

        console.log(`[Orchestrator] Starting multi-agent pipeline for project ${this.projectId}`);
        this.context.addTimelineEntry('orchestrator', 'Starting multi-agent pipeline...');

        // ═══════════════════════════════════════════════
        // STEP 1: PLANNER — decompose prompt into file plan
        // ═══════════════════════════════════════════════
        this.emit('agent:step', { agent: 'planner', status: 'running', message: 'Planning file structure...' });

        const plan = await this.agents.planner.run(prompt, this.context);

        this.emit('agent:step', { agent: 'planner', status: 'done', message: `Planned ${plan.files.length} files` });

        if (callbacks.onPlan) {
            await callbacks.onPlan(plan);
        }

        // ═══════════════════════════════════════════════
        // STEP 2: CODER — generate all files in parallel
        // ═══════════════════════════════════════════════
        this.emit('agent:step', { agent: 'coder', status: 'running', message: 'Generating code...' });

        const files = await this.agents.coder.run(this.context, {
            onFileStart: async (path) => {
                this.emit('agent:step', { agent: 'coder', status: 'running', message: `Writing ${path}...` });
                if (callbacks.onFileStart) await callbacks.onFileStart(path);
            },
            onFileComplete: async (path, code) => {
                if (callbacks.onFileComplete) await callbacks.onFileComplete(path, code);
            },
        });

        this.emit('agent:step', { agent: 'coder', status: 'done', message: `Generated ${Object.keys(files).length} files` });

        // ═══════════════════════════════════════════════
        // STEP 3: REVIEWER → FIXER LOOP (self-correcting)
        // Wrapped in try-catch: if review/fix fails, we still
        // have working code from the Coder — better to deliver
        // than to fail the entire generation.
        // ═══════════════════════════════════════════════
        try {
        for (let iteration = 1; iteration <= MAX_FIX_ITERATIONS; iteration++) {
            // --- Review ---
            this.emit('agent:step', {
                agent: 'reviewer',
                status: 'running',
                message: iteration === 1 ? 'Reviewing code quality...' : `Re-reviewing after fixes (round ${iteration})...`,
            });

            const review = await this.agents.reviewer.run(this.context);

            this.emit('agent:step', {
                agent: 'reviewer',
                status: 'done',
                message: `Score: ${review.score}/10 — ${review.errorCount} errors, ${review.warningCount} warnings`,
                data: { score: review.score, errorCount: review.errorCount, warningCount: review.warningCount },
            });
            this.emit('agent:review', {
                score: review.score,
                issues: review.issues.slice(0, 10), // send at most 10 issues to frontend
                summary: review.summary,
                iteration,
            });

            if (callbacks.onReview) {
                await callbacks.onReview(review, iteration);
            }

            // If quality is above threshold OR no errors, stop the loop
            if (review.score >= QUALITY_THRESHOLD || review.errorCount === 0) {
                this.context.addTimelineEntry('orchestrator',
                    `Quality check passed (score: ${review.score}/10) — no fixes needed`
                );
                console.log(`[Orchestrator] Quality threshold met (${review.score}/${QUALITY_THRESHOLD}). Skipping fixer.`);
                break;
            }

            // --- Fix ---
            this.emit('agent:step', { agent: 'fixer', status: 'running', message: 'Auto-correcting issues...' });

            if (callbacks.onFixStart) await callbacks.onFixStart(iteration);

            await this.agents.fixer.run(this.context);

            this.emit('agent:step', { agent: 'fixer', status: 'done', message: 'Fixes applied' });

            if (callbacks.onFixComplete) await callbacks.onFixComplete(iteration);

            // If this is the last iteration, don't re-review
            if (iteration === MAX_FIX_ITERATIONS) {
                this.context.addTimelineEntry('orchestrator',
                    `Reached max fix iterations (${MAX_FIX_ITERATIONS}). Proceeding with current state.`
                );
            }
        }
        } catch (reviewErr) {
            // Review/Fix pipeline failed — log and continue with coder's output
            console.warn(`[Orchestrator] Review/fix pipeline failed (non-fatal): ${reviewErr.message}`);
            this.context.addTimelineEntry('orchestrator', `Review/fix skipped due to error: ${reviewErr.message}`);
            this.emit('agent:step', { agent: 'reviewer', status: 'done', message: 'Review skipped (error — using coder output as-is)' });
        }

        // ═══════════════════════════════════════════════
        // DONE — return final files
        // ═══════════════════════════════════════════════
        const finalFiles = this.context.getAllFiles();
        const timeline = this.context.getTimeline();

        this.context.addTimelineEntry('orchestrator', 'Pipeline complete!');
        this.emit('agent:step', { agent: 'orchestrator', status: 'done', message: 'All agents finished' });

        console.log(`[Orchestrator] Pipeline complete. ${Object.keys(finalFiles).length} files, ${timeline.length} timeline entries.`);

        return {
            files: finalFiles,
            description: this.context.plan?.projectDescription || 'Generated project',
            timeline,
        };
    }
}
