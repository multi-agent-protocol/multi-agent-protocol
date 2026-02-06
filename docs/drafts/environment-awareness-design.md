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

## Schema Design

### Top-Level Structure

```typescript
/**
 * Compute environment information for an agent.
 * Describes the runtime context where the agent executes.
 */
interface AgentEnvironment {
  /** Schema version for evolution (e.g., "1.0") */
  schemaVersion: string;

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

  /** Vendor/custom extensions (x-* prefix) */
  extensions?: Record<string, unknown>;
}
```

### Host Information

```typescript
/**
 * Information about the host machine.
 * Follows OpenTelemetry semantic conventions for host.*.
 */
interface HostInfo {
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
    /** Number of GPUs */
    count?: number;
    /** GPU model names */
    models?: string[];
    /** Total GPU memory in bytes */
    memoryBytes?: number;
  };
}
```

### Operating System Information

```typescript
/**
 * Operating system information.
 * Follows OpenTelemetry semantic conventions for os.*.
 */
interface OSInfo {
  /** OS type (e.g., "linux", "darwin", "windows") */
  type: string;

  /** OS name (e.g., "Ubuntu", "macOS", "Windows 11") */
  name?: string;

  /** OS version (e.g., "22.04", "14.0", "10.0.22621") */
  version?: string;

  /** Full OS description */
  description?: string;

  /** Kernel version */
  kernelVersion?: string;
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
}
```

### Cloud Provider Information

```typescript
/**
 * Cloud provider information.
 * Follows OpenTelemetry semantic conventions for cloud.*.
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
  cwd: string;

  /** Home directory */
  homeDir?: string;

  /** Temp directory */
  tempDir?: string;

  /**
   * Mount points relevant to the agent's work.
   * Maps logical names to paths for cross-agent coordination.
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
}

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
}

interface WorkspaceInfo {
  /** Workspace root path */
  root: string;

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
   * Network connectivity level.
   * - "full": Full internet access
   * - "restricted": Limited outbound (e.g., allowlist)
   * - "internal": Only internal/private network
   * - "isolated": No network access
   */
  connectivity?: 'full' | 'restricted' | 'internal' | 'isolated';

  /** Hostname as seen on the network */
  hostname?: string;

  /** Primary IP addresses */
  addresses?: NetworkAddress[];

  /** DNS servers */
  dnsServers?: string[];

  /** HTTP/HTTPS proxy URL (if configured) */
  httpProxy?: string;

  /** Domains/hosts that bypass the proxy */
  noProxy?: string[];

  /** VPN/mesh network membership */
  meshNetworks?: string[];

  /**
   * Firewall/security group rules affecting this agent.
   * Simplified representation of what's allowed.
   */
  allowedOutbound?: NetworkRule[];

  /** Allowed inbound connections */
  allowedInbound?: NetworkRule[];
}

interface NetworkAddress {
  /** IP address */
  ip: string;

  /** Address type ("ipv4" | "ipv6") */
  type: 'ipv4' | 'ipv6';

  /** Whether this is a public/external address */
  public?: boolean;

  /** Network interface name */
  interface?: string;
}

interface NetworkRule {
  /** Protocol (e.g., "tcp", "udp", "icmp", "*") */
  protocol: string;

  /** Port or port range (e.g., "443", "8000-9000", "*") */
  ports: string;

  /** CIDR or hostname pattern */
  destination: string;
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
   * Installed tools/executables with versions.
   * Key is tool name, value is version or ToolDetail.
   */
  installed?: Record<string, string | ToolDetail>;

  /** Shell available (e.g., "bash", "zsh", "sh", "powershell") */
  shell?: string;

  /** Package managers available */
  packageManagers?: string[];

  /**
   * Language runtimes available.
   * Maps language to version(s).
   */
  runtimes?: Record<string, string | string[]>;

  /** Whether the agent can install new tools */
  canInstall?: boolean;
}

interface ToolDetail {
  /** Tool version */
  version: string;

  /** Path to the tool executable */
  path?: string;

  /** Additional tool metadata */
  metadata?: Record<string, unknown>;
}
```

### Resource Information

```typescript
/**
 * Resource limits and constraints.
 * Describes what resources the agent can use.
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

  /** Cost profile for resource usage */
  costProfile?: 'free' | 'low' | 'medium' | 'high' | 'premium';
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
   * Isolation level.
   * - "none": No isolation (bare metal, same user)
   * - "process": Process-level isolation
   * - "container": Container isolation
   * - "vm": Virtual machine isolation
   * - "hardware": Hardware-level isolation (SGX, TDX)
   */
  isolation?: 'none' | 'process' | 'container' | 'vm' | 'hardware';

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
}
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
