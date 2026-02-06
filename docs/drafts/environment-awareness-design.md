# Environment Awareness Schema Design

## Overview

This document proposes a schema for compute environment awareness in the Multi-Agent Protocol (MAP). The goal is to enable agents to discover, advertise, and reason about their runtime environments to facilitate better coordination in heterogeneous multi-agent systems.

## Motivation

In multi-agent systems, agents may run across diverse compute environments:

- **Different mount points**: Agent A at `/home/user/project`, Agent B at `/workspace/project`
- **Different compute types**: Local machine, Docker container, cloud sandbox, Kubernetes pod
- **Different capabilities**: Some have GPU, some have specific tools installed
- **Different network contexts**: Internet access, VPN, air-gapped, internal only
- **Different resource constraints**: Memory limits, CPU quotas, ephemeral vs persistent

Without environment awareness, agents cannot:
1. Route tasks to capable agents (e.g., GPU workloads to GPU-enabled agents)
2. Coordinate on shared filesystems vs need explicit data transfer
3. Understand trust boundaries and security contexts
4. Optimize for cost, latency, or resource availability
5. Debug failures that stem from environment differences

## Design Principles

1. **Structured but extensible**: Core fields are well-defined; custom fields use prefixes
2. **Optional**: Environment info is not required; agents can operate without it
3. **Composable**: Different detectors can contribute different parts
4. **Versioned**: Schema evolution via version field
5. **Inspired by prior art**: Draws from OpenTelemetry, Kubernetes, OCI, and cloud IMDS patterns

## Standardization Philosophy

Environment awareness uses a **layered approach** to balance interoperability with flexibility:

### Layer 1: Core Structure (Normative)

The top-level `AgentEnvironment` structure and category names are standardized:

```typescript
interface AgentEnvironment {
  schemaVersion: string;  // Required
  host?: HostInfo;
  os?: OSInfo;
  process?: ProcessInfo;
  container?: ContainerInfo;
  cloud?: CloudInfo;
  k8s?: KubernetesInfo;
  filesystem?: FilesystemInfo;
  network?: NetworkInfo;
  tools?: ToolsInfo;
  resources?: ResourceInfo;
  security?: SecurityInfo;
  services?: ServicesInfo;
  extensions?: Record<string, unknown>;  // Escape hatch
}
```

**Why standardize this?** Agents need to know where to look. If one agent puts network info in `network` and another in `connectivity`, interop breaks.

### Layer 2: Semantic Conventions (Recommended)

The fields within each category are **semantic conventions** — documented patterns that implementations SHOULD follow for interoperability, but MAY extend or ignore.

```typescript
// These field names are conventions, not mandates
interface NetworkInfo {
  connectivity?: 'full' | 'restricted' | 'internal' | 'isolated';  // Recommended
  hostname?: string;        // Recommended
  addresses?: NetworkAddress[];  // Recommended
  // ... other recommended fields

  // Implementations can add their own
  [key: string]: unknown;
}
```

**Convention documentation** lives separately (like OTel's semantic conventions). The schema shows common patterns; implementations decide what to populate.

### Layer 3: Extensions (Open)

The `extensions` field and `metadata` fields within types are completely open:

```typescript
const environment: AgentEnvironment = {
  schemaVersion: '1.0',
  os: { type: 'linux' },

  // Completely open - no schema validation
  extensions: {
    'x-company-internal': { teamId: 'platform', costCenter: '12345' },
    'x-experimental-feature': { enabled: true }
  }
};
```

### Layer 4: Profiles (Optional Bundles)

For specific use cases, define **profiles** that bundle required fields:

```typescript
// A "cloud-native" profile might require:
interface CloudNativeProfile {
  // Must have cloud info
  cloud: Required<Pick<CloudInfo, 'provider' | 'region'>>;
  // Must have container or k8s
  container?: ContainerInfo;
  k8s?: KubernetesInfo;
  // Must declare network connectivity
  network: Required<Pick<NetworkInfo, 'connectivity'>>;
}

// Agent can declare profile compliance
const environment: AgentEnvironment = {
  schemaVersion: '1.0',
  profiles: ['cloud-native', 'ml-ready'],  // Self-declared
  // ... fields that satisfy those profiles
};
```

### What This Means in Practice

**For workspace integrations (task trackers, etc.):**

```typescript
// The STRUCTURE is standardized (where to look)
filesystem?.workspace?.integrations?.taskTrackers

// The CONTENT is conventions (common patterns, not required)
taskTrackers: {
  'my-tracker': {
    type: 'beads',       // Convention: use known type strings
    available: true,     // Convention: boolean availability
    configPath: '.beads/', // Convention: path to config

    // Open: add whatever else you need
    customField: 'anything'
  }
}
```

**For services (API access):**

```typescript
// The STRUCTURE is standardized
services?.aiProviders

// The CONTENT is conventions
aiProviders: {
  'huggingface': {
    available: true,     // Convention
    models: ['...'],     // Convention
    tier: 'pro',         // Convention

    // Open: implementation-specific
    organizationId: 'org-123',
    quotaRemaining: 42
  }
}
```

### Implementation Guidance

| If you're... | Do this |
|--------------|---------|
| **Building a MAP server** | Accept any valid `AgentEnvironment`, don't validate field contents deeply |
| **Building an agent SDK** | Provide helpers for common conventions, allow arbitrary extensions |
| **Building a routing/orchestration layer** | Document which conventions you rely on, gracefully degrade if missing |
| **Experimenting with new patterns** | Use `extensions` or add fields to existing categories, propose as conventions later |

### Evolution Path

1. **Experiment** in `extensions` with `x-` prefix
2. **Propose** as semantic convention if pattern proves useful
3. **Document** in conventions registry
4. **Optionally** add to a profile if commonly required together

## Schema Design

### Top-Level Structure

```typescript
/**
 * Compute environment information for an agent.
 * Describes the runtime context where the agent executes.
 *
 * Layer 1 (Normative): The category names (host, os, network, etc.) are standardized.
 * Layer 2 (Conventions): Fields within categories are recommended patterns.
 * Layer 3 (Open): Use extensions or add fields to any category.
 */
interface AgentEnvironment {
  /** Schema version for evolution (e.g., "1.0") */
  schemaVersion: string;

  /** Self-declared profile compliance (e.g., ["cloud-native", "ml-ready"]) */
  profiles?: string[];

  /** Host/machine information */
  host?: HostInfo;

  /** Operating system information */
  os?: OSInfo;

  /** Process/runtime information */
  process?: ProcessInfo;

  /** Container information (if running in a container) */
  container?: ContainerInfo;

  /** Cloud provider information (if running in cloud) */
  cloud?: CloudInfo;

  /** Kubernetes information (if running in K8s) */
  k8s?: KubernetesInfo;

  /** Filesystem/workspace information */
  filesystem?: FilesystemInfo;

  /** Network environment information */
  network?: NetworkInfo;

  /** Available tools and runtimes */
  tools?: ToolsInfo;

  /** Resource limits and constraints */
  resources?: ResourceInfo;

  /** Security and isolation context */
  security?: SecurityInfo;

  /** External services and API access */
  services?: ServicesInfo;

  /** Vendor/custom extensions (x-* prefix recommended) */
  extensions?: Record<string, unknown>;

  /** Allow additional categories not yet standardized */
  [key: string]: unknown;
}
```

### Host Information

```typescript
/**
 * Information about the host machine.
 * Conventions follow OpenTelemetry semantic conventions for host.*.
 */
interface HostInfo {
  // --- Recommended fields (conventions) ---

  /** Unique host identifier */
  id?: string;

  /** Hostname */
  name?: string;

  /** Host type (e.g., "physical", "vm", "container-host") */
  type?: string;

  /** CPU architecture (e.g., "amd64", "arm64", "x86_64") */
  arch?: string;

  /** Number of CPUs/cores available */
  cpuCount?: number;

  /** CPU model name */
  cpuModel?: string;

  /** Total memory in bytes */
  memoryBytes?: number;

  /** GPU information (if available) */
  gpu?: {
    count?: number;
    models?: string[];
    memoryBytes?: number;
    [key: string]: unknown;  // Allow vendor-specific GPU fields
  };

  /** Allow additional fields */
  [key: string]: unknown;
}
```

### Operating System Information

```typescript
/**
 * Operating system information.
 * Conventions follow OpenTelemetry semantic conventions for os.*.
 */
interface OSInfo {
  /** OS type (e.g., "linux", "darwin", "windows") - recommended */
  type?: string;

  /** OS name (e.g., "Ubuntu", "macOS", "Windows 11") */
  name?: string;

  /** OS version (e.g., "22.04", "14.0", "10.0.22621") */
  version?: string;

  /** Full OS description */
  description?: string;

  /** Kernel version */
  kernelVersion?: string;

  /** Allow additional fields */
  [key: string]: unknown;
}
```

### Process/Runtime Information

```typescript
/**
 * Process and runtime environment information.
 */
interface ProcessInfo {
  /** Process ID */
  pid?: number;

  /** Parent process ID */
  ppid?: number;

  /** Process owner username */
  owner?: string;

  /** Primary runtime name (e.g., "nodejs", "python", "go") */
  runtimeName?: string;

  /** Runtime version (e.g., "20.0.0", "3.11.0") */
  runtimeVersion?: string;

  /** Command used to start the process */
  command?: string;

  /** Current working directory */
  cwd?: string;

  /** Environment variables (filtered for safety) */
  envVars?: Record<string, string>;

  /** Allow additional fields */
  [key: string]: unknown;
}
```

### Container Information

```typescript
/**
 * Container runtime information.
 * Present when the agent runs inside a container.
 */
interface ContainerInfo {
  /** Container ID */
  id?: string;

  /** Container name */
  name?: string;

  /** Container image name */
  imageName?: string;

  /** Container image tag */
  imageTag?: string;

  /** Container image ID/digest */
  imageId?: string;

  /** Container runtime (e.g., "docker", "containerd", "podman", "cri-o") */
  runtime?: string;

  /** Runtime version */
  runtimeVersion?: string;

  /** Whether the container is privileged */
  privileged?: boolean;

  /** Linux capabilities granted to the container */
  capabilities?: string[];

  /** Allow additional fields */
  [key: string]: unknown;
}
```

### Cloud Provider Information

```typescript
/**
 * Cloud provider information.
 * Conventions follow OpenTelemetry semantic conventions for cloud.*.
 */
interface CloudInfo {
  /** Cloud provider (e.g., "aws", "gcp", "azure", "digitalocean") */
  provider?: string;

  /** Cloud platform (e.g., "aws_ec2", "aws_lambda", "gcp_compute_engine") */
  platform?: string;

  /** Cloud account ID */
  accountId?: string;

  /** Geographic region (e.g., "us-east-1", "europe-west1") */
  region?: string;

  /** Availability zone (e.g., "us-east-1a") */
  availabilityZone?: string;

  /** Instance/resource ID */
  resourceId?: string;

  /** Instance type (e.g., "m5.large", "n1-standard-4") */
  instanceType?: string;

  /** Allow additional fields */
  [key: string]: unknown;
}
```

### Kubernetes Information

```typescript
/**
 * Kubernetes environment information.
 * Present when the agent runs in a Kubernetes cluster.
 */
interface KubernetesInfo {
  /** Cluster name */
  clusterName?: string;

  /** Cluster UID */
  clusterUid?: string;

  /** Namespace */
  namespace?: string;

  /** Pod name */
  podName?: string;

  /** Pod UID */
  podUid?: string;

  /** Container name within the pod */
  containerName?: string;

  /** Node name */
  nodeName?: string;

  /** Deployment/ReplicaSet/StatefulSet name */
  workloadName?: string;

  /** Workload type (e.g., "deployment", "statefulset", "daemonset") */
  workloadType?: string;

  /** Pod labels (filtered subset) */
  labels?: Record<string, string>;

  /** Service account name */
  serviceAccount?: string;

  /** Allow additional fields */
  [key: string]: unknown;
}
```

### Filesystem Information

```typescript
/**
 * Filesystem and workspace information.
 * Critical for coordinating file-based operations between agents.
 */
interface FilesystemInfo {
  /** Current working directory (absolute path) */
  cwd?: string;

  /** Home directory */
  homeDir?: string;

  /** Temp directory */
  tempDir?: string;

  /**
   * Mount points relevant to the agent's work.
   * Maps logical names to mount info for cross-agent coordination.
   */
  mounts?: Record<string, MountInfo>;

  /**
   * Workspace/project information.
   * Describes the primary working context.
   */
  workspace?: WorkspaceInfo;

  /** Whether the filesystem is read-only */
  readOnly?: boolean;

  /** Whether the filesystem is ephemeral (lost on restart) */
  ephemeral?: boolean;

  /** Available disk space in bytes */
  availableBytes?: number;

  /** Allow additional fields */
  [key: string]: unknown;
}

/**
 * Mount point information.
 * path is the only recommended field; others are conventions.
 */
interface MountInfo {
  /** Absolute path on this agent's filesystem */
  path: string;

  /** Mount type (e.g., "local", "nfs", "s3", "gcs", "bind") */
  type?: string;

  /** Whether the mount is read-only */
  readOnly?: boolean;

  /** Whether the mount is shared with other agents */
  shared?: boolean;

  /** IDs of agents that share this mount (if known) */
  sharedWith?: string[];

  /** Allow additional fields */
  [key: string]: unknown;
}

/**
 * Workspace/project information.
 * All fields are conventions - populate what's relevant.
 */
interface WorkspaceInfo {
  /** Workspace root path */
  root?: string;

  /** Workspace/project name */
  name?: string;

  /** Version control system (e.g., "git", "svn") */
  vcs?: string;

  /** Current branch (for git) */
  branch?: string;

  /** Current commit/revision */
  revision?: string;

  /** Whether there are uncommitted changes */
  dirty?: boolean;

  /** Remote repository URL */
  remoteUrl?: string;

  /**
   * Project integrations and tooling.
   * Open-ended: add whatever integrations are relevant.
   */
  integrations?: Record<string, IntegrationInfo>;

  /** Allow additional fields */
  [key: string]: unknown;
}

/**
 * Integration info for project tooling.
 * Completely open-ended - 'available' is the only recommended field.
 */
interface IntegrationInfo {
  /** Whether the integration is currently accessible/authenticated (recommended) */
  available?: boolean;

  /** Integration type/provider (e.g., "linear", "jira", "beads", "speckit") */
  type?: string;

  /** URL or path to access this integration */
  url?: string;

  /** Local config file path (if file-based like .beads/) */
  configPath?: string;

  /** Allow any additional fields */
  [key: string]: unknown;
}
```

### Network Information

```typescript
/**
 * Network environment information.
 * Describes connectivity and network topology.
 */
interface NetworkInfo {
  /**
   * Network connectivity level (recommended convention).
   * Common values: "full", "restricted", "internal", "isolated"
   */
  connectivity?: string;

  /** Hostname as seen on the network */
  hostname?: string;

  /** Primary IP addresses */
  addresses?: Array<{
    ip: string;
    type?: string;  // "ipv4" | "ipv6"
    public?: boolean;
    [key: string]: unknown;
  }>;

  /** DNS servers */
  dnsServers?: string[];

  /** HTTP/HTTPS proxy URL (if configured) */
  httpProxy?: string;

  /** Domains/hosts that bypass the proxy */
  noProxy?: string[];

  /** VPN/mesh network membership */
  meshNetworks?: string[];

  /** Allow additional fields */
  [key: string]: unknown;
}
```

### Tools Information

```typescript
/**
 * Available tools, SDKs, and runtimes.
 * Describes what the agent can execute.
 */
interface ToolsInfo {
  /**
   * Installed tools/executables.
   * Key is tool name, value can be version string or object with details.
   */
  installed?: Record<string, unknown>;

  /** Shell available (e.g., "bash", "zsh", "sh", "powershell") */
  shell?: string;

  /** Package managers available */
  packageManagers?: string[];

  /**
   * Language runtimes available.
   * Maps language to version(s).
   */
  runtimes?: Record<string, unknown>;

  /** Whether the agent can install new tools */
  canInstall?: boolean;

  /** Allow additional fields */
  [key: string]: unknown;
}
```

### Resource Information

```typescript
/**
 * Resource limits and constraints.
 * All fields are conventions - report what's relevant.
 */
interface ResourceInfo {
  /** CPU limit (in cores or millicores, e.g., "2", "500m") */
  cpuLimit?: string;

  /** Memory limit in bytes */
  memoryLimitBytes?: number;

  /** Disk quota in bytes */
  diskQuotaBytes?: number;

  /** Process/thread limit */
  processLimit?: number;

  /** Open file descriptor limit */
  fileDescriptorLimit?: number;

  /** Network bandwidth limit in bytes/sec */
  networkBandwidthBytes?: number;

  /** Maximum execution time in seconds (for serverless) */
  maxExecutionSeconds?: number;

  /** Whether resources are shared with other workloads */
  shared?: boolean;

  /** Cost profile for resource usage (convention: "free", "low", "medium", "high", "premium") */
  costProfile?: string;

  /** Allow additional fields */
  [key: string]: unknown;
}
```

### Security Information

```typescript
/**
 * Security and isolation context.
 * Describes the security boundaries and capabilities.
 */
interface SecurityInfo {
  /**
   * Isolation level (convention).
   * Common values: "none", "process", "container", "vm", "hardware"
   */
  isolation?: string;

  /** Whether running as root/admin */
  privileged?: boolean;

  /** User ID running the agent */
  userId?: string;

  /** Security context labels (SELinux, AppArmor) */
  securityLabels?: Record<string, string>;

  /** Linux capabilities available */
  capabilities?: string[];

  /** Sandboxing technology (e.g., "seccomp", "landlock", "gvisor") */
  sandbox?: string;

  /** Whether secrets/credentials are available */
  hasSecrets?: boolean;

  /** Compliance/certification context */
  compliance?: string[];

  /** Data residency region */
  dataResidency?: string;

  /** Allow additional fields */
  [key: string]: unknown;
}
```

### Services Information

```typescript
/**
 * External services and APIs the agent has access to.
 * Describes authenticated integrations without exposing credentials.
 *
 * Structure is open-ended - use whatever categorization makes sense.
 * The examples below are conventions, not requirements.
 */
interface ServicesInfo {
  /**
   * AI/ML model providers (convention).
   * Examples: huggingface, openai, anthropic
   */
  aiProviders?: Record<string, ServiceAccess>;

  /**
   * MCP servers available to this agent (convention).
   */
  mcp?: Record<string, MCPServerInfo>;

  /**
   * Allow any other service categories.
   * Examples: databases, messaging, codeHosting, cloudApis
   */
  [key: string]: unknown;
}

/**
 * Access information for an external service.
 * 'available' is the only recommended field.
 */
interface ServiceAccess {
  /** Whether access is currently available/authenticated (recommended) */
  available?: boolean;

  /** Access level or tier */
  tier?: string;

  /** Specific capabilities or scopes available */
  scopes?: string[];

  /** Rate limits */
  rateLimit?: Record<string, unknown>;

  /** Specific models or resources accessible (for AI providers) */
  models?: string[];

  /** Allow any additional fields */
  [key: string]: unknown;
}

/**
 * MCP server information (convention).
 */
interface MCPServerInfo {
  /** Whether the server is currently available */
  available?: boolean;

  /** Transport type */
  transport?: string;

  /** Tools provided by this MCP server */
  tools?: string[];

  /** Resources provided by this MCP server */
  resources?: string[];

  /** Allow additional fields */
  [key: string]: unknown;
}
```

#### Services Examples

```typescript
// Agent with HuggingFace and OpenAI access
const services: ServicesInfo = {
  // Convention: aiProviders for ML APIs
  aiProviders: {
    huggingface: {
      available: true,
      tier: 'pro',
      models: ['meta-llama/Llama-2-70b-chat-hf'],
      // Custom field - not in schema but allowed
      organizationId: 'my-org'
    },
    openai: { available: true, models: ['gpt-4'] },
    anthropic: { available: false }
  },

  // Convention: mcp for MCP servers
  mcp: {
    filesystem: {
      available: true,
      transport: 'stdio',
      tools: ['read_file', 'write_file']
    },
    github: {
      available: true,
      tools: ['create_issue', 'create_pr']
    }
  },

  // Custom categories - just add them
  databases: {
    pinecone: { available: true, indexes: ['embeddings'] }
  },
  internalApis: {
    userService: { available: true, baseUrl: 'http://users.internal' }
  }
};
```

## Integration with MAP

### Agent Registration

Environment information is provided during agent registration:

```typescript
interface AgentsRegisterRequestParams {
  agentId?: AgentId;
  name?: string;
  // ... existing fields ...

  /** Compute environment information */
  environment?: AgentEnvironment;
}
```

### Agent Type Extension

The `Agent` type includes environment:

```typescript
interface Agent {
  id: AgentId;
  // ... existing fields ...

  /** Compute environment where this agent runs */
  environment?: AgentEnvironment;
}
```

### Connect Response

Servers can advertise their environment in connect response:

```typescript
interface ConnectResponseResult {
  // ... existing fields ...

  /** Server's compute environment (if relevant) */
  serverEnvironment?: AgentEnvironment;
}
```

### Environment Event

New event type for environment changes:

```typescript
// Add to EVENT_TYPES
AGENT_ENVIRONMENT_CHANGED: 'agent_environment_changed'

interface AgentEnvironmentChangedEventData {
  agentId: AgentId;
  previousEnvironment?: AgentEnvironment;
  currentEnvironment: AgentEnvironment;
  /** Which parts changed */
  changedFields: string[];
}
```

### Subscription Filter

Filter subscriptions by environment attributes:

```typescript
interface SubscriptionFilter {
  // ... existing fields ...

  /** Filter by agent environment attributes */
  environmentMatch?: {
    /** Match agents on specific OS */
    'os.type'?: string[];
    /** Match agents with specific tools */
    'tools.installed'?: string[];
    /** Match agents in specific cloud regions */
    'cloud.region'?: string[];
    /** Match agents with specific network connectivity */
    'network.connectivity'?: ('full' | 'restricted' | 'internal' | 'isolated')[];
    /** Generic key-value matching */
    [key: string]: unknown;
  };
}
```

## Discovery Methods

### New Method: `map/environment/detect`

Auto-detect environment information:

```typescript
interface EnvironmentDetectRequestParams {
  /** Which categories to detect (empty = all) */
  categories?: ('host' | 'os' | 'process' | 'container' | 'cloud' | 'k8s' | 'filesystem' | 'network' | 'tools' | 'resources' | 'security')[];

  /** Whether to include expensive detections */
  thorough?: boolean;
}

interface EnvironmentDetectResponseResult {
  environment: AgentEnvironment;
  /** Categories that were detected */
  detectedCategories: string[];
  /** Detection errors (partial success possible) */
  errors?: Record<string, string>;
}
```

### New Method: `map/environment/compare`

Compare environments between agents:

```typescript
interface EnvironmentCompareRequestParams {
  /** Agents to compare */
  agentIds: AgentId[];

  /** Categories to compare (empty = all) */
  categories?: string[];
}

interface EnvironmentCompareResponseResult {
  /** Fields that are the same across all agents */
  common: Partial<AgentEnvironment>;

  /** Fields that differ, keyed by agent ID */
  differences: Record<AgentId, Partial<AgentEnvironment>>;

  /** Compatibility assessment */
  compatibility: {
    /** Can agents share files directly? */
    sharedFilesystem: boolean;
    /** Can agents communicate directly? */
    directNetwork: boolean;
    /** Are agents in the same security domain? */
    sameTrustDomain: boolean;
  };
}
```

## Usage Examples

### Task Routing Based on Capabilities

```typescript
// Find an agent with GPU for ML inference
const agents = await client.agentsList({
  filter: {
    states: ['active'],
  }
});

const gpuAgent = agents.find(a =>
  a.environment?.host?.gpu?.count && a.environment.host.gpu.count > 0
);

if (gpuAgent) {
  await client.send({
    to: { agent: gpuAgent.id },
    payload: { task: 'inference', model: 'llama-70b' }
  });
}
```

### Filesystem Coordination

```typescript
// Check if agents share a filesystem
const agentA = await client.agentsGet({ agentId: 'agent-a' });
const agentB = await client.agentsGet({ agentId: 'agent-b' });

const sharedMount = Object.entries(agentA.agent.environment?.filesystem?.mounts ?? {})
  .find(([name, mount]) =>
    mount.shared &&
    agentB.agent.environment?.filesystem?.mounts?.[name]?.shared
  );

if (sharedMount) {
  // Agents can coordinate via shared filesystem
  const [mountName, mountInfo] = sharedMount;
  console.log(`Shared mount: ${mountName} at ${mountInfo.path}`);
} else {
  // Need to transfer files explicitly via messages
}
```

### Network-Aware Routing

```typescript
// Route external API calls to agents with internet access
async function routeExternalRequest(request: ExternalAPIRequest) {
  const agents = await client.agentsList();

  const internetAgent = agents.find(a =>
    a.environment?.network?.connectivity === 'full' ||
    a.environment?.network?.connectivity === 'restricted'
  );

  if (!internetAgent) {
    throw new Error('No agent with external network access');
  }

  return client.send({
    to: { agent: internetAgent.id },
    payload: { type: 'external_api_call', request }
  });
}
```

## Use Cases

This section details how different participants in a multi-agent system would use environment information.

---

### Use Cases: What Would an Agent Use This Information For?

#### 1. Self-Awareness and Capability Advertisement

An agent needs to understand its own environment to accurately advertise what it can do.

```typescript
// Agent self-registers with detected environment
const myEnvironment = await detectEnvironment();

await client.agentsRegister({
  name: 'code-executor',
  role: 'executor',
  environment: myEnvironment,
  capabilities: {
    // Capabilities derived from environment
    protocols: myEnvironment.tools?.installed?.['python'] ? ['python-exec'] : [],
  }
});
```

**Scenarios:**
- "I have Python 3.11 installed, so I can execute Python scripts"
- "I'm in a container with no network, so I can only do offline tasks"
- "I have 32GB RAM and a GPU, so I can handle ML inference"
- "My filesystem is ephemeral, so I shouldn't be assigned tasks requiring persistent storage"

#### 2. Peer Discovery and Task Delegation

An agent can query other agents' environments to decide who to delegate work to.

```typescript
// Agent looking for a peer to handle a GPU task
async function delegateGPUTask(task: MLTask) {
  const peers = await client.agentsList({ filter: { states: ['active'] } });

  // Find peer with GPU and sufficient memory
  const gpuPeer = peers.agents.find(peer => {
    const env = peer.environment;
    return (
      env?.host?.gpu?.count &&
      env.host.gpu.count > 0 &&
      env.host.gpu.memoryBytes &&
      env.host.gpu.memoryBytes >= task.requiredVRAM
    );
  });

  if (gpuPeer) {
    await client.send({
      to: { agent: gpuPeer.id },
      payload: { type: 'ml_inference', task }
    });
  } else {
    // Fall back to CPU inference or queue for later
  }
}
```

#### 3. Path Translation for Shared Filesystems

When agents share a filesystem but have different mount points, they need to translate paths.

```typescript
// Agent A wants to tell Agent B about a file
async function shareFileReference(targetAgentId: string, localPath: string) {
  const myEnv = await client.agentsGet({ agentId: myAgentId });
  const targetEnv = await client.agentsGet({ agentId: targetAgentId });

  // Find which mount contains this path
  const myMounts = myEnv.agent.environment?.filesystem?.mounts ?? {};
  const targetMounts = targetEnv.agent.environment?.filesystem?.mounts ?? {};

  for (const [mountName, myMount] of Object.entries(myMounts)) {
    if (localPath.startsWith(myMount.path) && targetMounts[mountName]) {
      // Translate path: replace my mount path with theirs
      const relativePath = localPath.slice(myMount.path.length);
      const targetPath = targetMounts[mountName].path + relativePath;

      await client.send({
        to: { agent: targetAgentId },
        payload: {
          type: 'file_ready',
          path: targetPath,  // Path as seen by target agent
          originalPath: localPath  // For debugging
        }
      });
      return;
    }
  }

  // No shared mount - need to transfer file contents instead
  await transferFileViaMessage(targetAgentId, localPath);
}
```

#### 4. Network-Aware Service Access

An agent decides how to access external services based on its network environment.

```typescript
async function fetchExternalData(url: string) {
  const myEnv = (await client.agentsGet({ agentId: myAgentId })).agent.environment;

  switch (myEnv?.network?.connectivity) {
    case 'full':
      // Direct access
      return fetch(url);

    case 'restricted':
      // Check if this URL is allowed
      const allowed = myEnv.network.allowedOutbound?.some(rule =>
        matchesRule(url, rule)
      );
      if (allowed) return fetch(url);
      // Fall through to delegate

    case 'internal':
    case 'isolated':
      // Delegate to an agent with network access
      const networkAgent = await findAgentWithNetworkAccess();
      if (networkAgent) {
        const response = await client.send({
          to: { agent: networkAgent.id },
          payload: { type: 'http_fetch', url },
          meta: { expectsResponse: true }
        });
        return response;
      }
      throw new Error('No network access available');
  }
}
```

#### 5. Resource-Aware Task Acceptance

An agent can decide whether to accept a task based on its resource constraints.

```typescript
// Agent's message handler
async function handleIncomingTask(message: Message) {
  const task = message.payload as Task;
  const myEnv = myAgent.environment;

  // Check if we have enough resources
  if (task.estimatedMemoryMB && myEnv?.resources?.memoryLimitBytes) {
    const availableMB = myEnv.resources.memoryLimitBytes / (1024 * 1024);
    if (task.estimatedMemoryMB > availableMB * 0.8) {
      // Reject - would exceed safe memory threshold
      await client.send({
        to: { agent: message.from },
        payload: {
          type: 'task_rejected',
          reason: 'insufficient_memory',
          required: task.estimatedMemoryMB,
          available: availableMB
        }
      });
      return;
    }
  }

  // Check execution time limits (serverless)
  if (task.estimatedDurationSec && myEnv?.resources?.maxExecutionSeconds) {
    if (task.estimatedDurationSec > myEnv.resources.maxExecutionSeconds) {
      await client.send({
        to: { agent: message.from },
        payload: {
          type: 'task_rejected',
          reason: 'would_exceed_timeout',
          required: task.estimatedDurationSec,
          limit: myEnv.resources.maxExecutionSeconds
        }
      });
      return;
    }
  }

  // Accept and process
  await processTask(task);
}
```

#### 6. Service-Aware Task Routing

An agent routes ML inference to a peer with the appropriate API access.

```typescript
// Route inference request to agent with HuggingFace access
async function routeInferenceTask(task: InferenceTask) {
  const peers = await client.agentsList({ filter: { states: ['active'] } });

  // Find peer with HuggingFace access and the specific model
  const hfPeer = peers.agents.find(peer => {
    const hfAccess = peer.environment?.services?.aiProviders?.['huggingface'];
    return (
      hfAccess?.available &&
      hfAccess.models?.includes(task.model)
    );
  });

  if (hfPeer) {
    return client.send({
      to: { agent: hfPeer.id },
      payload: { type: 'inference', task }
    });
  }

  // Fall back to OpenAI if no HuggingFace access
  const openaiPeer = peers.agents.find(peer =>
    peer.environment?.services?.aiProviders?.['openai']?.available
  );

  if (openaiPeer) {
    return client.send({
      to: { agent: openaiPeer.id },
      payload: { type: 'inference', task, fallbackModel: 'gpt-4' }
    });
  }

  throw new Error('No agent with ML API access available');
}
```

#### 7. Project Integration Discovery

An agent discovers what project tools are available in the workspace.

```typescript
// Check if we can create issues in the project's task tracker
async function createTaskIfTrackerAvailable(taskDescription: string) {
  const myEnv = myAgent.environment;
  const integrations = myEnv?.filesystem?.workspace?.integrations;

  // Check for available task trackers
  const taskTrackers = integrations?.taskTrackers ?? {};
  const availableTracker = Object.entries(taskTrackers)
    .find(([_, info]) => info.available);

  if (availableTracker) {
    const [trackerName, trackerInfo] = availableTracker;

    switch (trackerInfo.type) {
      case 'github-issues':
        // Use GitHub MCP or API
        await createGitHubIssue(taskDescription);
        break;
      case 'linear':
        // Use Linear API
        await createLinearIssue(taskDescription, trackerInfo.url);
        break;
      case 'beads':
        // Use local beads CLI or file-based approach
        await createBeadsTask(taskDescription, trackerInfo.configPath);
        break;
      default:
        console.log(`Unknown tracker type: ${trackerInfo.type}`);
    }
  } else {
    // No task tracker - log to file or report back
    console.log('No task tracker available, logging to file');
    await appendToFile('tasks.md', `- [ ] ${taskDescription}\n`);
  }
}
```

#### 8. MCP Server Capability Discovery

An agent checks what MCP servers are available to extend its capabilities.

```typescript
// Find an agent that can perform a specific MCP tool operation
async function findAgentWithMCPTool(toolName: string): Promise<Agent | undefined> {
  const agents = await client.agentsList({ filter: { states: ['active'] } });

  return agents.agents.find(agent => {
    const mcpServers = agent.environment?.services?.mcp ?? {};
    return Object.values(mcpServers).some(server =>
      server.available && server.tools?.includes(toolName)
    );
  });
}

// Example: Find an agent that can create GitHub PRs via MCP
const prAgent = await findAgentWithMCPTool('create_pr');
if (prAgent) {
  await client.send({
    to: { agent: prAgent.id },
    payload: {
      type: 'mcp_tool_call',
      tool: 'create_pr',
      args: { title: 'Fix bug', body: 'Description...' }
    }
  });
}
```

#### 9. Security-Aware Workload Placement

An agent can assess whether it's appropriate to handle sensitive data.

```typescript
async function handleSensitiveTask(task: SensitiveDataTask) {
  const myEnv = myAgent.environment;

  // Check isolation level
  if (myEnv?.security?.isolation === 'none' || myEnv?.security?.isolation === 'process') {
    // Not isolated enough for sensitive data
    const secureAgent = await findAgentWithIsolation(['container', 'vm', 'hardware']);
    if (secureAgent) {
      return delegateTo(secureAgent, task);
    }
    throw new Error('No sufficiently isolated agent available');
  }

  // Check data residency requirements
  if (task.dataResidencyRequired && myEnv?.security?.dataResidency !== task.dataResidencyRequired) {
    throw new Error(`Data residency mismatch: need ${task.dataResidencyRequired}, have ${myEnv?.security?.dataResidency}`);
  }

  // Check compliance
  if (task.requiredCompliance) {
    const myCompliance = new Set(myEnv?.security?.compliance ?? []);
    const missing = task.requiredCompliance.filter(c => !myCompliance.has(c));
    if (missing.length > 0) {
      throw new Error(`Missing compliance: ${missing.join(', ')}`);
    }
  }

  // Safe to process
  await processSensitiveTask(task);
}
```

---

### Use Cases: What Would a Client Application Use This Information For?

#### 1. Intelligent Task Routing Dashboard

A client application (UI/orchestrator) can make informed decisions about where to send tasks.

```typescript
// Client-side orchestrator
class TaskOrchestrator {
  async routeTask(task: Task): Promise<AgentId> {
    const agents = await this.client.agentsList({ filter: { states: ['active'] } });

    // Score each agent based on task requirements vs environment
    const scored = agents.agents.map(agent => ({
      agent,
      score: this.scoreAgentForTask(agent, task)
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    if (scored[0].score <= 0) {
      throw new Error('No suitable agent found for task');
    }

    return scored[0].agent.id;
  }

  private scoreAgentForTask(agent: Agent, task: Task): number {
    let score = 0;
    const env = agent.environment;
    if (!env) return 0;  // No environment info = can't assess

    // Tool requirements
    if (task.requiredTools) {
      const installedTools = new Set(Object.keys(env.tools?.installed ?? {}));
      const hasAll = task.requiredTools.every(t => installedTools.has(t));
      if (!hasAll) return -1;  // Disqualified
      score += 10;
    }

    // Prefer agents with more resources
    if (env.host?.memoryBytes) {
      score += Math.log2(env.host.memoryBytes / (1024 * 1024 * 1024));  // +1 per GB
    }

    // Prefer cheaper compute
    const costScores = { 'free': 10, 'low': 8, 'medium': 5, 'high': 2, 'premium': 0 };
    score += costScores[env.resources?.costProfile ?? 'medium'];

    // Prefer same region (lower latency)
    if (task.preferredRegion && env.cloud?.region === task.preferredRegion) {
      score += 5;
    }

    // Penalize ephemeral for long-running tasks
    if (task.longRunning && env.filesystem?.ephemeral) {
      score -= 5;
    }

    return score;
  }
}
```

#### 2. Environment Comparison View

A UI showing differences between agents for debugging coordination issues.

```typescript
// Client fetches comparison data for display
async function getEnvironmentComparison(agentIds: AgentId[]) {
  const agents = await Promise.all(
    agentIds.map(id => client.agentsGet({ agentId: id }))
  );

  const comparison = {
    agents: agentIds,
    filesystemCompatibility: checkFilesystemCompatibility(agents),
    networkCompatibility: checkNetworkCompatibility(agents),
    toolsInCommon: findCommonTools(agents),
    toolsDifferent: findDifferentTools(agents),
  };

  return comparison;
}

function checkFilesystemCompatibility(agents: Agent[]): FilesystemCompatibility {
  const allMounts = agents.map(a => a.environment?.filesystem?.mounts ?? {});

  // Find shared mount names
  const mountNames = new Set(allMounts.flatMap(m => Object.keys(m)));
  const sharedMounts: SharedMountInfo[] = [];

  for (const name of mountNames) {
    const agentsWithMount = agents.filter(a =>
      a.environment?.filesystem?.mounts?.[name]
    );

    if (agentsWithMount.length > 1) {
      sharedMounts.push({
        name,
        agents: agentsWithMount.map(a => ({
          agentId: a.id,
          path: a.environment!.filesystem!.mounts![name].path
        }))
      });
    }
  }

  return {
    hasSharedFilesystem: sharedMounts.length > 0,
    sharedMounts,
    requiresFileTransfer: sharedMounts.length === 0
  };
}
```

#### 3. Cost-Optimized Batch Scheduling

A client schedules a batch of tasks across agents to minimize cost.

```typescript
async function scheduleBatch(tasks: Task[]): Promise<Schedule> {
  const agents = await client.agentsList({ filter: { states: ['active'] } });

  // Group agents by cost profile
  const byCoste = new Map<string, Agent[]>();
  for (const agent of agents.agents) {
    const cost = agent.environment?.resources?.costProfile ?? 'medium';
    if (!byCost.has(cost)) byCost.set(cost, []);
    byCost.get(cost)!.push(agent);
  }

  const schedule: Schedule = { assignments: [] };

  // Assign tasks to cheapest capable agents first
  for (const task of tasks) {
    for (const costLevel of ['free', 'low', 'medium', 'high', 'premium']) {
      const candidates = byCost.get(costLevel) ?? [];
      const capable = candidates.find(a => canHandle(a, task));

      if (capable) {
        schedule.assignments.push({ task, agent: capable.id, cost: costLevel });
        break;
      }
    }
  }

  return schedule;
}
```

#### 4. Health and Capacity Monitoring

A client monitors agent fleet health and capacity.

```typescript
class FleetMonitor {
  async getFleetStatus(): Promise<FleetStatus> {
    const agents = await this.client.agentsList();

    const status: FleetStatus = {
      total: agents.agents.length,
      byRegion: {},
      byIsolationLevel: {},
      totalCapacity: { cpuCores: 0, memoryGB: 0, gpuCount: 0 },
      networkCapabilities: { full: 0, restricted: 0, internal: 0, isolated: 0 }
    };

    for (const agent of agents.agents) {
      const env = agent.environment;
      if (!env) continue;

      // By region
      const region = env.cloud?.region ?? 'local';
      status.byRegion[region] = (status.byRegion[region] ?? 0) + 1;

      // By isolation
      const isolation = env.security?.isolation ?? 'unknown';
      status.byIsolationLevel[isolation] = (status.byIsolationLevel[isolation] ?? 0) + 1;

      // Aggregate capacity
      if (env.host?.cpuCount) status.totalCapacity.cpuCores += env.host.cpuCount;
      if (env.host?.memoryBytes) status.totalCapacity.memoryGB += env.host.memoryBytes / (1024**3);
      if (env.host?.gpu?.count) status.totalCapacity.gpuCount += env.host.gpu.count;

      // Network capabilities
      const connectivity = env.network?.connectivity ?? 'isolated';
      status.networkCapabilities[connectivity]++;
    }

    return status;
  }
}
```

#### 5. Debugging Failed Interactions

A client investigates why an agent-to-agent interaction failed.

```typescript
async function debugInteraction(fromAgentId: AgentId, toAgentId: AgentId, error: string) {
  const [fromAgent, toAgent] = await Promise.all([
    client.agentsGet({ agentId: fromAgentId }),
    client.agentsGet({ agentId: toAgentId })
  ]);

  const fromEnv = fromAgent.agent.environment;
  const toEnv = toAgent.agent.environment;

  const diagnosis: Diagnosis = { issues: [] };

  // Check network compatibility
  if (fromEnv?.network?.connectivity === 'isolated' || toEnv?.network?.connectivity === 'isolated') {
    diagnosis.issues.push({
      type: 'network',
      message: 'One or both agents have no network access',
      from: fromEnv?.network?.connectivity,
      to: toEnv?.network?.connectivity
    });
  }

  // Check if they're on different clouds/regions (latency issues)
  if (fromEnv?.cloud?.region && toEnv?.cloud?.region &&
      fromEnv.cloud.region !== toEnv.cloud.region) {
    diagnosis.issues.push({
      type: 'latency',
      message: `Cross-region communication: ${fromEnv.cloud.region} → ${toEnv.cloud.region}`,
      suggestion: 'Consider using agents in the same region for latency-sensitive operations'
    });
  }

  // Check filesystem assumptions
  if (error.includes('file not found') || error.includes('ENOENT')) {
    const sharedFs = checkFilesystemCompatibility([fromAgent.agent, toAgent.agent]);
    if (!sharedFs.hasSharedFilesystem) {
      diagnosis.issues.push({
        type: 'filesystem',
        message: 'Agents do not share a filesystem - file paths are not transferable',
        suggestion: 'Use file transfer via messages instead of path references'
      });
    }
  }

  return diagnosis;
}
```

---

### How Would This Information Be Made Visible to Agents?

#### Visibility Pattern 1: Query on Demand

Agents query other agents' environments when needed.

```typescript
// Agent queries a specific peer's environment
const peer = await client.agentsGet({ agentId: 'peer-agent-1' });
const peerEnv = peer.agent.environment;

// Agent lists all agents and filters by environment
const gpuAgents = await client.agentsList({
  filter: { states: ['active'] }
});
const withGPU = gpuAgents.agents.filter(a => a.environment?.host?.gpu?.count);
```

**Pros:** Simple, no extra state
**Cons:** Requires knowing which agents to query, multiple round trips

#### Visibility Pattern 2: Environment-Filtered Subscriptions

Agents subscribe to events from agents matching environment criteria.

```typescript
// Subscribe to events from agents in the same region
const myRegion = myAgent.environment?.cloud?.region;

await client.subscribe({
  filter: {
    eventTypes: ['agent_registered', 'agent_state_changed'],
    environmentMatch: {
      'cloud.region': myRegion ? [myRegion] : undefined,
      'network.connectivity': ['full', 'restricted']  // Only network-capable agents
    }
  }
});
```

**Pros:** Real-time updates, efficient filtering server-side
**Cons:** More complex subscription logic

#### Visibility Pattern 3: Environment Change Events

Agents receive notifications when relevant environments change.

```typescript
// Subscribe to environment changes
await client.subscribe({
  filter: {
    eventTypes: ['agent_environment_changed']
  }
});

// Handle environment changes
client.onEvent((event) => {
  if (event.type === 'agent_environment_changed') {
    const data = event.data as AgentEnvironmentChangedEventData;

    // React to changes that affect us
    if (data.changedFields.includes('network.connectivity')) {
      // A peer's network status changed - update our routing decisions
      updateRoutingTable(data.agentId, data.currentEnvironment);
    }

    if (data.changedFields.includes('filesystem.mounts')) {
      // Shared filesystem changed - invalidate cached paths
      invalidatePathCache(data.agentId);
    }
  }
});
```

#### Visibility Pattern 4: Environment Summary in Scope

Scopes can maintain aggregated environment information for their members.

```typescript
// When joining a scope, environment is summarized
interface ScopeEnvironmentSummary {
  /** Aggregated capabilities across all members */
  aggregateCapabilities: {
    hasGPU: boolean;
    hasNetworkAccess: boolean;
    totalMemoryBytes: number;
    regions: string[];
    tools: string[];  // Union of all installed tools
  };

  /** Members grouped by environment characteristic */
  membersByRegion: Record<string, AgentId[]>;
  membersByConnectivity: Record<NetworkConnectivity, AgentId[]>;

  /** Shared resources */
  sharedMounts: {
    name: string;
    members: AgentId[];
  }[];
}

// Agent can query scope-level environment summary
const scopeInfo = await client.scopesGet({ scopeId: 'my-scope' });
const envSummary = scopeInfo.scope.metadata?.environmentSummary as ScopeEnvironmentSummary;

// Quickly find who has GPU in this scope
const gpuPeers = envSummary.membersByCapability?.['gpu'] ?? [];
```

#### Visibility Pattern 5: Environment Diff on Agent Spawn

When spawning a child agent, parent receives environment comparison.

```typescript
// Parent spawns child in different environment
const spawnResult = await client.agentsSpawn({
  name: 'worker',
  role: 'processor',
  metadata: {
    requestedEnvironment: {
      // Hints for where to spawn
      preferGPU: true,
      minMemoryGB: 16
    }
  }
});

// Response includes environment diff
interface SpawnResponseWithEnvironment extends AgentsSpawnResponseResult {
  agent: Agent;  // Includes environment
  environmentDiff?: {
    /** Differences from parent's environment */
    filesystem: {
      sharedMounts: string[];  // Mounts both have
      parentOnly: string[];    // Parent has, child doesn't
      childOnly: string[];     // Child has, parent doesn't
    };
    network: {
      canCommunicateDirectly: boolean;
      latencyEstimateMs?: number;
    };
  };
}
```

#### Visibility Pattern 6: Agent Card / Well-Known Environment

Inspired by A2A's AgentCard, agents can expose a standardized environment summary.

```typescript
// Method: map/agents/environment
interface AgentEnvironmentRequestParams {
  agentId: AgentId;
  /** Which categories to include (empty = all visible) */
  include?: string[];
}

interface AgentEnvironmentResponseResult {
  agentId: AgentId;
  environment: AgentEnvironment;
  /** What's hidden due to visibility rules */
  redacted?: string[];
  /** When this info was last updated */
  updatedAt: Timestamp;
}

// Usage
const envInfo = await client.agentEnvironment({
  agentId: 'target-agent',
  include: ['os', 'tools', 'network']  // Only what I need
});
```

---

### Visibility Control

Environment information respects the existing MAP visibility and permission model.

```typescript
interface AgentEnvironmentVisibility {
  /**
   * Which environment categories are visible to different audiences.
   * Categories not listed are hidden from that audience.
   */
  visibility: {
    /** Visible to any agent that can see this agent */
    public?: EnvironmentCategory[];

    /** Visible only to parent/children */
    hierarchy?: EnvironmentCategory[];

    /** Visible only to same-scope members */
    scoped?: EnvironmentCategory[];

    /** Visible only to system/admin */
    system?: EnvironmentCategory[];
  };
}

type EnvironmentCategory =
  | 'host' | 'os' | 'process' | 'container' | 'cloud'
  | 'k8s' | 'filesystem' | 'network' | 'tools' | 'resources' | 'security';

// Example: An agent that exposes basic info publicly but restricts sensitive details
const myVisibility: AgentEnvironmentVisibility = {
  visibility: {
    public: ['os', 'tools'],  // Anyone can see OS and tools
    hierarchy: ['filesystem', 'network'],  // Parent/children see filesystem
    scoped: ['host', 'resources'],  // Scope members see capacity
    system: ['security', 'cloud', 'k8s']  // Only admin sees security/cloud details
  }
};
```

## Extension Points

### Vendor Extensions

Custom fields use `x-` prefix in the `extensions` field:

```typescript
const environment: AgentEnvironment = {
  schemaVersion: '1.0',
  os: { type: 'linux' },
  extensions: {
    'x-anthropic-sandbox': {
      sandboxId: 'sb-123',
      tier: 'premium',
      features: ['code-execution', 'network']
    },
    'x-internal-team': 'platform'
  }
};
```

### Custom Detectors

The SDK provides a detector interface for custom detection:

```typescript
interface EnvironmentDetector {
  /** Detector name */
  name: string;

  /** Categories this detector provides */
  categories: string[];

  /** Detect environment information */
  detect(): Promise<Partial<AgentEnvironment>>;
}

// Register custom detector
client.registerEnvironmentDetector({
  name: 'custom-cloud-detector',
  categories: ['cloud'],
  async detect() {
    const metadata = await fetchCloudMetadata();
    return {
      cloud: {
        provider: 'custom',
        region: metadata.region,
        instanceType: metadata.instanceType
      }
    };
  }
});
```

## Security Considerations

1. **Sensitive data filtering**: Environment detection should filter sensitive environment variables (API keys, tokens, passwords)

2. **Opt-in exposure**: Agents should explicitly opt-in to exposing environment information

3. **Visibility control**: Environment information should respect existing visibility rules

4. **Audit logging**: Changes to environment information should be logged

5. **Trust boundaries**: Environment information from untrusted agents should not be implicitly trusted

## Migration Path

1. **Phase 1**: Add types and optional `environment` field to Agent
2. **Phase 2**: Implement detection utilities in SDK
3. **Phase 3**: Add environment-based filtering to subscriptions
4. **Phase 4**: Add `map/environment/detect` and `map/environment/compare` methods

## Open Questions

1. Should environment information be mutable after registration, or require re-registration?
2. How should environment changes be propagated (events vs polling)?
3. Should there be a standard "environment compatibility" score?
4. How to handle environment detection in sandboxed environments where detection is restricted?
5. Should filesystem mount coordination be a separate, more detailed protocol?

## References

- [OpenTelemetry Resource Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/resource/)
- [Kubernetes Node Feature Discovery](https://kubernetes-sigs.github.io/node-feature-discovery/)
- [OCI Runtime Specification](https://github.com/opencontainers/runtime-spec)
- [AWS EC2 Instance Metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-metadata.html)
- [LSP Capabilities](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)
