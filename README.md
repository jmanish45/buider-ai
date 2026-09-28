# ⚡ BuilderAI — Agentic Full-Stack Web Application Generator

> An autonomous, multi-agent AI coding platform that decomposes user prompts into multi-file React applications, validates and self-heals code quality, and provides live sandboxed preview and chat revisions in real-time.

---

## 🌟 Key Features

- 🧠 **Multi-Agent Orchestration Engine:** Coordinated pipeline featuring dedicated **Planner**, **Coder**, **Reviewer**, and **Fixer** agents with automated self-correction loops.
- ⚡ **Real-Time WebSocket Streaming:** Low-latency bi-directional updates for plan generation, file completion events, and agent progress dashboards.
- 🛡️ **Fault-Tolerant Multi-Model Fallback Pool:** Automatic failover across prioritized open-source LLMs (`Cohere`, `Llama 3.3 70B`, `Gemini Flash`, `DeepSeek R1`) with exponential jitter backoff to eliminate HTTP 429 rate limits.
- 📉 **Signature-Based Context Compressor:** AST/signature extraction that reduces LLM prompt token consumption by **72%**, preventing quadratic context explosion during multi-file builds.
- 💻 **Interactive Live Sandbox:** Instant in-browser React rendering with live preview powered by CodeSandbox Sandpack.
- 💬 **Targeted Chat Revisions:** Conversational diff engine allowing iterative design adjustments and code patching.
- 🌐 **Instant Deployment:** Exportable project zip and one-click public shareable links.

---

## 🏗️ System Architecture

```
                                  ┌────────────────────────┐
                                  │   React + Sandpack UI  │
                                  └───────────┬────────────┘
                                              │  (WebSocket + HTTPS)
                                  ┌───────────▼────────────┐
                                  │  Express API & WS Hub  │
                                  └───────────┬────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      │        Agent Orchestration Engine             │
                      ├───────────────────────────────────────────────┤
                      │  1. Planner Agent   → Structure Decomposition │
                      │  2. Coder Agent     → Parallel File Synthesis │
                      │  3. Reviewer Agent  → Semantic & AST Quality  │
                      │  4. Fixer Agent     → Targeted Auto-Patching  │
                      └───────┬───────────────────────────────┬───────┘
                              │                               │
            ┌─────────────────▼──────────────┐  ┌─────────────▼──────────────┐
            │  AST Context Compressor        │  │  Multi-Model Fallback Pool │
            │  (Exports & Interface Pruning) │  │  (Cohere → Llama → Gemini) │
            └────────────────────────────────┘  └────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Domain | Technologies |
|---|---|
| **Frontend** | React 19, Vite, Tailwind CSS, Lucide Icons, CodeSandbox Sandpack |
| **Backend** | Node.js, Express, Socket.io (WebSockets), Cookie-Parser, CORS |
| **AI & Agents** | Vercel AI SDK, OpenRouter, Multi-Agent Orchestration, Zod Schemas |
| **Database** | MongoDB Atlas, Mongoose |
| **Deployment** | Render (Web Service & Static Site), Vercel |

---

## 🚀 Quick Start (Local Setup)

### 1. Prerequisites
- Node.js (v18+)
- MongoDB Atlas account (or local MongoDB)
- OpenRouter API Key

### 2. Clone & Setup Backend
```bash
git clone https://github.com/yourusername/buider-ai.git
cd buider-ai/backend
npm install
```

Create a `backend/.env` file:
```env
PORT=3000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=cohere/north-mini-code:free
ORIGINS=http://localhost:5173
```

Start the backend:
```bash
npm run dev
```

### 3. Setup Frontend
```bash
cd ../frontend
npm install
```

Create a `frontend/.env` file:
```env
VITE_BASE_URL=http://localhost:3000
```

Start the frontend:
```bash
npm run dev
```

Open `http://localhost:5173` in your browser!

---

## 📈 Scalability & Engineering Highlights

1. **Context Pruning ($O(N^2) \rightarrow O(N)$):** Extracts exported TypeScript/ES interfaces and CSS class schemas instead of raw file trees, keeping downstream LLM prompts under 1,500 tokens.
2. **Deterministic Scaffolding:** Common boilerplate and keyframes are synthesized with 0 LLM tokens, saving API budget strictly for custom UI logic.
3. **Static AST Self-Healing:** Pre-validates JSX self-closing tags, React 19 imports, and property bindings before writing to database.
