/**
 * PlannerAgent — Decomposes a user prompt into a file structure plan.
 * 
 * This is essentially the same as the existing Phase 1 planning logic from ai.js,
 * but encapsulated as a standalone agent with its own identity and timeline logging.
 * 
 * Input:  User prompt (string)
 * Output: { files: [{path, description, exports, imports}], projectName, projectDescription }
 */

import { executeResilientLLM } from '../llmResilience.js';
import { FilePlanSchema } from '../aiSchemas.js';
import { FILE_PLAN_SYSTEM } from '../prompts.js';

export class PlannerAgent {
    constructor(model = null) {
        this.model = model;
        this.name = 'planner';
    }

    async run(prompt, context) {
        context.addTimelineEntry(this.name, 'Analyzing prompt and planning file structure...');

        console.log(`[PlannerAgent] Planning file structure for: "${prompt.slice(0, 80)}..."`);

        const { object: plan, modelUsed } = await executeResilientLLM({
            schema: FilePlanSchema,
            system: FILE_PLAN_SYSTEM,
            prompt: `Plan a React website for: ${prompt}`,
            onFallback: (fromModel, toModel) => {
                context.addTimelineEntry(this.name, `Model fallback: ${fromModel} → ${toModel}`);
            },
        });

        console.log(`[PlannerAgent] Generated plan using model '${modelUsed}'`);

        // Ensure /App.js always exists
        if (!plan.files.find((f) => f.path === '/App.js')) {
            plan.files.unshift({
                path: '/App.js',
                description: 'Main application entry point',
                exports: 'default App',
                imports: ['./styles.css'],
            });
        }

        // Ensure /styles.css always exists
        if (!plan.files.find((f) => f.path === '/styles.css')) {
            plan.files.push({
                path: '/styles.css',
                description: 'Global CSS: Google Font import, keyframe animations, utility classes',
                exports: 'none',
                imports: [],
            });
        }

        context.setPlan(plan);
        context.addTimelineEntry(this.name, `Planned ${plan.files.length} files`, {
            files: plan.files.map((f) => f.path),
            projectName: plan.projectName,
        });

        console.log(`[PlannerAgent] Plan created: ${plan.files.length} files — ${plan.files.map((f) => f.path).join(', ')}`);

        return plan;
    }
}
