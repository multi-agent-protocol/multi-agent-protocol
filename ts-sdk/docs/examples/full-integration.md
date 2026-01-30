# Example: Full Integration

A complete end-to-end application demonstrating all major MAP SDK features.

## Overview

This example builds a **document processing system** with:
- **Server**: MAP server with custom handlers and middleware
- **Coordinator Agent**: Manages workflow and task distribution
- **Worker Agents**: Process documents (OCR, summarization, classification)
- **API Gateway**: REST API for external clients
- **Dashboard Client**: Real-time monitoring UI

## System Architecture

```
                    ┌─────────────────────────────────────────────────────┐
                    │                   MAP Server                         │
                    │  ┌──────────────────────────────────────────────┐   │
                    │  │     Custom: document/* handlers              │   │
                    │  │     Middleware: auth, logging, metrics       │   │
                    │  └──────────────────────────────────────────────┘   │
                    │                                                      │
                    │  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
                    │  │ jobs    │  │ workers │  │completed│  (scopes)  │
                    │  └─────────┘  └─────────┘  └─────────┘            │
                    └─────────────────────────────────────────────────────┘
                           │              │              │
        ┌──────────────────┼──────────────┼──────────────┼────────────────┐
        │                  │              │              │                │
   ┌────┴────┐      ┌──────┴──────┐  ┌────┴────┐  ┌─────┴─────┐   ┌─────┴─────┐
   │   API   │      │ Coordinator │  │ Worker  │  │  Worker   │   │ Dashboard │
   │ Gateway │      │    Agent    │  │  (OCR)  │  │(Summarize)│   │  Client   │
   └─────────┘      └─────────────┘  └─────────┘  └───────────┘   └───────────┘
        │
   [REST API]
        │
   External Apps
```

## Project Structure

```
doc-processor/
├── server/
│   ├── index.ts          # Server entry point
│   ├── handlers.ts       # Custom document handlers
│   └── middleware.ts     # Auth, logging, metrics
├── agents/
│   ├── coordinator.ts    # Workflow coordinator
│   └── workers/
│       ├── ocr.ts        # OCR worker
│       ├── summarizer.ts # Summarization worker
│       └── classifier.ts # Classification worker
├── gateway/
│   └── api.ts            # REST API gateway
├── dashboard/
│   └── client.ts         # Monitoring client
└── shared/
    ├── types.ts          # Shared type definitions
    └── stream.ts         # WebSocket stream helper
```

## Shared Types

```typescript
// shared/types.ts
export interface Document {
  id: string;
  filename: string;
  content: string | Buffer;
  mimeType: string;
  metadata: Record<string, unknown>;
}

export interface Job {
  id: string;
  documentId: string;
  type: "ocr" | "summarize" | "classify";
  status: "pending" | "processing" | "completed" | "failed";
  result?: unknown;
  error?: string;
  assignedTo?: string;
  createdAt: number;
  completedAt?: number;
}

export interface WorkerCapability {
  type: "ocr" | "summarize" | "classify";
  maxConcurrent: number;
}
```

## Server

```typescript
// server/index.ts
import { MAPServer, type HandlerRegistry, type Middleware } from "@multi-agent-protocol/sdk/server";
import { WebSocketServer } from "ws";
import { createDocumentHandlers } from "./handlers";
import { authMiddleware, loggingMiddleware, metricsMiddleware } from "./middleware";

// In-memory document and job storage (use database in production)
const documents = new Map<string, Document>();
const jobs = new Map<string, Job>();

// Create server
const server = new MAPServer({
  name: "DocProcessor",
  version: "1.0.0",

  // Custom handlers for document operations
  additionalHandlers: createDocumentHandlers({ documents, jobs }),

  // Middleware chain
  middleware: [
    loggingMiddleware,
    metricsMiddleware,
    authMiddleware,
  ],
});

// Create workflow scopes
const jobsScope = server.scopes.create({ name: "jobs" });
const workersScope = server.scopes.create({ name: "workers" });
const completedScope = server.scopes.create({ name: "completed" });

console.log("Created scopes:", jobsScope.id, workersScope.id, completedScope.id);

// Track metrics
const metrics = {
  documentsProcessed: 0,
  jobsCompleted: 0,
  jobsFailed: 0,
  avgProcessingTimeMs: 0,
};

server.on("message.sent", (event) => {
  const msg = event.data.message;
  if (msg.payload.type === "job-completed") {
    metrics.jobsCompleted++;
    metrics.documentsProcessed++;
  } else if (msg.payload.type === "job-failed") {
    metrics.jobsFailed++;
  }
});

// WebSocket server
const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "/", "http://localhost");
  const token = url.searchParams.get("token");

  const stream = websocketToStream(ws);
  const router = server.accept(stream);

  // Store auth token in session metadata
  router.start();
});

console.log("Document Processing Server running on ws://localhost:8080");

// Export for API gateway
export { server, documents, jobs, metrics };
```

```typescript
// server/handlers.ts
import type { HandlerRegistry } from "@multi-agent-protocol/sdk/server";
import type { Document, Job } from "../shared/types";
import { randomUUID } from "crypto";

export function createDocumentHandlers(opts: {
  documents: Map<string, Document>;
  jobs: Map<string, Job>;
}): HandlerRegistry {
  const { documents, jobs } = opts;

  return {
    // Upload a document
    "document/upload": async (params: {
      filename: string;
      content: string;
      mimeType: string;
    }, ctx) => {
      const doc: Document = {
        id: randomUUID(),
        filename: params.filename,
        content: params.content,
        mimeType: params.mimeType,
        metadata: { uploadedBy: ctx.session.id },
      };

      documents.set(doc.id, doc);

      return { document: { id: doc.id, filename: doc.filename } };
    },

    // Create a processing job
    "document/process": async (params: {
      documentId: string;
      type: "ocr" | "summarize" | "classify";
    }, ctx) => {
      const doc = documents.get(params.documentId);
      if (!doc) {
        throw new Error(`Document not found: ${params.documentId}`);
      }

      const job: Job = {
        id: randomUUID(),
        documentId: params.documentId,
        type: params.type,
        status: "pending",
        createdAt: Date.now(),
      };

      jobs.set(job.id, job);

      return { job: { id: job.id, status: job.status } };
    },

    // Get job status
    "document/status": async (params: { jobId: string }) => {
      const job = jobs.get(params.jobId);
      if (!job) {
        throw new Error(`Job not found: ${params.jobId}`);
      }

      return { job };
    },

    // List jobs
    "document/jobs": async (params: { status?: string }) => {
      const allJobs = Array.from(jobs.values());
      const filtered = params.status
        ? allJobs.filter((j) => j.status === params.status)
        : allJobs;

      return { jobs: filtered };
    },
  };
}
```

```typescript
// server/middleware.ts
import type { Middleware } from "@multi-agent-protocol/sdk/server";

export const loggingMiddleware: Middleware = async (method, params, ctx, next) => {
  const start = Date.now();
  console.log(`[${ctx.requestId}] → ${method}`);

  try {
    const result = await next();
    console.log(`[${ctx.requestId}] ← ${method} (${Date.now() - start}ms)`);
    return result;
  } catch (error) {
    console.error(`[${ctx.requestId}] ✗ ${method}:`, error);
    throw error;
  }
};

export const metricsMiddleware: Middleware = async (method, params, ctx, next) => {
  // Track request count by method (implement with your metrics system)
  // metrics.increment(`map.requests.${method}`);

  const start = Date.now();
  const result = await next();

  // Track latency
  // metrics.timing(`map.latency.${method}`, Date.now() - start);

  return result;
};

export const authMiddleware: Middleware = async (method, params, ctx, next) => {
  // Skip auth for connect
  if (method === "map/connect") {
    return next();
  }

  // Check document/* methods require authentication
  if (method.startsWith("document/")) {
    // In production, validate token from session metadata
    // const token = ctx.session.metadata?.authToken;
    // if (!validateToken(token)) throw new Error("Unauthorized");
  }

  return next();
};
```

## Coordinator Agent

```typescript
// agents/coordinator.ts
import { AgentConnection } from "@multi-agent-protocol/sdk";
import type { Job } from "../shared/types";
import { connectToServer } from "../shared/stream";

async function main() {
  const { stream, agent } = await connectToServer("Coordinator", "coordinator");

  const { agent: registered } = await agent.connect();
  console.log("Coordinator started");

  // Find scopes
  const { scopes } = await agent.listScopes();
  const jobsScope = scopes.find((s) => s.name === "jobs")!;
  const workersScope = scopes.find((s) => s.name === "workers")!;

  // Join both scopes
  await agent.joinScope(jobsScope.id);
  await agent.joinScope(workersScope.id);

  // Track available workers by capability
  const workers = new Map<string, {
    agentId: string;
    capabilities: string[];
    available: boolean;
  }>();

  // Track pending jobs
  const pendingJobs = new Map<string, Job>();

  // Subscribe to worker events
  const subscription = await agent.subscribe({
    eventTypes: ["agent.registered", "agent.unregistered", "agent.updated"],
  });

  // Process events in background
  (async () => {
    for await (const event of subscription) {
      if (event.type === "agent.registered") {
        const a = event.data.agent;
        if (a.role === "worker") {
          workers.set(a.id, {
            agentId: a.id,
            capabilities: a.metadata?.capabilities || [],
            available: true,
          });
          console.log(`Worker registered: ${a.name} (${a.metadata?.capabilities})`);
          assignPendingJobs();
        }
      } else if (event.type === "agent.unregistered") {
        workers.delete(event.data.agentId);
        console.log(`Worker left: ${event.data.agentId}`);
      } else if (event.type === "agent.updated") {
        const a = event.data.agent;
        const worker = workers.get(a.id);
        if (worker) {
          worker.available = a.state === "running";
          if (worker.available) {
            assignPendingJobs();
          }
        }
      }
    }
  })();

  // Handle job messages
  agent.onMessage(async (message) => {
    if (message.payload.type === "new-job") {
      const job = message.payload.job as Job;
      console.log(`New job: ${job.id} (${job.type})`);

      // Try to assign immediately
      const worker = findAvailableWorker(job.type);
      if (worker) {
        await assignJob(job, worker.agentId);
      } else {
        pendingJobs.set(job.id, job);
        console.log(`Queued job ${job.id} - no available workers`);
      }
    } else if (message.payload.type === "job-completed") {
      console.log(`Job completed: ${message.payload.jobId}`);
      assignPendingJobs();
    } else if (message.payload.type === "job-failed") {
      console.log(`Job failed: ${message.payload.jobId} - ${message.payload.error}`);
      // Could implement retry logic here
      assignPendingJobs();
    }
  });

  function findAvailableWorker(jobType: string) {
    for (const worker of workers.values()) {
      if (worker.available && worker.capabilities.includes(jobType)) {
        return worker;
      }
    }
    return null;
  }

  async function assignJob(job: Job, workerId: string) {
    const worker = workers.get(workerId);
    if (worker) {
      worker.available = false;
    }

    await agent.send({
      to: { agentId: workerId },
      payload: { type: "assign-job", job },
    });

    console.log(`Assigned job ${job.id} to ${workerId}`);
  }

  async function assignPendingJobs() {
    for (const [jobId, job] of pendingJobs) {
      const worker = findAvailableWorker(job.type);
      if (worker) {
        pendingJobs.delete(jobId);
        await assignJob(job, worker.agentId);
      }
    }
  }

  console.log("Coordinator ready");
}

main().catch(console.error);
```

## Worker Agent

```typescript
// agents/workers/summarizer.ts
import { AgentConnection } from "@multi-agent-protocol/sdk";
import type { Job } from "../../shared/types";
import { connectToServer } from "../../shared/stream";

async function main() {
  const workerId = process.argv[2] || `summarizer-${Date.now()}`;

  const { stream, agent } = await connectToServer(workerId, "worker");

  await agent.connect();

  // Update with capabilities
  await agent.update({
    metadata: { capabilities: ["summarize"] },
  });

  console.log(`Summarizer worker ${workerId} started`);

  // Join workers scope
  const { scopes } = await agent.listScopes();
  const workersScope = scopes.find((s) => s.name === "workers")!;
  await agent.joinScope(workersScope.id);

  // Handle job assignments
  agent.onMessage(async (message) => {
    if (message.payload.type !== "assign-job") return;

    const job = message.payload.job as Job;
    console.log(`Processing job: ${job.id}`);

    await agent.update({ state: "busy" });

    try {
      // Simulate summarization
      const result = await summarize(job.documentId);

      // Report success
      await agent.send({
        to: { agentId: message.from },
        payload: {
          type: "job-completed",
          jobId: job.id,
          result,
        },
      });

      console.log(`Completed job: ${job.id}`);
    } catch (error: any) {
      // Report failure
      await agent.send({
        to: { agentId: message.from },
        payload: {
          type: "job-failed",
          jobId: job.id,
          error: error.message,
        },
      });

      console.error(`Failed job: ${job.id}`, error);
    } finally {
      await agent.update({ state: "running" });
    }
  });

  console.log("Ready for jobs");
}

async function summarize(documentId: string): Promise<{ summary: string }> {
  // Simulate processing
  await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));

  return {
    summary: `Summary of document ${documentId}: This is an automatically generated summary.`,
  };
}

main().catch(console.error);
```

## REST API Gateway

```typescript
// gateway/api.ts
import express from "express";
import { ClientConnection } from "@multi-agent-protocol/sdk";
import { connectToServer } from "../shared/stream";

const app = express();
app.use(express.json());

let client: ClientConnection;

// Initialize MAP client
async function init() {
  const { stream } = await connectToServer("API-Gateway", "client");
  client = new ClientConnection(stream, { name: "API-Gateway" });
  await client.connect();
  console.log("API Gateway connected to MAP server");
}

// Upload document
app.post("/api/documents", async (req, res) => {
  try {
    const result = await client.request("document/upload", {
      filename: req.body.filename,
      content: req.body.content,
      mimeType: req.body.mimeType,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create processing job
app.post("/api/documents/:id/process", async (req, res) => {
  try {
    const result = await client.request("document/process", {
      documentId: req.params.id,
      type: req.body.type,
    });

    // Notify coordinator about new job
    const { scopes } = await client.listScopes();
    const jobsScope = scopes.find((s) => s.name === "jobs")!;

    await client.send({
      to: { scopeId: jobsScope.id },
      payload: { type: "new-job", job: result.job },
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get job status
app.get("/api/jobs/:id", async (req, res) => {
  try {
    const result = await client.request("document/status", {
      jobId: req.params.id,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List agents
app.get("/api/agents", async (req, res) => {
  try {
    const { agents } = await client.listAgents();
    res.json({ agents });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", connected: client?.state === "connected" });
});

// Start server
init().then(() => {
  app.listen(3000, () => {
    console.log("REST API running on http://localhost:3000");
  });
});
```

## Dashboard Client

```typescript
// dashboard/client.ts
import { ClientConnection } from "@multi-agent-protocol/sdk";
import { connectToServer } from "../shared/stream";

async function main() {
  const { stream } = await connectToServer("Dashboard", "client");
  const client = new ClientConnection(stream, { name: "Dashboard" });
  await client.connect();

  console.log("Document Processing Dashboard");
  console.log("=============================\n");

  // Initial state
  await showStatus(client);

  // Subscribe to all events
  const subscription = await client.subscribe({
    eventTypes: ["*"],
  });

  console.log("\n--- Live Updates ---\n");

  for await (const event of subscription) {
    const time = new Date().toLocaleTimeString();

    switch (event.type) {
      case "agent.registered":
        console.log(`[${time}] 🟢 Agent joined: ${event.data.agent.name} (${event.data.agent.role})`);
        break;

      case "agent.unregistered":
        console.log(`[${time}] 🔴 Agent left: ${event.data.agentId}`);
        break;

      case "agent.updated":
        const a = event.data.agent;
        const state = a.state === "busy" ? "🔄" : "✅";
        console.log(`[${time}] ${state} ${a.name}: ${a.state}`);
        break;

      case "message.sent":
        const msg = event.data.message;
        if (msg.payload.type === "new-job") {
          console.log(`[${time}] 📥 New job: ${msg.payload.job.id} (${msg.payload.job.type})`);
        } else if (msg.payload.type === "assign-job") {
          console.log(`[${time}] 📤 Job assigned: ${msg.payload.job.id}`);
        } else if (msg.payload.type === "job-completed") {
          console.log(`[${time}] ✅ Job completed: ${msg.payload.jobId}`);
        } else if (msg.payload.type === "job-failed") {
          console.log(`[${time}] ❌ Job failed: ${msg.payload.jobId}`);
        }
        break;
    }
  }
}

async function showStatus(client: ClientConnection) {
  const { agents } = await client.listAgents();
  const { scopes } = await client.listScopes();

  console.log("Agents:");
  agents.forEach((a) => {
    const status = a.state === "busy" ? "🔄" : "✅";
    console.log(`  ${status} ${a.name} (${a.role})`);
  });

  console.log("\nScopes:");
  scopes.forEach((s) => {
    console.log(`  📁 ${s.name}`);
  });
}

main().catch(console.error);
```

## Running the System

```bash
# Terminal 1: Server
npx ts-node server/index.ts

# Terminal 2: Coordinator
npx ts-node agents/coordinator.ts

# Terminal 3: Worker 1
npx ts-node agents/workers/summarizer.ts worker-1

# Terminal 4: Worker 2
npx ts-node agents/workers/summarizer.ts worker-2

# Terminal 5: API Gateway
npx ts-node gateway/api.ts

# Terminal 6: Dashboard
npx ts-node dashboard/client.ts
```

## Testing with curl

```bash
# Upload document
curl -X POST http://localhost:3000/api/documents \
  -H "Content-Type: application/json" \
  -d '{"filename": "report.txt", "content": "Lorem ipsum...", "mimeType": "text/plain"}'

# Process document
curl -X POST http://localhost:3000/api/documents/DOC_ID/process \
  -H "Content-Type: application/json" \
  -d '{"type": "summarize"}'

# Check status
curl http://localhost:3000/api/jobs/JOB_ID

# List agents
curl http://localhost:3000/api/agents
```

## Key Concepts Demonstrated

| Feature | Implementation |
|---------|---------------|
| Custom handlers | `document/*` methods |
| Middleware | Auth, logging, metrics |
| Coordinator pattern | Central job distribution |
| Worker pattern | Capability-based assignment |
| Scope organization | jobs, workers, completed |
| REST integration | Express API gateway |
| Real-time monitoring | Dashboard with subscriptions |
| State management | Agent metadata for status |

## Next Steps

- **[Simple Chat Example](./simple-chat.md)** - Basic messaging
- **[Task Queue Example](./task-queue.md)** - Work distribution
- **[Server Advanced Guide](../guides/server-advanced.md)** - Building blocks
