/**
 * AgentContext — Shared memory between all agents in the orchestration pipeline.
 * 
 * Each agent reads from and writes to this context. It acts as the "scratchpad"
 * that enables agents to collaborate without directly calling each other.
 * 
 * Also maintains a timeline log of all agent actions for the frontend dashboard.
 */

export class AgentContext {
    constructor(projectId) {
        this.projectId = projectId;
        this.plan = null;           // Set by PlannerAgent
        this.files = {};            // Set by CoderAgent, updated by FixerAgent
        this.reviews = [];          // Set by ReviewerAgent
        this.timeline = [];         // Timeline of all agent actions (for frontend)
        this.prompt = '';           // Original user prompt
    }

    setPlan(plan) {
        this.plan = plan;
    }

    setFiles(files) {
        this.files = { ...this.files, ...files };
    }

    setFile(path, code) {
        this.files[path.startsWith('/') ? path : '/' + path] = code;
    }

    getFile(path) {
        return this.files[path] || this.files['/' + path] || null;
    }

    getAllFiles() {
        return { ...this.files };
    }

    addReview(review) {
        this.reviews.push(review);
    }

    getLatestReview() {
        return this.reviews.length > 0 ? this.reviews[this.reviews.length - 1] : null;
    }

    /**
     * Add a timestamped entry to the agent activity timeline.
     * The frontend reads this to show a live log of what each agent is doing.
     */
    addTimelineEntry(agent, action, details = null) {
        const entry = {
            agent,                        // 'planner' | 'coder' | 'reviewer' | 'fixer'
            action,                       // e.g., 'Planning file structure...'
            details,                      // optional extra data
            timestamp: Date.now(),
        };
        this.timeline.push(entry);
        return entry;
    }

    getTimeline() {
        return [...this.timeline];
    }

    /**
     * Build a summary of the current state for agents that need context.
     */
    getSummary() {
        return {
            projectId: this.projectId,
            prompt: this.prompt,
            plan: this.plan,
            fileCount: Object.keys(this.files).length,
            filePaths: Object.keys(this.files),
            reviewCount: this.reviews.length,
            latestReview: this.getLatestReview(),
        };
    }
}
