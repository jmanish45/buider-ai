/**
 * FixerAgent — Auto-corrects issues found by the ReviewerAgent.
 * 
 * This is a NEW agent that acts on the reviewer's findings.
 * It receives specific issues and applies targeted fixes using the LLM.
 * Only files with errors are re-processed — unchanged files are left alone.
 * 
 * Input:  Review issues + current files (from AgentContext)
 * Output: Updated files with fixes applied
 */

import { executeResilientLLM } from '../llmResilience.js';
import { z } from 'zod';
import { normalizeContent } from '../contentNormalizer.js';
import { validateAndFixCode } from '../codeValidator.js';

// Schema for the fixer's output — targeted patches, not full rewrites
const FixResultSchema = z.object({
    fixes: z.array(
        z.object({
            file: z.string(),           // which file to fix
            fixedCode: z.string(),      // the complete corrected file content
            whatChanged: z.string(),    // description of the fix
        })
    ),
});

export class FixerAgent {
    constructor(model = null) {
        this.model = model;
        this.name = 'fixer';
    }

    /**
     * Apply quick local fixes that don't need the LLM (string replacements).
     * Returns the number of fixes applied.
     */
    applyQuickFixes(files, issues) {
        let fixCount = 0;

        for (const issue of issues) {
            const code = files[issue.file];
            if (!code) continue;

            // Quick fix: missing React import
            if (issue.message.includes('missing `import React')) {
                if (!/import\s+React/.test(code)) {
                    files[issue.file] = `import React from 'react';\n${code}`;
                    fixCount++;
                    console.log(`[FixerAgent] Quick fix: added React import to ${issue.file}`);
                }
            }

            // Quick fix: class= → className=
            if (issue.message.includes('class=') && issue.message.includes('className=')) {
                // Use the existing codeValidator for this — it's more robust
                const validation = validateAndFixCode(code, issue.file, {});
                if (validation.code !== code) {
                    files[issue.file] = validation.code;
                    fixCount++;
                    console.log(`[FixerAgent] Quick fix: fixed class→className in ${issue.file}`);
                }
            }
        }

        return fixCount;
    }

    /**
     * Use the LLM to fix complex issues that require understanding context.
     */
    async aiFix(files, issues, context) {
        // Only send error-level issues to the LLM (not warnings/info)
        const errorIssues = issues.filter((i) => i.severity === 'error');
        if (errorIssues.length === 0) return [];

        // Group issues by file to minimize LLM calls
        const issuesByFile = {};
        for (const issue of errorIssues) {
            if (!issuesByFile[issue.file]) issuesByFile[issue.file] = [];
            issuesByFile[issue.file].push(issue);
        }

        // Only include files that have issues + their import dependencies
        const relevantFiles = {};
        for (const filePath of Object.keys(issuesByFile)) {
            relevantFiles[filePath] = files[filePath];
        }
        // Also include files that are imported by broken files (for context)
        for (const [path, code] of Object.entries(files)) {
            if (!relevantFiles[path] && Object.keys(issuesByFile).some((f) => files[f]?.includes(path.replace(/^\//, './')))) {
                relevantFiles[path] = code;
            }
        }

        const fileContents = Object.entries(relevantFiles)
            .map(([path, code]) => `### ${path}\n\`\`\`\n${code}\n\`\`\``)
            .join('\n\n');

        const issueList = errorIssues
            .map((i) => `- [${i.severity.toUpperCase()}] ${i.file}: ${i.message}${i.suggestion ? ` (suggestion: ${i.suggestion})` : ''}`)
            .join('\n');

        const prompt = `## Issues Found\n${issueList}\n\n## Files to Fix\n${fileContents}\n\nFix ONLY the issues listed above. Return the corrected file contents. Do NOT change anything that isn't broken.`;

        const FIXER_SYSTEM = `You are a senior code fixer. You receive a list of specific issues in React component files and must return the corrected file contents.

Rules:
- Fix ONLY the specific issues listed — do not refactor or restyle
- Keep all existing functionality, styling, and structure intact
- Return the COMPLETE file content (not just the changed lines)
- Use className (not class), htmlFor (not for)
- Always include 'import React from "react"' in JSX files
- Ensure every component has a default export
- Fix import paths to match actual file names in the project`;

        try {
            const { object: result } = await executeResilientLLM({
                schema: FixResultSchema,
                system: FIXER_SYSTEM,
                prompt,
            });
            return result.fixes || [];
        } catch (err) {
            console.warn(`[FixerAgent] AI fix failed: ${err.message}`);
            return [];
        }
    }

    /**
     * Run the full fix pipeline: quick fixes first, then AI fixes for complex issues.
     */
    async run(context) {
        const review = context.getLatestReview();
        if (!review || review.issues.length === 0) {
            context.addTimelineEntry(this.name, 'No issues to fix — skipping');
            return context.getAllFiles();
        }

        const errorCount = review.issues.filter((i) => i.severity === 'error').length;
        context.addTimelineEntry(this.name, `Fixing ${review.issues.length} issues (${errorCount} errors)...`);
        console.log(`[FixerAgent] Fixing ${review.issues.length} issues`);

        const files = context.getAllFiles();

        // Phase 1: Quick local fixes (no LLM needed)
        const quickFixCount = this.applyQuickFixes(files, review.issues);
        if (quickFixCount > 0) {
            context.addTimelineEntry(this.name, `Applied ${quickFixCount} quick fixes`);
        }

        // Phase 2: AI-powered fixes for remaining errors
        const remainingErrors = review.issues.filter((i) => {
            if (i.severity !== 'error') return false;
            // Check if the issue was already fixed by quick fixes
            if (i.message.includes('missing `import React') && /import\s+React/.test(files[i.file] || '')) return false;
            return true;
        });

        if (remainingErrors.length > 0) {
            const modelName = process.env.OPENROUTER_MODEL || '';
            const isFreeModel = modelName.includes(':free') || modelName.includes('free');

            if (isFreeModel) {
                console.log(`[FixerAgent] Skipping AI fixes (free model — using quick fixes only)`);
                context.addTimelineEntry(this.name, `Skipped AI fixes (free model) — ${remainingErrors.length} issues remain as warnings`);
            } else {
                context.addTimelineEntry(this.name, `Using AI to fix ${remainingErrors.length} complex issues...`);
                const aiFixes = await this.aiFix(files, remainingErrors, context);

                for (const fix of aiFixes) {
                    const fixPath = fix.file.startsWith('/') ? fix.file : '/' + fix.file;
                    if (files[fixPath]) {
                        let fixedCode = normalizeContent(fix.fixedCode);
                        const validation = validateAndFixCode(fixedCode, fixPath, {});
                        fixedCode = validation.code;
                        files[fixPath] = fixedCode;
                        console.log(`[FixerAgent] AI fixed: ${fixPath} — ${fix.whatChanged}`);
                    }
                }

                context.addTimelineEntry(this.name, `Applied ${aiFixes.length} AI-powered fixes`);
            }
        }

        // Update shared context with fixed files
        context.setFiles(files);
        context.addTimelineEntry(this.name, 'All fixes applied');

        return files;
    }
}
