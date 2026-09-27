/**
 * CoderAgent — Generates code for each file in the plan.
 * 
 * Uses parallel execution (p-map) with configurable concurrency.
 * Each file goes through: LLM generation → content normalization → code validation.
 * 
 * This is the same logic as the existing file generation in ai.js,
 * but encapsulated as a standalone agent with progress callbacks.
 * 
 * Input:  Plan (from PlannerAgent) + prompt + AgentContext
 * Output: { path: code } map of all generated files
 */

import { generateObject } from 'ai';
import pMap from 'p-map';
import { FileCodeSchema } from '../aiSchemas.js';
import { buildFileCodeSystem } from '../prompts.js';
import { normalizeContent } from '../contentNormalizer.js';
import { validateAndFixCode } from '../codeValidator.js';

const MAX_CONCURRENCY = parseInt(process.env.AI_MAX_CONCURRENCY || '6', 10);

export class CoderAgent {
    constructor(model) {
        this.model = model;
        this.name = 'coder';
    }

    /**
     * Generate code for a single file.
     */
    async generateSingleFile(file, allFiles, prompt, alreadyGeneratedFiles) {
        const system = buildFileCodeSystem(allFiles, alreadyGeneratedFiles);

        const userMsg = `Project: ${prompt}\n\nWrite the complete code for: ${file.path}\nPurpose: ${file.description}`;

        console.log(`[CoderAgent] Generating: ${file.path}...`);
        const { object } = await generateObject({
            model: this.model,
            schema: FileCodeSchema,
            system,
            prompt: userMsg,
            maxRetries: 2,
        });

        let code = normalizeContent(object.code);

        if (code.trim().length === 0) {
            throw new Error('Generated code is empty after normalization');
        }

        // Apply post-generation validation and auto-fixing
        const validation = validateAndFixCode(code, file.path, { allPlannedFiles: allFiles });
        code = validation.code;

        if (validation.warnings.length > 0) {
            console.log(`[CoderAgent] Fixes for ${file.path}:\n  - ${validation.warnings.join('\n  - ')}`);
        }

        console.log(`[CoderAgent] Generated: ${file.path} (${code.length} chars)`);
        return { path: file.path, code };
    }

    /**
     * Generate all files in parallel with retry rounds.
     * Calls onFileStart/onFileComplete callbacks for progress tracking.
     */
    async run(context, callbacks = {}) {
        const plan = context.plan;
        const prompt = context.prompt;

        context.addTimelineEntry(this.name, `Generating ${plan.files.length} files (concurrency: ${MAX_CONCURRENCY})...`);
        console.log(`[CoderAgent] Generating ${plan.files.length} files in parallel (concurrency=${MAX_CONCURRENCY})`);

        const files = {};
        let pendingFiles = plan.files.map((f) => ({ ...f }));
        const maxRetryRounds = 2;

        for (let round = 0; round <= maxRetryRounds; round++) {
            if (pendingFiles.length === 0) break;

            if (round > 0) {
                context.addTimelineEntry(this.name, `Retry round ${round} for ${pendingFiles.length} failed files`);
                console.log(`[CoderAgent] Retry round ${round}/${maxRetryRounds} for: ${pendingFiles.map((f) => f.path).join(', ')}`);
            }

            const results = await pMap(
                pendingFiles,
                async (file) => {
                    try {
                        if (callbacks.onFileStart) {
                            await callbacks.onFileStart(file.path);
                        }

                        context.addTimelineEntry(this.name, `Writing ${file.path}...`, { file: file.path });

                        const singleResult = await this.generateSingleFile(file, plan.files, prompt, files);

                        // Store in shared context immediately
                        context.setFile(singleResult.path, singleResult.code);

                        if (callbacks.onFileComplete) {
                            await callbacks.onFileComplete(file.path, singleResult.code);
                        }

                        return { success: true, file, result: singleResult };
                    } catch (err) {
                        return { success: false, file, error: err };
                    }
                },
                { concurrency: MAX_CONCURRENCY },
            );

            const failedFiles = [];
            for (const entry of results) {
                if (entry.success) {
                    const { path, code } = entry.result;
                    files[path.startsWith('/') ? path : '/' + path] = code;
                } else {
                    console.warn(`[CoderAgent] ${entry.file.path} failed (round ${round}): ${entry.error?.message || entry.error}`);
                    failedFiles.push(entry.file);
                }
            }
            pendingFiles = failedFiles;
        }

        // Handle files that failed after all retries
        if (pendingFiles.length > 0) {
            const failedPaths = pendingFiles.map((f) => f.path).join(', ');
            console.error(`[CoderAgent] Failed after all retries: ${failedPaths}`);

            if (pendingFiles.some((f) => f.path === '/App.js')) {
                throw new Error('AI did not generate /App.js entry point');
            }

            // Generate placeholder components for non-critical failed files
            for (const file of pendingFiles) {
                const ext = file.path.split('.').pop()?.toLowerCase();
                if (ext === 'css') {
                    files[file.path] = `/* ${file.description} — Generation failed, please retry */\n`;
                } else {
                    files[file.path] =
                        "import React from 'react';\n\n" +
                        `// ⚠️ This file could not be generated. Please retry.\n` +
                        `// Purpose: ${file.description}\n\n` +
                        'export default function Placeholder() {\n' +
                        '  return (\n' +
                        "    <div className='p-8 text-center text-zinc-400'>\n" +
                        '      <p>⚠️ Component failed to generate. Please try again.</p>\n' +
                        '    </div>\n' +
                        '  );\n' +
                        '}\n';
                }
                context.setFile(file.path, files[file.path]);
            }
        }

        if (!files['/App.js']) {
            throw new Error('AI did not generate /App.js entry point');
        }

        // Update shared context with all files
        context.setFiles(files);
        context.addTimelineEntry(this.name, `Code generation complete — ${Object.keys(files).length} files`, {
            fileCount: Object.keys(files).length,
        });

        return files;
    }
}
