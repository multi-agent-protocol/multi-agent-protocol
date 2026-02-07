# Environment Awareness

## Overview

Environment awareness enables agents to advertise and discover information about their compute environments. This facilitates intelligent task routing, filesystem coordination, and resource-aware scheduling in heterogeneous multi-agent systems.

## Motivation

Agents may run across diverse environments:
- Different mount points (Agent A at `/home/user/project`, Agent B at `/workspace/project`)
- Different compute types (local, Docker, Kubernetes, cloud sandbox)
- Different capabilities (GPU, specific tools, network access)
- Different constraints (memory limits, ephemeral storage, execution timeouts)

Environment awareness enables:
- **Task routing**: Send GPU workloads to GPU-enabled agents
- **Filesystem coordination**: Detect shared mounts vs. need for explicit file transfer
- **Resource optimization**: Choose agents based on cost, latency, or capacity
- **Security boundaries**: Route sensitive data to appropriately isolated agents

## Schema

The `AgentEnvironment` type uses a layered approach:

- **Layer 1 (Normative)**: Category names are standardized
- **Layer 2 (Conventions)**: Field names within categories are recommended patterns
- **Layer 3 (Extensions)**: Custom fields allowed via `additionalProperties`

```typescript
interface AgentEnvironment {
  schemaVersion?: string;      // Schema version (e.g., "1.0")
  profiles?: string[];         // Self-declared compliance (e.g., ["cloud-native"])

  // Standard categories (all optional, all extensible)
  host?: Record<string, unknown>;       // CPU, memory, GPU
  os?: Record<string, unknown>;         // OS type, version
  process?: Record<string, unknown>;    // PID, cwd, runtime
  container?: Record<string, unknown>;  // Container runtime info
  cloud?: Record<string, unknown>;      // Provider, region, instance type
  k8s?: Record<string, unknown>;        // Kubernetes context
  filesystem?: Record<string, unknown>; // Mounts, workspace, VCS
  network?: Record<string, unknown>;    // Connectivity, addresses
  tools?: Record<string, unknown>;      // Installed tools, runtimes
  resources?: Record<string, unknown>;  // Limits and constraints
  security?: Record<string, unknown>;   // Isolation, compliance
  services?: Record<string, unknown>;   // External APIs, MCP servers

  [key: string]: unknown;  // Additional categories allowed
}
```

## Common Field Conventions

These field names are **recommended** (not required) for interoperability:

| Category | Common Fields |
|----------|--------------|
| `host` | `arch`, `cpuCount`, `memoryBytes`, `gpu.count`, `gpu.models` |
| `os` | `type` (linux/darwin/windows), `version`, `name` |
| `process` | `pid`, `cwd`, `runtimeName`, `runtimeVersion` |
| `cloud` | `provider`, `region`, `instanceType`, `accountId` |
| `network` | `connectivity` (full/restricted/internal/isolated), `addresses` |
| `filesystem` | `cwd`, `mounts`, `workspace.root`, `workspace.vcs`, `workspace.branch` |
| `tools` | `installed`, `shell`, `runtimes`, `canInstall` |
| `resources` | `cpuLimit`, `memoryLimitBytes`, `maxExecutionSeconds`, `costProfile` |
| `security` | `isolation`, `privileged`, `sandbox`, `dataResidency` |
| `services` | `aiProviders`, `mcp` (MCP servers) |

## Protocol Integration

### Agent Registration

```typescript
await connection.register({
  name: 'my-agent',
  environment: {
    schemaVersion: '1.0',
    os: { type: 'linux', version: '22.04' },
    process: { cwd: '/home/user/project' },
    network: { connectivity: 'full' },
    tools: {
      installed: { python: '3.11', node: '20.0' },
      shell: 'bash'
    }
  }
});
```

### Connect Response

Servers can advertise their environment:

```typescript
interface ConnectResponse {
  // ... existing fields
  serverEnvironment?: AgentEnvironment;
}
```

### Environment Updates

Agents can update their environment via `map/agents/update`:

```typescript
await connection.update({
  agentId: myAgentId,
  environment: {
    resources: { memoryLimitBytes: 8589934592 }  // Updated
  }
});
```

### Event: `agent_environment_changed`

Emitted when an agent's environment changes:

```typescript
{
  type: 'agent_environment_changed',
  data: {
    agentId: 'agent-123',
    environment: { /* current */ },
    previousEnvironment: { /* previous */ }
  }
}
```

### Subscription Filtering

Filter events by environment attributes:

```typescript
await client.subscribe({
  filter: {
    eventTypes: ['agent_registered'],
    environmentMatch: {
      'os.type': 'linux',
      'cloud.provider': 'aws'
    }
  }
});
```

## Extension Patterns

### Adding fields to categories

```json
{
  "host": {
    "arch": "arm64",
    "memoryBytes": 17179869184,
    "x-apple-silicon": { "chip": "M2 Pro" }
  }
}
```

### Adding new categories

```json
{
  "schemaVersion": "1.0",
  "os": { "type": "linux" },
  "x-anthropic-sandbox": {
    "sandboxId": "sb-abc123",
    "tier": "premium"
  }
}
```

### Services with custom providers

```json
{
  "services": {
    "aiProviders": {
      "huggingface": { "available": true, "tier": "pro" },
      "openai": { "available": true }
    },
    "mcp": {
      "filesystem": { "available": true, "tools": ["read_file", "write_file"] }
    },
    "x-internal": {
      "userService": { "available": true }
    }
  }
}
```

## Use Cases

### Task Routing by Capability

```typescript
const agents = await client.agents.list();
const gpuAgent = agents.find(a =>
  a.environment?.host?.gpu?.count > 0
);
if (gpuAgent) {
  await client.send({ to: gpuAgent.id, payload: mlTask });
}
```

### Filesystem Coordination

```typescript
// Check if agents share a filesystem
const myMounts = myAgent.environment?.filesystem?.mounts ?? {};
const peerMounts = peerAgent.environment?.filesystem?.mounts ?? {};

const sharedMount = Object.keys(myMounts).find(name =>
  myMounts[name]?.shared && peerMounts[name]?.shared
);

if (sharedMount) {
  // Can use file paths directly
} else {
  // Need to transfer file contents via messages
}
```

### Network-Aware Routing

```typescript
const agents = await client.agents.list();
const internetAgent = agents.find(a =>
  a.environment?.network?.connectivity === 'full'
);
// Route external API calls through this agent
```

## Security Considerations

1. **Sensitive data**: Filter environment variables before exposing (no API keys, tokens)
2. **Opt-in exposure**: Agents explicitly choose what to advertise
3. **Visibility rules**: Environment respects existing MAP visibility/permissions
4. **Trust boundaries**: Don't implicitly trust environment claims from untrusted agents

## References

- [OpenTelemetry Resource Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/resource/)
- [Kubernetes Node Feature Discovery](https://kubernetes-sigs.github.io/node-feature-discovery/)
