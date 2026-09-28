/**
 * ReviewerAgent — Validates generated code quality and cross-file consistency.
 * 
 * This is the NEW agent that didn't exist before. It acts as a quality gate:
 * - Checks for broken imports (File A imports from File B, but B doesn't export that)
 * - Detects missing default exports
 * - Finds missing React imports in JSX files
 * - Validates CSS class references
 * - Checks for common anti-patterns
 * 
 * The reviewer uses the LLM to do semantic analysis (not just regex/AST).
 * 
 * Input:  All generated files + plan (from AgentContext)
 * Output: { issues: [{file, severity, message, suggestion}], score, summary }
 */

import { executeResilientLLM } from '../llmResilience.js';
import { z } from 'zod';
import { REVIEW_SYSTEM } from '../prompts.js';

// Schema for the reviewer's structured output
const ReviewResultSchema = z.object({
    issues: z.array(
        z.object({
            file: z.string(),                                   // which file has the issue
            severity: z.enum(['error', 'warning', 'info']),     // how critical
            message: z.string(),                                 // what's wrong
            suggestion: z.string().optional().default(''),       // how to fix it
        })
    ),
    score: z.number().min(0).max(10),                           // overall quality 0-10
    summary: z.string(),                                         // one-line summary
});

export class ReviewerAgent {
    constructor(model = null) {
        this.model = model;
        this.name = 'reviewer';
    }

    /**
     * Perform a static analysis pass (no LLM needed) to catch obvious issues.
     * This runs fast and catches things the LLM might miss.
     */
    staticAnalysis(files, plan) {
        const issues = [];

        for (const [path, code] of Object.entries(files)) {
            const ext = path.split('.').pop()?.toLowerCase();
            if (ext === 'css') continue; // skip CSS for JS-specific checks

            // Check 1: Missing React import in JSX files
            const hasJSX = /<[A-Z]/.test(code) || /className=/.test(code);
            const hasReactImport = /import\s+React/.test(code);
            if (hasJSX && !hasReactImport) {
                issues.push({
                    file: path,
                    severity: 'error',
                    message: 'File contains JSX but is missing `import React from "react"`',
                    suggestion: 'Add `import React from "react";` at the top of the file',
                });
            }

            // Check 2: Missing default export in component files
            if (ext === 'js' || ext === 'jsx') {
                const hasDefaultExport = /export\s+default\s+/.test(code);
                if (!hasDefaultExport && path !== '/styles.css') {
                    issues.push({
                        file: path,
                        severity: 'error',
                        message: 'Component file is missing a default export',
                        suggestion: 'Add `export default function ComponentName() { ... }`',
                    });
                }
            }

            // Check 3: Cross-file import validation
            const importMatches = code.matchAll(/import\s+(?:[\w{},\s]+)\s+from\s+['"](\.[^'"]+)['"]/g);
            for (const match of importMatches) {
                let importPath = match[1];
                // Normalize: ./components/Header → /components/Header.js
                if (!importPath.endsWith('.js') && !importPath.endsWith('.jsx') && !importPath.endsWith('.css')) {
                    importPath += '.js';
                }
                // Convert relative to absolute within project
                if (importPath.startsWith('./')) {
                    importPath = importPath.replace('./', '/');
                }
                // Check if the imported file exists
                const exists = files[importPath] || files[importPath.replace('.js', '.jsx')];
                if (!exists) {
                    issues.push({
                        file: path,
                        severity: 'error',
                        message: `Imports from '${match[1]}' but that file does not exist in the project`,
                        suggestion: `Check if the file path is correct or if the file was planned but failed to generate`,
                    });
                }
            }

            // Check 4: Using 'class=' instead of 'className=' in JSX
            const classAttrMatch = code.match(/\bclass=/);
            if (classAttrMatch && hasJSX) {
                issues.push({
                    file: path,
                    severity: 'warning',
                    message: 'Uses `class=` instead of `className=` in JSX',
                    suggestion: 'Replace `class=` with `className=`',
                });
            }
        }

        return issues;
    }

    /**
     * Perform an AI-powered review for deeper semantic issues.
     * This catches things static analysis can't: style inconsistency,
     * missing functionality, broken component contracts, etc.
     */
    async aiReview(files, plan, context) {
        // Build file contents summary for the LLM
        const fileContents = Object.entries(files)
            .map(([path, code]) => `### ${path}\n\`\`\`\n${code}\n\`\`\``)
            .join('\n\n');

        const planSummary = plan.files
            .map((f) => `- ${f.path}: ${f.description} (exports: ${f.exports || 'none'})`)
            .join('\n');

        const prompt = `## Project Plan\n${planSummary}\n\n## Generated Files\n${fileContents}\n\nReview these files for quality, consistency, and correctness. Focus on:\n1. Cross-file import/export mismatches\n2. Missing functionality that the plan describes\n3. Style inconsistencies across components\n4. Common React anti-patterns\n5. Accessibility issues`;

        try {
            const { object: review } = await executeResilientLLM({
                schema: ReviewResultSchema,
                system: REVIEW_SYSTEM,
                prompt,
            });
            return review;
        } catch (err) {
            console.warn(`[ReviewerAgent] AI review failed, using static analysis only: ${err.message}`);
            return null;
        }
    }

    /**
     * Run the full review pipeline: static analysis + AI review.
     */
    async run(context) {
        context.addTimelineEntry(this.name, 'Reviewing generated code for quality and consistency...');
        console.log(`[ReviewerAgent] Starting code review for ${Object.keys(context.files).length} files`);

        const files = context.getAllFiles();
        const plan = context.plan;

        // Phase 1: Fast static analysis
        const staticIssues = this.staticAnalysis(files, plan);
        console.log(`[ReviewerAgent] Static analysis found ${staticIssues.length} issues`);

        // Phase 2: AI-powered review
        // IMPORTANT: Skip AI review for free/limited models to avoid context window overflows.
        // The static analysis catches the most critical issues (broken imports, missing exports).
        // AI review is only worth the cost for paid models with large context windows.
        let aiReview = null;
        const fileCount = Object.keys(files).length;
        const totalCodeSize = Object.values(files).reduce((sum, code) => sum + code.length, 0);
        const modelName = process.env.OPENROUTER_MODEL || '';
        const isFreeModel = modelName.includes(':free') || modelName.includes('free');

        // Only run AI review if: paid model AND small enough to fit in context
        if (!isFreeModel && fileCount > 2 && totalCodeSize < 30000) {
            context.addTimelineEntry(this.name, 'Running AI-powered deep review...');
            aiReview = await this.aiReview(files, plan, context);
        } else if (isFreeModel) {
            console.log(`[ReviewerAgent] Skipping AI review (free model — context too expensive)`);
            context.addTimelineEntry(this.name, 'Using static analysis only (optimized for free model)');
        }

        // Combine results
        const allIssues = [...staticIssues];
        if (aiReview?.issues) {
            // Deduplicate: don't add AI issues that overlap with static issues
            for (const aiIssue of aiReview.issues) {
                const isDuplicate = staticIssues.some(
                    (si) => si.file === aiIssue.file && si.message.includes(aiIssue.message.slice(0, 30))
                );
                if (!isDuplicate) {
                    allIssues.push(aiIssue);
                }
            }
        }

        const errorCount = allIssues.filter((i) => i.severity === 'error').length;
        const warningCount = allIssues.filter((i) => i.severity === 'warning').length;
        // Score calculation: static-only analysis gets a generous score since
        // the existing codeValidator.js already fixes most issues (class→className, 
        // missing React imports, etc.) during generation. Only truly broken imports
        // should tank the score.
        const score = aiReview?.score ?? Math.max(5, 10 - errorCount * 1.5 - warningCount * 0.3);

        const review = {
            issues: allIssues,
            score: Math.round(score * 10) / 10,
            summary: aiReview?.summary || `Found ${errorCount} errors and ${warningCount} warnings`,
            errorCount,
            warningCount,
        };

        context.addReview(review);
        context.addTimelineEntry(this.name, `Review complete: score ${review.score}/10 — ${errorCount} errors, ${warningCount} warnings`, {
            score: review.score,
            errorCount,
            warningCount,
        });

        console.log(`[ReviewerAgent] Review complete: score=${review.score}, errors=${errorCount}, warnings=${warningCount}`);

        return review;
    }
}
