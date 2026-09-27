import { CheckCircle2Icon, CircleIcon, Loader2Icon, BrainIcon, CodeIcon, SearchIcon, WrenchIcon, SparklesIcon } from "lucide-react";
import { useAppContext } from "../context/AppContext";

// Map agent names to icons and colors
const AGENT_CONFIG = {
    planner:      { icon: BrainIcon,    label: 'Planner',     color: 'text-violet-500' },
    coder:        { icon: CodeIcon,     label: 'Coder',       color: 'text-blue-500' },
    reviewer:     { icon: SearchIcon,   label: 'Reviewer',    color: 'text-amber-500' },
    fixer:        { icon: WrenchIcon,   label: 'Fixer',       color: 'text-emerald-500' },
    orchestrator: { icon: SparklesIcon, label: 'Orchestrator', color: 'text-zinc-500' },
};

export default function AgentProgressDashboard({ project }) {
    const { agentSteps } = useAppContext();

    const planned = project.filesPlanned || [];
    const completed = project.filesGenerated || [];
    const current = project.currentFile;
    const isFailed = project.status === "failed";
    const isReviewing = project.status === "reviewing";

    return (
        <div className="h-full w-full bg-zinc-50 flex flex-col items-center justify-center p-6 md:p-12 overflow-y-auto">
            <div className="max-w-xl w-full bg-white border border-zinc-200 rounded-2xl p-6 md:p-8 relative overflow-hidden">
                {/* Status Header */}
                <div className="flex items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-base font-medium text-zinc-800">
                            {isFailed
                                ? "Generation Failed"
                                : project.status === "pending"
                                  ? "Planning Architecture..."
                                  : isReviewing
                                    ? "Reviewing Code Quality..."
                                    : "AI Agents are Building..."}
                        </h2>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            {isFailed
                                ? "An error occurred during build"
                                : isReviewing
                                  ? "Reviewer agent is checking for issues"
                                  : "Multi-agent pipeline: Planner → Coder → Reviewer → Fixer"}
                        </p>
                    </div>
                </div>

                {isFailed && project.error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700 font-medium">
                        Error: {project.error}
                    </div>
                )}

                {/* Progress bar */}
                {planned.length > 0 && !isFailed && (
                    <div className="mb-6">
                        <div className="flex justify-between text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                            <span>Progress</span>
                            <span>{Math.round((completed.length / planned.length) * 100)}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-zinc-700 transition-all duration-500 ease-out"
                                style={{ width: `${(completed.length / planned.length) * 100}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Agent Timeline — shows what each agent is doing in real-time */}
                {agentSteps.length > 0 && (
                    <div className="mb-6">
                        <span className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-widest mb-3">
                            Agent Activity
                        </span>
                        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                            {agentSteps.slice(-8).map((step, i) => {
                                const config = AGENT_CONFIG[step.agent] || AGENT_CONFIG.orchestrator;
                                const AgentIcon = config.icon;
                                const isRunning = step.status === 'running';
                                const isDone = step.status === 'done';

                                return (
                                    <div
                                        key={i}
                                        className={`flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg transition-all ${
                                            isRunning ? "bg-zinc-50/80 border border-zinc-200" : "border border-transparent"
                                        }`}
                                    >
                                        {isRunning ? (
                                            <Loader2Icon size={13} className={`animate-spin ${config.color} shrink-0`} />
                                        ) : isDone ? (
                                            <CheckCircle2Icon size={13} className={`${config.color} shrink-0`} />
                                        ) : (
                                            <AgentIcon size={13} className={`${config.color} shrink-0`} />
                                        )}
                                        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider w-16 shrink-0">
                                            {config.label}
                                        </span>
                                        <span className={`text-xs truncate ${isRunning ? "text-zinc-700 font-medium" : "text-zinc-500"}`}>
                                            {step.message}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Files checklist */}
                {planned.length > 0 ? (
                    <div>
                        <span className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-widest mb-3">
                            Planned Files ({completed.length}/{planned.length})
                        </span>
                        <div className="space-y-2.5 max-h-75 overflow-y-auto pr-1">
                            {planned.map((file) => {
                                const isCompleted = completed.includes(file.path);
                                const isGenerating = current === file.path;

                                return (
                                    <div
                                        key={file.path}
                                        className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all ${
                                            isGenerating
                                                ? "bg-zinc-50/50 border-zinc-300"
                                                : isCompleted
                                                  ? "bg-white border-zinc-100"
                                                  : "bg-white border-zinc-100 opacity-60"
                                        }`}
                                    >
                                        {isCompleted ? (
                                            <CheckCircle2Icon size={16} className="text-emerald-500 shrink-0" />
                                        ) : isGenerating ? (
                                            <Loader2Icon size={16} className="animate-spin text-zinc-900 shrink-0" />
                                        ) : (
                                            <CircleIcon size={16} className="text-zinc-300 shrink-0" />
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p
                                                className={`text-xs font-medium truncate ${isGenerating ? "text-zinc-800" : "text-zinc-700"}`}
                                            >
                                                {file.path}
                                            </p>
                                            <p className="text-[10px] text-zinc-400 truncate mt-0.5">{file.description}</p>
                                        </div>
                                        {isGenerating && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-semibold animate-pulse uppercase tracking-wider">
                                                Active
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    !isFailed && (
                        <div className="flex flex-col items-center justify-center py-6 text-zinc-400">
                            <Loader2Icon size={24} className="animate-spin mb-2" />
                            <p className="text-xs">Analyzing requirements and designing project structure...</p>
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
