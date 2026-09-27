# IntelliFlow (DOIT) — Interview Answers: Section B (Technical Deep-Dive)

> [!TIP]
> These are the hardest questions. Each answer has: **what to say** (your script), **code-level specifics** (shows you wrote it), and **follow-up traps** (what the interviewer will ask next).

---

## T1. Explain the LangGraph ReAct agent architecture. How does the tool-calling loop work?

**Say this:**

"I use LangGraph's `create_react_agent` which implements the ReAct pattern — Reason + Act. Here's how the loop works:

1. **User sends a message** → the API handler in `ai_router.py` saves the message to MongoDB, then calls `AIOrchestrator.process_message()`.

2. **Context assembly** — The orchestrator loads the last 20 messages from MongoDB's `ai_messages` collection, converts them to LangChain message objects (`HumanMessage` / `AIMessage`), and prepends a dynamic `SystemMessage` with the user's ID and current UTC timestamp.

3. **Agent invocation** — `agent_executor.invoke()` is called with the assembled messages and a `thread_id` config (the conversation_id). LangGraph passes the messages + a system prompt (that defines the AI's role and 25+ available tools) to Gemini.

4. **The ReAct loop** — Gemini analyzes the request and decides:
   - **If it can answer directly** → it returns a text response, loop ends.
   - **If it needs data/action** → it returns a `tool_call` with the function name and arguments (e.g., `create_task_tool(title='Login Bug', project_name='Alpha', priority='High')`).
   
5. **Tool execution** — LangGraph automatically invokes the Python function, gets the result (e.g., `'✅ Task created — Ticket ID: ALPH-003'`), and feeds it back as a `ToolMessage`.

6. **Iteration** — Gemini sees the tool result and decides: does it need to call another tool, or can it synthesize a final response? This loop can iterate multiple times. For example, 'Create a bug and assign it to Rahul' would trigger `create_task_tool` first, then `assign_task_tool` — two tool calls in one conversation turn.

7. **Response extraction** — The final `AIMessage` is extracted from `response['messages'][-1]`. I handle the edge case where Gemini returns content as a list of dicts (multimodal content blocks) by iterating and extracting `text` fields. The final text is saved to MongoDB.

The key architectural decision was using `MemorySaver` as the checkpointer — it keeps in-session state in memory so LangGraph can track the tool call chain within a single invocation, but I also persist everything to MongoDB for long-term history."

---

## T2. You mentioned consolidating 6 agents into 1 orchestrator in v2. What were the 6 agents, and what problems did the old architecture have?

**Say this:**

"In v1, I had separate agent endpoints, each with its own LLM instance and limited tool set:

1. **Task Agent** — could only create/update tasks
2. **Sprint Agent** — could only manage sprints
3. **Project Agent** — could only manage projects and members
4. **Schedule Agent** — handled meetings and calendar
5. **Email Agent** — sent notifications
6. **GitHub Agent** — interacted with repos

**The problems were:**
- **Context fragmentation** — each agent had its own conversation history. If you told the Task Agent about your project structure, the Sprint Agent didn't know. Users had to repeat themselves.
- **Routing complexity** — the frontend had to decide which agent to call. 'Create a task and add it to the sprint' required two separate API calls to two different agents.
- **No multi-tool workflows** — you couldn't say 'Create a project, add 5 tasks, put them in a sprint, and email the team' in a single message because that crossed 4 agent boundaries.
- **Resource waste** — 6 separate LLM instances, 6 separate memory stores, 6 system prompts to maintain.

**The v2 solution:** One `AIOrchestrator` with one LLM instance, one system prompt, and all 25+ tools registered together. LangGraph's ReAct loop naturally handles multi-step workflows. The LLM decides the execution plan — it might call `create_project_tool`, then `create_task_tool` three times, then `create_sprint_tool`, then `add_task_to_sprint_tool`, then `send_email` — all in one conversation turn. The MCP server files you see in the codebase (`mcp_servers/`) are the remnants of the v1 architecture."

---

## T3. How does the RAG pipeline work? Walk me through document ingestion to query answering.

**Say this:**

"The RAG pipeline has two phases — ingestion and retrieval.

**Ingestion (`document_controller.py` → `rag_engine.py`):**
1. User uploads a file via `POST /api/documents/upload/{project_id}`. Allowed types: PDF, TXT, MD, DOCX, Python, JS, TS, JSON, CSV.
2. The file is saved to disk under `uploads/documents/` with a UUID filename for safety.
3. The appropriate LangChain document loader is selected based on extension — `PyMuPDFLoader` for PDFs, `TextLoader` for text/code files, `UnstructuredWordDocumentLoader` for Word docs.
4. The loaded text is split into chunks using `RecursiveCharacterTextSplitter` — **1000 characters per chunk with 200-character overlap**. The overlap ensures no information is lost at chunk boundaries.
5. Each chunk gets metadata: `project_id`, `document_id` (UUID), and `filename`.
6. Chunks are embedded using `GoogleGenerativeAIEmbeddings` with the `gemini-embedding-001` model and stored in **ChromaDB** (persistent client, stored at `./data/chromadb`).
7. Document metadata (filename, size, chunk count, uploader) is saved to MongoDB's `documents` collection for listing/management.

**Retrieval (`search_project_documents_tool` → `rag_engine.py`):**
1. When the AI receives a question about documents, it calls the `search_project_documents_tool`.
2. The tool resolves the project — it fuzzy-matches the project name the LLM provides against the user's accessible projects using a regex query.
3. `search_documents()` creates a LangChain `Chroma` wrapper, calls `similarity_search_with_relevance_scores()` with a **metadata filter** on `project_id` and `top_k=5`.
4. Results come back as `(document, score)` tuples. The tool formats them with filename, relevance score, and content excerpt.
5. This formatted text is returned to the LLM as the tool's output. The LLM then synthesizes a natural-language answer grounded in the actual document content — that's the 'G' in RAG (generation).

**Key design decision:** I filter by `project_id` at the ChromaDB level, not in Python. This means users can only search their own project's documents — **it's a security boundary built into the vector query itself**."

---

## T4. Explain the dual memory strategy — MemorySaver vs MongoDB. What happens when the server restarts mid-conversation?

**Say this:**

"I use two layers of memory:

**MemorySaver (short-term, in-process):** This is LangGraph's built-in checkpointer. It stores the full message graph state (including tool call chains) in Python dictionaries, keyed by `thread_id` (which I set to the conversation_id). It's essential during a single invocation because LangGraph needs to track the intermediate tool calls and their results within the ReAct loop. But it's **ephemeral** — it lives in the FastAPI process memory and dies on restart.

**MongoDB (long-term, persistent):** Every user message and AI response is explicitly saved to the `ai_messages` collection with `conversation_id`, `role`, `content`, and `created_at`. The `ai_conversations` collection tracks metadata — title, message count, last updated timestamp.

**What happens on server restart:**
1. MemorySaver is wiped clean — all in-memory graph states are gone.
2. When the user sends their next message in the same conversation, `process_message()` loads the **last 20 messages** from MongoDB using `get_recent_context(limit=20)`.
3. These are converted to `HumanMessage` / `AIMessage` objects and passed as the input to `agent_executor.invoke()`.
4. The LLM sees the full conversation context and can continue naturally. LangGraph's MemorySaver starts fresh but immediately gets this history as the initial state.

**The 20-message limit** is a deliberate trade-off — Gemini has a large context window, but I don't want to send 500 messages for a long-running conversation. 20 messages gives enough context for continuity without hitting token limits or adding latency.

**A subtle point:** Tool call intermediate steps (the tool's input/output) aren't replayed on restart — only the final user and assistant messages are. This means the LLM loses the memory of *which tools it called*, but retains the conversation content. In practice, this hasn't been an issue because the user messages and AI responses contain enough context."

---

## T5. What are MCP servers and why did you use the Model Context Protocol instead of just defining Python functions as tools?

**Say this:**

"I should be transparent here — the MCP servers in the codebase (`mcp_servers/` directory — 7 files: task, sprint, project, email, schedule, member, github) were part of the **v1 architecture** where I explored using the Model Context Protocol. MCP is an open standard from Anthropic that standardizes how AI models connect to external tools and data sources.

In v1, each MCP server (like `task_mcp_server.py`) used the `FastMCP` library to define tools as an independent server process. The idea was that the AI agent would connect to these MCP servers over stdio, and the MCP protocol would handle tool discovery, schema validation, and execution. The advantage of MCP is **decoupling** — the tool servers are independent processes that could be reused across different AI frameworks.

**Why I moved away from MCP to direct Python tools in v2:**
1. **Latency** — MCP adds inter-process communication overhead (stdio serialization). For a web app where users expect sub-second responses, every millisecond matters.
2. **Complexity** — Managing 7 subprocess servers plus the main FastAPI process was operational overhead. Debugging tool failures across process boundaries was painful.
3. **Sufficient with LangChain** — LangChain's `@tool` decorator already provides tool schema generation (for LLM function calling) and type validation. It gives me the same tool-calling interface without the protocol overhead.
4. **Single-process simplicity** — With all tools as Python functions in `agent_tools/`, they run in the same process, share the same database connection, and can be debugged with normal Python tools.

The MCP servers still exist in the codebase as functional code — they're not dead code per se, but they're not actively used in the v2 architecture. If I needed to expose tools to external AI systems (like Claude or a different LLM), MCP would be the right protocol for that interop."

---

## T6. How does the WebSocket-based team chat work? How do you handle connection lifecycle, disconnects, and broadcasting?

**Say this:**

"The team chat uses FastAPI's native WebSocket support with a custom `ConnectionManager` singleton.

**Data structures:**
- `active_connections: Dict[channel_id, Dict[user_id, WebSocket]]` — a nested dict mapping channels to connected users
- `user_channels: Dict[user_id, Set[channel_id]]` — reverse index for cleanup

**Connection lifecycle:**
1. **Connect** — Client opens a WebSocket to `/api/team-chat/ws/{channel_id}`. The `connect()` method calls `websocket.accept()`, adds the socket to both dictionaries. If it's the first connection for a channel, the channel dict is lazily initialized.
2. **Message loop** — The main loop reads messages with `websocket.receive_json()`. Each message triggers a save to MongoDB's `chat_messages` collection, then `broadcast_to_channel()` pushes it to all other connected users.
3. **Disconnect** — When the WebSocket closes (browser tab closed, network drop), `disconnect()` removes the user from both dicts. If the channel has zero connections, the channel entry is cleaned up to prevent memory leaks.
4. **Full user disconnect** — `disconnect_user()` iterates all channels the user is in and removes them from each, used when a user logs out.

**Broadcasting:**
- `broadcast_to_channel(message, channel_id, exclude_user)` iterates a **snapshot** of the connections dict (`list(self.active_connections[channel_id].items())`) — this prevents 'dict changed during iteration' errors.
- Each `send_json()` is wrapped in try/except. If a send fails (dead socket), the user is added to a `disconnected_users` list and cleaned up after the loop.
- There's also `broadcast_to_all_channels()` for system-wide notifications.

**Key design decision:** I store the WebSocket reference per user per channel, which means a user can only have one active connection per channel. If they open a second tab, it overwrites the first connection."

---

## T7. How does the Kanban board's drag-and-drop work and stay in sync across clients?

**Say this:**

"The Kanban board uses `@dnd-kit/core` and `@dnd-kit/sortable` for drag-and-drop on the frontend. When a user drags a task from one column to another:

1. **Frontend** — The `onDragEnd` handler fires, updates the local React state immediately (optimistic update) for instant visual feedback.
2. **API call** — It sends `PUT /api/tasks/{task_id}` with `{status: 'In Progress'}` to the backend.
3. **Backend** — The task controller updates the task's `status` field in MongoDB and appends an `activity` entry: `{action: 'status_change', old_value: 'To Do', new_value: 'In Progress', user_name: 'Super Admin', timestamp: '...'}`.
4. **WebSocket broadcast** — After the update, if WebSocket connections exist for that project, a real-time event is broadcast so other connected clients see the change without refreshing.

For cross-client sync in real-time: the WebSocket `ConnectionManager` pushes task update events to all users in the project's team chat channel. The frontend listens for these events and re-fetches or updates the Kanban state accordingly.

If the API call fails, the frontend should roll back the optimistic update — though this is an area where I'd add more robust error handling in a production revision (showing a toast notification and reverting the card position)."

---

## T8. Explain the role-based access control (RBAC). How do you enforce permissions at the API level?

**Say this:**

"RBAC operates at three levels:

**1. Global roles (user.role):**
- `super-admin` — can see system dashboard, manage all users, access all projects
- `admin` — can manage users within their scope
- `member` — standard user, can only access assigned projects

These are enforced via FastAPI dependencies. I have three dependency functions in `dependencies.py`:
- `get_current_user` — base auth, returns user_id. Every protected route uses this.
- `require_admin` — chains on `get_current_user`, then checks `user.role in ['admin', 'super-admin']`. Returns 403 if not.
- `require_super_admin` — same pattern, checks `user.role == 'super-admin'`.

Routes declare their required permission level:
```python
@router.get('/system', user_id=Depends(require_super_admin))
```

**2. Project-level membership:**
The `Project.is_member(project_id, user_id)` check runs in controllers for any project-scoped action. It checks if the user is either the project `owner` (via `user_id` field) or listed in the `members` array. Non-members get a 403.

**3. Task-level ownership:**
For destructive operations (delete, reassign), the controller checks if the user is the task creator, the project owner, or a super-admin.

**How it chains together:** A request to update a task goes through: `get_current_user` (JWT + device checks) → controller checks `Project.is_member()` → controller checks task ownership → proceeds with update. Three layers of authorization."

---

## T9. How does the Celery + Redis setup work for background code reviews? Why not just do it synchronously?

**Say this:**

"The code review feature analyzes GitHub PRs — it's computationally expensive and involves multiple external API calls, so it must be async.

**Architecture:**
- **Celery app** (`celery_app.py`) — configured with Redis as both broker and result backend. Named `intelliflow_worker` with the task module `tasks.code_review_tasks`.
- **Queue routing** — The `analyze_pr_code_review` task is routed to a dedicated `code_review` queue with routing key `code_review.analyze`. This isolates code review work from any other future background tasks.
- **Worker config** — `task_time_limit=600` (10 min hard kill), `task_soft_time_limit=540` (9 min soft kill), `worker_max_tasks_per_child=50` (restart after 50 tasks to prevent memory leaks), `worker_prefetch_multiplier=1` (process one task at a time — important because each task is CPU/network heavy).

**The task flow (`analyze_pr_code_review`):**
1. Status set to `in_progress` in MongoDB's `code_reviews` collection.
2. **Fetch PR files** from GitHub API — gets the diff/patch for each changed file.
3. **Security scan** — `SecurityScanner` runs pattern-matching against the diffs looking for hardcoded secrets, SQL injection, XSS, etc. Returns severity-classified findings.
4. **Code quality analysis** — `CodeQualityAnalyzer` checks complexity, documentation coverage, maintainability.
5. **AI review** — `AICodeReviewer` sends the PR diff + security findings + quality metrics to Gemini for an intelligent code review (like a senior dev reviewing the PR).
6. **Score calculation** — quality score (weighted: 30% complexity, 30% documentation, 40% maintainability) and security score (starts at 10.0, deducts 2.0/critical, 1.0/high, 0.5/medium).
7. Results saved back to MongoDB.

**Why not synchronous?** The whole pipeline takes 30-60 seconds (GitHub API + 3 analysis passes + LLM call). FastAPI has a default request timeout, and users shouldn't stare at a spinner. With Celery, the API returns immediately with `{review_id, status: 'pending'}`, and the frontend polls for completion or uses the `celery_task_id` to check status."

---

## T10. How do you handle the AI returning structured vs. unstructured content from Google Gemini?

**Say this:**

"This is a real-world edge case I had to handle. The `langchain_google_genai` library wraps Gemini's API, and Gemini sometimes returns content in different formats:

1. **Simple string** — most common case. `ai_msg.content` is just a string like `'Here are your tasks...'`
2. **List of content blocks** — Gemini's multimodal API can return a list of dictionaries, each with a `type` and `text` field: `[{'type': 'text', 'text': 'Here are...'}]`
3. **Mixed list** — sometimes it's a mix of dicts and raw strings.

I handle this in `ai_orchestrator.py` lines 142-149:

```python
if isinstance(ai_content, list):
    text_content = ''
    for block in ai_content:
        if isinstance(block, dict) and 'text' in block:
            text_content += block['text']
        elif isinstance(block, str):
            text_content += block
    ai_content = text_content if text_content else str(ai_content)
```

The logic: check if content is a list. If so, iterate each block — extract `text` from dicts, concatenate raw strings, and fall back to `str()` if nothing matched. This guarantees that what gets saved to MongoDB and returned to the frontend is always a clean string.

Without this handling, the frontend would receive `[object Object]` or a JSON array instead of readable text. It's one of those things that only surfaces in production when the LLM decides to use a different response format."

---

## T11. Walk me through how 'Create a bug for login page, assign to Rahul, high priority' gets executed end-to-end.

**Say this:**

"Here's the exact execution path:

1. **Frontend** → User types the message in the AI Assistant page. React sends `POST /api/ai/conversations/{conv_id}/messages` with `{message: 'Create a bug for login page, assign to Rahul, high priority'}`.

2. **Router** (`ai_router.py`) → Validates JWT (via `get_current_user_obj` dependency). Sets the tool context with `set_tool_context(user_id, user_email, user_role)` — this is a global state that the tools can access. Calls `AIOrchestrator.process_message()`.

3. **Orchestrator** → Saves user message to MongoDB. Loads last 20 messages for context. Injects `SystemMessage` with user_id and current time. Invokes `agent_executor.invoke()`.

4. **LangGraph ReAct — Iteration 1** → Gemini sees the system prompt listing all 25+ tools. It reasons: 'I need to create a task of type bug. I need to find the project. I need to find Rahul's email to assign.' It decides to call `create_task_tool`.

5. **Tool execution** (`task_tools.py`) → `create_task_tool(title='Login Page Bug', project_name='...', issue_type='bug', priority='High', assignee_email='rahulsingh@gmail.com')`. Inside:
   - `get_tool_context()` retrieves the user_id set earlier.
   - `resolve_project_id(user_id, project_name)` fuzzy-matches the project name against the user's projects in MongoDB.
   - `agent_create_task_sync()` is called — creates the task in MongoDB with auto-generated ticket ID (e.g., `INTFL-005`), resolves the assignee by email, and triggers `AutomationEngine.trigger_task_assigned()` which sends an email notification to Rahul.
   - Returns `'✅ Task Login Page Bug created! Assigned to rahulsingh@gmail.com. Ticket ID: INTFL-005'`.

6. **LangGraph ReAct — Iteration 2** → Gemini receives the tool result as a `ToolMessage`. It has all the info it needs now. It generates the final human-readable response.

7. **Orchestrator** → Extracts the AI response, handles the list/dict content edge case, saves to MongoDB, returns `{success: true, content: '...', conversation_id: '...'}`.

8. **Frontend** → Renders the AI response in the chat bubble with markdown formatting."

---

## T12. What's your approach to rate limiting? How does SlowAPI work with FastAPI?

**Say this:**

"I use SlowAPI, which is the FastAPI-compatible version of Flask-Limiter. Here's the setup:

**Configuration** (`core/rate_limiter.py`):
- **Key function**: extracts client IP from `X-Forwarded-For` header (for reverse proxy support), falls back to `get_remote_address`.
- **Default limit**: `100/minute` globally.
- **Strategy**: `fixed-window` — counters reset at minute boundaries.
- **Storage**: `memory://` (in-memory dict) for development. In production I'd swap this to a Redis URI for consistency across multiple worker processes.

**Usage in routers**: I apply rate limits as decorators on specific endpoints:
- AI chat: `@limiter.limit('20/minute')` — prevents LLM abuse
- Login: `@limiter.limit('10/minute')` — brute force protection
- Code review: Celery-level rate limit `task_default_rate_limit='10/m'`

**Error handling**: When a limit is exceeded, SlowAPI raises `RateLimitExceeded`. My custom handler returns a structured JSON 429 response with `error_code: 'RATE_LIMIT_EXCEEDED'`, `retry_after`, and the request_id for debugging.

**Integration**: The limiter instance is attached to `app.state.limiter` in `main.py`, and the exception handler is registered with `app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)`.

The reason I don't rate-limit every endpoint is that most CRUD operations are lightweight — the expensive ones are LLM calls and external API integrations, and those are the ones I protect."

---

## T13. How does the Discord/Slack/Teams integration work? How do you auto-provision channels?

**Say this:**

"Integrations work at two levels — user-level (profile webhooks) and project-level (team integrations).

**User-level**: Each user's profile has webhook URLs for Discord, Slack, and Teams in the `integrations` field. When an event happens (task assigned, deadline approaching), the automation engine can send notifications to these personal webhooks.

**Project-level** (`team_integrations` collection): When you configure an integration for a project (e.g., connect Slack), the credentials (bot token, channel ID, webhook URL) are stored in the `team_integrations` collection with `project_id` and `platform` fields. 

**Slack auto-provisioning**: When a member is added to a project via `POST /api/projects/{id}/members`, the system attempts to auto-invite them to the project's Slack channel using the bot token. If `SLACK_DEFAULT_WORKSPACE_TOKEN` is configured, it calls the Slack API to send an invite. The response includes `slack_invite: {attempted: true, success: true/false}`.

**Event-driven notifications**: The `task_controller.py` has a `_notify_task_event_to_slack()` helper that fires on task lifecycle events (created, assigned, status changed). It fetches the project's Slack integration credentials via `TeamIntegration.find_by_project_and_platform(project_id, 'slack')` and posts a formatted message to the configured channel using the bot token.

**Discord/Teams** follow the same pattern using webhook URLs — `send_discord_notification()` and `send_teams_notification()` in `notification_utils.py` make HTTP POST requests to the respective webhook endpoints."

---

## T14. What's the AutomationEngine? How does event-driven automation work when a sprint is created?

**Say this:**

"The `AutomationEngine` is a static class that acts as an event handler — controllers call its trigger methods when specific events occur.

**Sprint creation flow:**
1. Sprint controller creates the sprint in MongoDB.
2. It calls `AutomationEngine.trigger_sprint_created(sprint_data)`.
3. The engine looks up the project via `sprint_data['project_id']`.
4. It gathers all team member emails by iterating the project's `members` array and looking up each user.
5. **Action 1: Email notification** — sends an HTML email to every team member with the sprint name, goal, start date, and end date.
6. **Action 2: Calendar event** — calls `create_calendar_event()` to schedule a Sprint Review meeting at the sprint's end date, with all team members as attendees.

**Other triggers:**
- `trigger_task_assigned(task_data, assignee_id)` — sends an email to the assignee with the ticket ID, title, priority, and a link to the task.
- `trigger_deadline_approaching(task_data)` — sends a warning email when a task's due date is approaching. This is triggered by a **Celery beat task** (`check_upcoming_deadlines`) that runs daily, queries MongoDB for tasks due tomorrow, and fires this trigger.

**Design philosophy:** The controllers are the event sources, the AutomationEngine is the event handler, and the notification utilities are the side-effect executors. This separation means I can add new automations (e.g., 'send a Teams message when a sprint is completed') without touching controller logic — I just add a new method to the engine."

---

## T15. How would you scale this system to handle 10,000 concurrent users? What are the bottlenecks?

**Say this:**

"The current architecture has several bottlenecks at that scale. Here's my scaling plan:

**Bottleneck 1: Single FastAPI process**
- **Fix**: Deploy multiple FastAPI workers behind a load balancer (Nginx/Traefik). Uvicorn supports `--workers N` for multi-process. Kubernetes horizontal pod autoscaler for dynamic scaling.

**Bottleneck 2: WebSocket ConnectionManager is in-memory**
- **Fix**: The current `ConnectionManager` stores connections in a Python dict — it only works for single-process. At scale, I'd use **Redis Pub/Sub** as a WebSocket message broker. Each FastAPI instance subscribes to Redis channels. When a message is broadcast, Redis fans it out to all instances, and each instance pushes to its local WebSocket connections.

**Bottleneck 3: PyMongo is synchronous (blocks event loop)**
- **Fix**: Migrate to **Motor** (async MongoDB driver). This is the biggest code change — all `db.collection.find()` calls become `await db.collection.find()`. But it eliminates the blocking I/O problem.

**Bottleneck 4: LLM API calls (Gemini)**
- **Fix**: Already somewhat handled — AI endpoints are rate-limited to 20/min per user. At scale, I'd add a request queue with priority lanes (paid users get faster responses). Also, caching common queries (e.g., 'What are my overdue tasks?') with a short TTL.

**Bottleneck 5: Rate limiter uses in-memory storage**
- **Fix**: Switch `storage_uri` from `memory://` to `redis://` so rate limit counters are shared across all FastAPI instances.

**Bottleneck 6: MongoDB**
- **Fix**: Ensure proper indexes on hot query patterns (`project_id + status` on tasks, `user_id` on sessions, `conversation_id` on ai_messages). MongoDB Atlas auto-scales reads with replica sets. For write-heavy scenarios, consider sharding by project_id.

**Bottleneck 7: ChromaDB (single-node vector store)**
- **Fix**: At scale, migrate to a managed vector database like Pinecone or Weaviate that supports distributed indexing and horizontal scaling."

---

## T16. What happens if the AI tool call fails mid-execution — say it creates a task but fails to assign it?

**Say this:**

"This is a partial failure scenario, and honestly, the current system handles it **gracefully but not transactionally**.

**What actually happens:**
1. If `create_task_tool` succeeds but a subsequent `assign_task_tool` call fails, the task exists in MongoDB but is unassigned.
2. LangGraph handles this in the ReAct loop — when a tool returns an error (my tools return strings like `'❌ Failed to assign: User not found'`), the LLM sees this as the `ToolMessage` output.
3. The LLM then generates a response like: 'I created the task INTFL-005 successfully, but I wasn't able to assign it to Rahul because that user wasn't found. Would you like to try a different assignee?'
4. The user can then follow up with the correction.

**Why not use database transactions?**
MongoDB supports multi-document transactions, but I deliberately don't use them for AI tool calls because:
- Each tool call is an independent operation — the LLM might call 5 tools, and tools 1-3 succeeding but tool 4 failing shouldn't roll back the first 3.
- The LLM acts as the 'transaction coordinator' — it sees tool results and can take compensating actions.

**What I'd improve for production:**
- Add a `tool_execution_log` collection that records every tool call, its input, output, and success/failure status — essentially an audit trail.
- Implement idempotency keys so that if the LLM retries a tool call, it doesn't create duplicate tasks.
- For critical multi-step workflows (like 'create project + add members + create tasks'), wrap them in a single 'composite tool' that handles rollback internally."

---

## T17. You're using PyMongo (synchronous) with FastAPI (async). Doesn't that block the event loop?

**Say this:**

"Yes, this is a known trade-off, and I want to be honest about it.

**The problem:** PyMongo is synchronous — every `db.collection.find()` call blocks the thread. FastAPI runs on uvicorn's asyncio event loop. When a synchronous PyMongo call runs inside an `async def` route handler, it blocks that event loop thread, preventing other requests from being processed during the database call.

**Why I still used PyMongo:**
1. **Development speed** — PyMongo has a simpler API than Motor (the async alternative). For a solo project where I'm iterating fast, the synchronous API meant less boilerplate and fewer `await` chains.
2. **FastAPI's thread pool mitigation** — When you use `def` (not `async def`) for route handlers, FastAPI runs them in a thread pool automatically. Many of my controllers are synchronous functions called from `async def` route handlers that call them synchronously. Uvicorn's default thread pool handles the concurrency.
3. **In practice** — MongoDB queries to Atlas are fast (single-digit milliseconds for indexed queries). The blocking time is negligible for the current user load. The real latency is in LLM API calls, which I handle properly (the LangChain/LangGraph invoke is blocking, but it's the nature of the call — it has to wait for Gemini anyway).

**What I'd do for production scale:**
- Migrate to **Motor** (`motor.motor_asyncio.AsyncIOMotorClient`) — drop-in replacement for PyMongo's API but fully async.
- Alternatively, use `asyncio.to_thread()` to run PyMongo calls in a thread pool explicitly: `result = await asyncio.to_thread(db.tasks.find, query)`.
- The migration is mechanical — change import, add `await` before every DB call — but it touches every controller and model, so it's a significant refactor."

---

## T18. How does the device fingerprinting and tab-session-key auth work? Why do you skip it for AI endpoints?

**Say this:**

"This is a multi-layer security system I built to prevent token theft and cross-device replay attacks.

**Device fingerprinting:**
- On login, the server generates a `device_fingerprint` by hashing `SHA-256(IP_address + User-Agent)` truncated to 32 chars.
- This fingerprint is embedded in the JWT payload (`device_fp` claim) and also stored in the `sessions` collection.
- On every API request, `verify_token()` recomputes the fingerprint from the current request's IP and User-Agent, then compares it to the one in the session. If they don't match → possible token theft → the token is blacklisted and the request is rejected with 401.

**Tab session key:**
- On login, a UUID v4 `tab_session_key` is generated and returned to the frontend.
- The frontend stores it in `sessionStorage` (not localStorage) — this means it's unique per browser tab.
- Every request includes it as `X-Tab-Session-Key` header. The server validates it against the session record.
- This prevents the scenario where someone copies the JWT to a different tab or tool — they won't have the matching tab key.

**Why skip for AI endpoints?**
I define a list `_SKIP_DEVICE_CHECK_PREFIXES` in `dependencies.py` that includes `/api/ai/`, `/api/meetings/`, `/api/data-viz/`, etc. When a request matches these prefixes, `verify_token()` is called with `ip_address=None, user_agent=None, skip_device_check=True, skip_tab_validation=True`.

**The reason:** Behind development proxies like ngrok, or when the frontend uses different fetch implementations (Axios vs fetch vs WebSocket), the User-Agent string can legitimately differ from the login request. This caused false positives — users would get 401s on AI chat because Axios sends a slightly different User-Agent than the browser's login form submission. Rather than weaken the security for all endpoints, I selectively bypass fingerprint checks on endpoints where the User-Agent is unreliable, while still enforcing checks 1-3 (blacklist, token version, active session).

**The key insight:** Security isn't all-or-nothing. The AI endpoints still validate the JWT signature, expiration, blacklist, and session existence — they just skip the device matching. For sensitive operations (task creation, project settings, user management), the full 5-check pipeline runs."

---

> [!IMPORTANT]
> **Key interview meta-strategies for technical questions:**
> - **Admit trade-offs honestly** — T17 (PyMongo blocking) and T16 (no transactions) are questions designed to see if you'll BS or show engineering maturity.
> - **Distinguish "what I built" vs. "what I'd do at scale"** — T15 is the perfect place to show you understand production architecture even if the current system is a demo.
> - **Use specific line numbers and function names** — saying "line 142 of ai_orchestrator.py" is 10x more credible than "somewhere in the code."
> - **Show the reasoning chain** — for every design decision, explain the alternative you rejected and why. "I chose MemorySaver over Redis-backed persistence because..."
