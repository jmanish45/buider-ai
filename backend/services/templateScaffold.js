/**
 * templateScaffold.js — Deterministic Static Template Generator
 * 
 * Scalability & Efficiency Advancement:
 * Eliminates LLM token consumption and hallucination for standard config and boilerplate files.
 * Provides pre-optimized, verified static templates for common files.
 */

export const STATIC_TEMPLATES = {
    '/styles.css': `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --primary: #4f46e5;
  --primary-hover: #4338ca;
  --bg-main: #ffffff;
  --surface: #fafafa;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: var(--bg-main);
  color: #18181b;
  margin: 0;
  padding: 0;
  -webkit-font-smoothing: antialiased;
}

/* Animations */
@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-8px); }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes pulseGlow {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}

.animate-float {
  animation: float 4s ease-in-out infinite;
}

.animate-fade-in-up {
  animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.animate-fade-in {
  animation: fadeIn 0.4s ease-out forwards;
}

.animate-pulse-glow {
  animation: pulseGlow 3s ease-in-out infinite;
}
`,
};

/**
 * Check if a file can be generated deterministically without an LLM call.
 */
export function isDeterministicFile(filePath) {
    // Only styles.css if simple, or we can use it as instant initial seed
    return false; // By default we let LLM customize unless fallback needed
}

/**
 * Get verified fallback content for standard files if generation fails.
 */
export function getFallbackTemplate(filePath) {
    return STATIC_TEMPLATES[filePath] || null;
}
