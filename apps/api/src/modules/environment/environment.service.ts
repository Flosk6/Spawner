import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from "@nestjs/common";
import { PrismaService } from "../../common/prisma.service";
import type {
  Project,
  ProjectResource as PrismaProjectResource,
} from "@prisma/client";
import { Observable } from "rxjs";
import { MessageEvent } from "@nestjs/common";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  sanitizeShellArg,
  sanitizeGitRepo,
  sanitizeGitBranch,
  validateResourceName,
} from "@spawner/utils";
import type {
  EnvironmentStatus,
  ResourceType,
  SpawnerConfig,
} from "@spawner/types";
import { isGitResource, DEFAULT_EXPOSED_PORTS } from "@spawner/config";
import { EnvironmentLogsEmitter } from "../../common/environment-logs.emitter";
import { EnvVarsGenerator } from "../../common/env-vars.generator";
import { DockerService } from "../../common/docker.service";
import { GitKeysService } from "../git/git-keys.service";
import { StatsService } from "../stats/stats.service";
import * as yaml from "js-yaml";

const execAsync = promisify(exec);

type ResourceLimits = {
  cpu?: string;
  memory?: string;
  cpuReservation?: string;
  memoryReservation?: string;
};

type ProjectWithResources = Project & {
  resources: PrismaProjectResource[];
};

@Injectable()
export class EnvironmentService {
  constructor(
    private prisma: PrismaService,
    private logsEmitter: EnvironmentLogsEmitter,
    private dockerService: DockerService,
    private gitKeysService: GitKeysService,
    private statsService: StatsService
  ) {}

  async findAll() {
    return this.prisma.environment.findMany({
      include: {
        resources: true,
        project: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findByProject(projectId: number) {
    return this.prisma.environment.findMany({
      where: { projectId },
      include: {
        resources: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string) {
    const environment = await this.prisma.environment.findUnique({
      where: { id },
      include: {
        resources: true,
        project: {
          include: {
            resources: true,
          },
        },
      },
    });

    if (!environment) {
      throw new NotFoundException(`Environment with ID ${id} not found`);
    }

    return environment;
  }

  async createForProject(
    projectId: number,
    name: string,
    branches: Record<string, string>,
    localMode?: boolean
  ) {
    // Load project with resources
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { resources: true },
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    // Check for duplicate environment name
    const existing = await this.prisma.environment.findFirst({
      where: { name },
    });

    if (existing) {
      throw new ConflictException(
        `Environment with name "${name}" already exists`
      );
    }

    // Validate branches for git resources
    const gitResources = project.resources.filter((r) =>
      isGitResource(r.type as ResourceType)
    );
    for (const resource of gitResources) {
      if (!branches[resource.name]) {
        throw new ConflictException(
          `Branch for resource "${resource.name}" is required`
        );
      }
    }

    // Create environment record
    const envId = uuidv4();
    const environment = await this.prisma.environment.create({
      data: {
        id: envId,
        name,
        projectId,
        status: "creating" as EnvironmentStatus,
        configJson: JSON.stringify({ branches, localMode: localMode || false }),
      },
    });

    // Start async creation process
    this.createEnvironmentAsync(
      envId,
      project,
      name,
      branches,
      localMode || false
    ).catch(async (error) => {
      console.error(`Failed to create environment ${name}:`, error);
      this.logsEmitter.error(envId, `Failed: ${error.message}`);
      await this.prisma.environment.update({
        where: { id: envId },
        data: {
          status: "failed" as EnvironmentStatus,
        },
      });
    });

    return environment;
  }

  /**
   * Asynchronously creates a complete preview environment with all its resources.
   *
   * This orchestrates the complex multi-step process of environment provisioning:
   * 1. Creates isolated filesystem directory structure
   * 2. Clones/updates Git repositories for each service to specified branches
   * 3. Generates environment-specific configuration and secrets
   * 4. Builds Docker Compose configuration with proper networking and dependencies
   * 5. Starts all containers via Docker Compose
   * 6. Persists resource metadata to database
   *
   * Security: All git repositories, branches, and paths are sanitized before shell execution
   * to prevent command injection attacks. Uses dedicated SSH keys per repository.
   *
   * Progress: Emits real-time logs via WebSocket to allow UI to stream creation progress.
   * On failure, environment status is marked as 'failed' but record is preserved for debugging.
   *
   * @param envId - UUID of the environment record in database
   * @param project - Project configuration containing all resource definitions
   * @param envName - Human-readable environment name (e.g., "feature-auth-123")
   * @param branches - Map of resource names to their target Git branches
   * @param localMode - If true, exposes ports on localhost instead of using Traefik routing
   *
   * @throws Error if git clone fails, Docker Compose fails, or any filesystem operation fails
   * @private
   */
  private async createEnvironmentAsync(
    envId: string,
    project: ProjectWithResources,
    envName: string,
    branches: Record<string, string>,
    localMode: boolean
  ): Promise<void> {
    this.logsEmitter.clearLogs(envId);

    const log = (
      level: "info" | "success" | "warning" | "error",
      message: string
    ) => {
      console.log(`[${envName}] ${message}`);
      this.logsEmitter.emitLog(envId, level, message);
    };

    try {
      this.logsEmitter.emitLog(
        envId,
        "info",
        "Starting environment creation...",
        "init"
      );
      log("info", "Starting environment creation...");

      const envsPath = process.env.ENVS_PATH || "/opt/spawner/envs";
      const reposPath = process.env.REPOS_PATH || "/opt/spawner/repos";

      const envDir = path.join(envsPath, `${project.name}-${envName}`);

      log("info", `Creating environment directory: ${envDir}`);
      await fs.mkdir(envDir, { recursive: true });

      const gitResources = project.resources.filter((r) =>
        isGitResource(r.type as ResourceType)
      );

      this.logsEmitter.emitLog(
        envId,
        "info",
        "Cloning and updating git repositories...",
        "git"
      );
      for (const resource of gitResources) {
        const branch = branches[resource.name];
        const repoDir = path.join(reposPath, resource.name);

        const sanitizedRepo = sanitizeGitRepo(resource.gitRepo);
        const sanitizedBranch = sanitizeGitBranch(branch);
        const sanitizedRepoDir = sanitizeShellArg(repoDir);

        log(
          "info",
          `Processing git resource: ${resource.name} (branch: ${branch})`
        );

        const repoExists = await fs
          .access(repoDir)
          .then(() => true)
          .catch(() => false);

        if (!repoExists) {
          log("info", `Cloning repository for ${resource.name}...`);
          const repoKeyPath =
            this.gitKeysService.getKeyPathForRepo(sanitizedRepo);
          const sanitizedKeyPath = sanitizeShellArg(repoKeyPath);
          const sshCommand = `ssh -i ${sanitizedKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
          await execAsync(
            `GIT_SSH_COMMAND="${sshCommand}" git clone ${sanitizedRepo} ${sanitizedRepoDir}`
          );
        }

        log("info", `Checking out branch ${branch} for ${resource.name}...`);
        const repoKeyPath =
          this.gitKeysService.getKeyPathForRepo(sanitizedRepo);
        const sanitizedKeyPath = sanitizeShellArg(repoKeyPath);
        const sshCommand = `ssh -i ${sanitizedKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
        await execAsync(
          `cd ${sanitizedRepoDir} && GIT_SSH_COMMAND="${sshCommand}" git fetch origin && git checkout ${sanitizedBranch} && git reset --hard origin/${sanitizedBranch}`
        );
      }

      const environment = await this.prisma.environment.findUnique({
        where: { id: envId },
      });

      const resourcePorts: Record<string, number> = {};
      if (localMode) {
        let portCounter = 8000;
        for (const resource of project.resources) {
          if (resource.type !== "mysql-db") {
            resourcePorts[resource.name] = portCounter++;
          }
        }
      }

      const resourcesEnvVars: Record<string, Record<string, string>> = {};
      for (const resource of project.resources) {
        resourcesEnvVars[resource.name] = EnvVarsGenerator.generateForResource(
          resource,
          environment,
          project,
          project.resources,
          {},
          localMode,
          resourcePorts
        );
      }

      this.logsEmitter.emitLog(
        envId,
        "info",
        "Creating Docker resources...",
        "docker"
      );
      log("info", "Creating Docker network...");
      const networkName = `net-${envName}`;
      await this.dockerService.createNetwork(networkName);

      log("info", "Starting Docker containers...");
      await this.createContainersWithDockerode(
        project,
        envName,
        networkName,
        reposPath,
        resourcesEnvVars,
        localMode,
        resourcePorts,
        log
      );

      this.logsEmitter.emitLog(
        envId,
        "info",
        "Running health checks...",
        "health-check"
      );
      await this.runHealthChecks(project, envName, log);

      this.logsEmitter.emitLog(
        envId,
        "info",
        "Executing post-build commands...",
        "post-build"
      );
      await this.executePostBuildCommands(project, envName, log);

      log("info", "Creating environment resources...");
      for (const resource of project.resources) {
        await this.prisma.environmentResource.create({
          data: {
            id: `${envId}-${resource.name}`,
            environmentId: envId,
            resourceName: resource.name,
            resourceType: resource.type as ResourceType,
            url: this.generateResourceUrl(
              resource.name,
              resource.type as ResourceType,
              envName,
              project.baseDomain,
              localMode,
              resourcePorts
            ),
            branch: branches[resource.name] || null,
            isEntryPoint: resource.isEntryPoint || false,
          },
        });
      }

      await this.prisma.environment.update({
        where: { id: envId },
        data: {
          status: "running" as EnvironmentStatus,
        },
      });

      EnvVarsGenerator.clearSharedSecrets(envId);

      this.logsEmitter.emitLog(
        envId,
        "success",
        "Environment created successfully!",
        "complete"
      );
      log("success", "Environment created successfully!");
    } catch (error) {
      log("error", `Failed to create environment: ${error.message}`);
      await this.prisma.environment.update({
        where: { id: envId },
        data: {
          status: "failed" as EnvironmentStatus,
        },
      });
      throw error;
    }
  }

  private generateResourceUrl(
    resourceName: string,
    resourceType: ResourceType,
    envName: string,
    baseDomain: string,
    localMode?: boolean,
    resourcePorts?: Record<string, number>
  ): string {
    if (resourceType === "mysql-db") {
      return `mysql://${resourceName}-${envName}:3306`;
    }
    if (localMode && resourcePorts && resourcePorts[resourceName]) {
      return `http://localhost:${resourcePorts[resourceName]}`;
    }
    return `https://${resourceName}.${envName}.${baseDomain}`;
  }

  async delete(id: string): Promise<void> {
    const environment = await this.findOne(id);

    const envsPath = process.env.ENVS_PATH || "/opt/spawner/envs";
    const envDir = path.join(
      envsPath,
      `${environment.project.name}-${environment.name}`
    );
    const networkName = `net-${environment.name}`;

    const errors: string[] = [];

    const resourcesToClean =
      environment.resources.length > 0
        ? environment.resources.map((r) => ({
            name: r.resourceName,
            type: r.resourceType,
          }))
        : environment.project.resources.map((r) => ({
            name: r.name,
            type: r.type,
          }));

    console.log(`Starting deletion of environment: ${environment.name}`);
    console.log(
      `Resources to clean: ${resourcesToClean.map((r) => r.name).join(", ")}`
    );

    // Step 1: Stop all containers
    for (const resource of resourcesToClean) {
      const serviceName = `${resource.name}-${environment.name}`;
      try {
        console.log(`[1/5] Stopping container ${serviceName}...`);
        await this.dockerService.stopContainer(serviceName, 5);
      } catch (error) {
        console.error(`Failed to stop ${serviceName}:`, error.message);
        errors.push(`Stop ${serviceName}: ${error.message}`);
      }
    }

    // Step 2: Remove all containers
    for (const resource of resourcesToClean) {
      const serviceName = `${resource.name}-${environment.name}`;
      try {
        console.log(`[2/5] Removing container ${serviceName}...`);
        await this.dockerService.removeContainer(serviceName, true);
      } catch (error) {
        console.error(
          `Failed to remove container ${serviceName}:`,
          error.message
        );
        errors.push(`Remove ${serviceName}: ${error.message}`);
      }
    }

    // Wait a bit to ensure containers are fully removed before removing volumes
    console.log(`Waiting for containers to be fully removed...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Step 3: Remove all volumes (after containers are removed)
    for (const resource of resourcesToClean) {
      if (resource.type === "mysql-db") {
        const serviceName = `${resource.name}-${environment.name}`;
        const volumeName = `${serviceName}-data`;
        try {
          console.log(`[3/5] Removing volume ${volumeName}...`);
          await this.dockerService.removeVolume(volumeName);
          console.log(`Successfully removed volume ${volumeName}`);
        } catch (error) {
          console.error(
            `Failed to remove volume ${volumeName}:`,
            error.message
          );
          errors.push(`Remove volume ${volumeName}: ${error.message}`);
        }
      }
    }

    // Step 4: Remove all images
    for (const resource of resourcesToClean) {
      if (resource.type !== "mysql-db") {
        const imageTag = `spawner-${resource.name}:${environment.name}`;
        try {
          console.log(`[4/5] Removing Docker image ${imageTag}...`);
          await this.dockerService.removeImage(imageTag);
        } catch (error) {
          console.error(`Failed to remove image ${imageTag}:`, error.message);
          errors.push(`Remove image ${imageTag}: ${error.message}`);
        }
      }
    }

    // Step 5: Remove network
    try {
      console.log(`[5/5] Removing network ${networkName}...`);
      await this.dockerService.removeNetwork(networkName);
    } catch (error) {
      console.error(`Failed to remove network ${networkName}:`, error.message);
      errors.push(`Remove network: ${error.message}`);
    }

    // Step 6: Remove directory
    try {
      console.log(`Removing directory ${envDir}...`);
      await fs.rm(envDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to remove directory ${envDir}:`, error.message);
      errors.push(`Remove directory: ${error.message}`);
    }

    // Step 7: Delete from database
    await this.prisma.environment.delete({
      where: { id: environment.id },
    });

    if (errors.length > 0) {
      console.warn(
        `Environment ${environment.name} deleted with ${errors.length} warnings:`,
        errors
      );
      throw new Error(`Environment deleted with errors: ${errors.join("; ")}`);
    } else {
      console.log(`Environment ${environment.name} successfully deleted!`);
    }
  }

  async getLogs(id: string, resourceName: string): Promise<{ logs: string }> {
    const validatedResourceName = validateResourceName(resourceName);
    const environment = await this.findOne(id);

    const resource = environment.resources?.find(
      (r) => r.resourceName === validatedResourceName
    );
    if (!resource) {
      throw new NotFoundException(
        `Resource ${validatedResourceName} not found in environment`
      );
    }

    const serviceName = `${validatedResourceName}-${environment.name}`;

    try {
      const logs = await this.dockerService.getContainerLogs(serviceName, 500);
      return { logs };
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to fetch logs: ${error.message}`
      );
    }
  }

  async execCommand(
    id: string,
    resourceName: string,
    command: string
  ): Promise<{ output: string }> {
    const validatedResourceName = validateResourceName(resourceName);
    const environment = await this.findOne(id);

    const resource = environment.resources?.find(
      (r) => r.resourceName === validatedResourceName
    );
    if (!resource) {
      throw new NotFoundException(
        `Resource ${validatedResourceName} not found in environment`
      );
    }

    if (command.length > 500) {
      throw new Error("Command too long (max 500 characters)");
    }

    const serviceName = `${validatedResourceName}-${environment.name}`;

    try {
      const commandParts = command.split(" ");
      const result = await this.dockerService.execInContainer(
        serviceName,
        commandParts,
        30000
      );
      return { output: result.output };
    } catch (error) {
      return { output: error.message };
    }
  }

  async streamLogs(id: string, resourceName: string): Promise<{ url: string }> {
    return { url: `/api/environments/${id}/logs/${resourceName}` };
  }

  streamCreationLogs(environmentId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const handler = (log: any) => {
        subscriber.next({
          data: JSON.stringify(log),
        } as MessageEvent);
      };

      this.logsEmitter.on(`logs:${environmentId}`, handler);

      const existingLogs = this.logsEmitter.getLogs(environmentId);
      existingLogs.forEach((log) => {
        subscriber.next({
          data: JSON.stringify(log),
        } as MessageEvent);
      });

      return () => {
        this.logsEmitter.off(`logs:${environmentId}`, handler);
      };
    });
  }

  getBuildLogs(environmentId: string) {
    const logs = this.logsEmitter.getLogs(environmentId);
    return {
      environmentId,
      logs,
      count: logs.length,
    };
  }

  private async readSpawnerConfig(
    repoPath: string,
    log?: (
      level: "info" | "success" | "warning" | "error",
      message: string
    ) => void
  ): Promise<SpawnerConfig | null> {
    const configPath = path.join(repoPath, ".spawner", "config.json");

    try {
      const configContent = await fs.readFile(configPath, "utf8");
      const config = JSON.parse(configContent) as SpawnerConfig;

      if (log) {
        log(
          "success",
          `Loaded .spawner/config.json for ${path.basename(repoPath)}`
        );
      }

      return config;
    } catch (error) {
      if (error.code === "ENOENT") {
        if (log) {
          log(
            "info",
            `No .spawner/config.json found for ${path.basename(repoPath)}, using defaults`
          );
        }
        return null;
      }

      if (log) {
        log(
          "warning",
          `Failed to parse .spawner/config.json: ${error.message}, using defaults`
        );
      }
      return null;
    }
  }

  private async createContainersWithDockerode(
    project: ProjectWithResources,
    envName: string,
    networkName: string,
    reposPath: string,
    resourcesEnvVars: Record<string, Record<string, string>>,
    localMode: boolean,
    resourcePorts: Record<string, number>,
    log: (
      level: "info" | "success" | "warning" | "error",
      message: string
    ) => void
  ): Promise<void> {
    const dbResources = project.resources.filter((r) => r.type === "mysql-db");
    const apiResources = project.resources.filter(
      (r) => r.type === "laravel-api"
    );
    const frontResources = project.resources.filter(
      (r) => r.type === "nextjs-front"
    );

    for (const resource of dbResources) {
      await this.createMySQLContainer(
        resource,
        envName,
        networkName,
        resourcesEnvVars[resource.name],
        log
      );
    }

    for (const resource of apiResources) {
      await this.createLaravelContainer(
        resource,
        envName,
        networkName,
        reposPath,
        resourcesEnvVars[resource.name],
        project.baseDomain,
        localMode,
        resourcePorts,
        log
      );
    }

    for (const resource of frontResources) {
      await this.createNextJSContainer(
        resource,
        envName,
        networkName,
        reposPath,
        resourcesEnvVars[resource.name],
        project.baseDomain,
        localMode,
        resourcePorts,
        log
      );
    }
  }

  private async createMySQLContainer(
    resource: PrismaProjectResource,
    envName: string,
    networkName: string,
    envVars: Record<string, string>,
    log: (
      level: "info" | "success" | "warning" | "error",
      message: string
    ) => void
  ): Promise<void> {
    const serviceName = `${resource.name}-${envName}`;
    const volumeName = `${serviceName}-data`;

    const baseImages = (resource.baseImages as string[]) || ["mysql:8"];

    if (baseImages.length > 0) {
      log(
        "info",
        `Pre-pulling ${baseImages.length} base image(s) for MySQL...`
      );
      for (const baseImage of baseImages) {
        await this.dockerService.ensureImage(baseImage, (message) => {
          log("info", `[${baseImage}] ${message}`);
        });
      }
    }

    log("info", `Creating MySQL volume ${volumeName}...`);
    await this.dockerService.createVolume(volumeName);

    log("info", `Creating MySQL container ${serviceName}...`);
    const limits = resource.resourceLimits as ResourceLimits | null;
    await this.dockerService.createContainer({
      name: serviceName,
      image: "mysql:8",
      environment: envVars,
      networks: [networkName],
      volumes: [`${volumeName}:/var/lib/mysql`],
      resourceLimits: {
        cpus: limits?.cpu || "2",
        memory: limits?.memory || "1G",
        cpuReservation: limits?.cpuReservation || "0.25",
        memoryReservation: limits?.memoryReservation || "256M",
      },
    });

    await this.dockerService.startContainer(serviceName);
    log("success", `MySQL container ${serviceName} started`);

    log("info", `Waiting for MySQL ${serviceName} to be ready...`);
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  private async createLaravelContainer(
    resource: PrismaProjectResource,
    envName: string,
    networkName: string,
    reposPath: string,
    envVars: Record<string, string>,
    baseDomain: string,
    localMode: boolean,
    resourcePorts: Record<string, number>,
    log: (
      level: "info" | "success" | "warning" | "error",
      message: string
    ) => void
  ): Promise<void> {
    const serviceName = `${resource.name}-${envName}`;
    const buildContext = path.join(reposPath, resource.name);
    const hostname = `${resource.name}.${envName}.${baseDomain}`;

    const spawnerConfig = await this.readSpawnerConfig(buildContext, log);

    const baseImages =
      (resource.baseImages as string[]) || spawnerConfig?.baseImages || [];

    if (baseImages.length > 0) {
      log("info", `Pre-pulling ${baseImages.length} base image(s)...`);
      for (const baseImage of baseImages) {
        await this.dockerService.ensureImage(baseImage, (message) => {
          log("info", `[${baseImage}] ${message}`);
        });
      }
    }

    const dockerfilePath = spawnerConfig?.dockerfile || ".spawner/Dockerfile";
    const dockerfileFullPath = path.join(buildContext, dockerfilePath);
    const dockerfileExists = await fs
      .access(dockerfileFullPath)
      .then(() => true)
      .catch(() => false);

    const finalDockerfilePath = dockerfileExists ? dockerfilePath : undefined;

    if (dockerfileExists) {
      log("info", `Using Dockerfile: ${dockerfilePath}`);
    }

    log("info", `Building Laravel image for ${serviceName}...`);
    const imageTag = `spawner-${resource.name}:${envName}`;
    await this.dockerService.buildImage(
      buildContext,
      imageTag,
      (message) => {
        log("info", message);
      },
      finalDockerfilePath
    );

    log("success", `Build completed for ${serviceName}`);
    log("info", `Creating Laravel container ${serviceName}...`);

    const exposedPort =
      spawnerConfig?.exposedPort ||
      resource.exposedPort ||
      DEFAULT_EXPOSED_PORTS["laravel-api"];
    const ports =
      localMode && resourcePorts[resource.name]
        ? [`${resourcePorts[resource.name]}:${exposedPort}`]
        : [];

    const limits = (spawnerConfig?.resourceLimits ||
      resource.resourceLimits) as ResourceLimits | null;

    const containerNetworks = localMode
      ? [networkName]
      : [networkName, "traefik-public"];

    await this.dockerService.createContainer({
      name: serviceName,
      image: imageTag,
      environment: envVars,
      networks: containerNetworks,
      ports,
      labels: {
        "traefik.enable": "true",
        "traefik.docker.network": "traefik-public",
        [`traefik.http.routers.${serviceName}.rule`]: `Host(\`${hostname}\`)`,
        [`traefik.http.routers.${serviceName}.entrypoints`]: "websecure",
        [`traefik.http.routers.${serviceName}.tls.certresolver`]: "letsencrypt",
        [`traefik.http.services.${serviceName}.loadbalancer.server.port`]: `${exposedPort}`,
      },
      resourceLimits: {
        cpus: limits?.cpu || "2",
        memory: limits?.memory || "1G",
        cpuReservation: limits?.cpuReservation || "0.25",
        memoryReservation: limits?.memoryReservation || "256M",
      },
    });

    await this.dockerService.startContainer(serviceName);
    log("success", `Laravel container ${serviceName} started`);

    // Fix permissions for www-data user
    log("info", `Setting permissions for Laravel directories...`);
    try {
      await this.dockerService.execInContainer(serviceName, [
        "chown",
        "-R",
        "www-data:www-data",
        "/var/www/storage",
        "/var/www/bootstrap/cache",
        "/var/www/.config",
      ]);
      log("success", `Permissions set successfully`);
    } catch (error) {
      log("warning", `Could not set permissions: ${error.message}`);
    }
  }

  private async createNextJSContainer(
    resource: PrismaProjectResource,
    envName: string,
    networkName: string,
    reposPath: string,
    envVars: Record<string, string>,
    baseDomain: string,
    localMode: boolean,
    resourcePorts: Record<string, number>,
    log: (
      level: "info" | "success" | "warning" | "error",
      message: string
    ) => void
  ): Promise<void> {
    const serviceName = `${resource.name}-${envName}`;
    const buildContext = path.join(reposPath, resource.name);
    const hostname = `${resource.name}.${envName}.${baseDomain}`;

    log("info", `Generating .env file for Next.js build...`);
    const envFileContent = Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    await fs.writeFile(path.join(buildContext, ".env"), envFileContent, {
      mode: 0o600,
    });

    const spawnerConfig = await this.readSpawnerConfig(buildContext, log);

    const baseImages =
      (resource.baseImages as string[]) || spawnerConfig?.baseImages || [];

    if (baseImages.length > 0) {
      log("info", `Pre-pulling ${baseImages.length} base image(s)...`);
      for (const baseImage of baseImages) {
        await this.dockerService.ensureImage(baseImage, (message) => {
          log("info", `[${baseImage}] ${message}`);
        });
      }
    }

    const dockerfilePath = spawnerConfig?.dockerfile || ".spawner/Dockerfile";
    const dockerfileFullPath = path.join(buildContext, dockerfilePath);
    const dockerfileExists = await fs
      .access(dockerfileFullPath)
      .then(() => true)
      .catch(() => false);

    const finalDockerfilePath = dockerfileExists ? dockerfilePath : undefined;

    if (dockerfileExists) {
      log("info", `Using Dockerfile: ${dockerfilePath}`);
    }

    log("info", `Building Next.js image for ${serviceName}...`);
    const imageTag = `spawner-${resource.name}:${envName}`;
    await this.dockerService.buildImage(
      buildContext,
      imageTag,
      (message) => {
        log("info", message);
      },
      finalDockerfilePath
    );

    log("success", `Build completed for ${serviceName}`);
    log("info", `Creating Next.js container ${serviceName}...`);

    const exposedPort =
      spawnerConfig?.exposedPort ||
      resource.exposedPort ||
      DEFAULT_EXPOSED_PORTS["nextjs-front"];
    const ports =
      localMode && resourcePorts[resource.name]
        ? [`${resourcePorts[resource.name]}:${exposedPort}`]
        : [];

    const extraHosts = localMode ? ["host.docker.internal:host-gateway"] : [];

    const limits = (spawnerConfig?.resourceLimits ||
      resource.resourceLimits) as ResourceLimits | null;

    const containerNetworks = localMode
      ? [networkName]
      : [networkName, "traefik-public"];

    await this.dockerService.createContainer({
      name: serviceName,
      image: imageTag,
      environment: envVars,
      networks: containerNetworks,
      ports,
      extraHosts,
      labels: {
        "traefik.enable": "true",
        "traefik.docker.network": "traefik-public",
        [`traefik.http.routers.${serviceName}.rule`]: `Host(\`${hostname}\`)`,
        [`traefik.http.routers.${serviceName}.entrypoints`]: "websecure",
        [`traefik.http.routers.${serviceName}.tls.certresolver`]: "letsencrypt",
        [`traefik.http.services.${serviceName}.loadbalancer.server.port`]: `${exposedPort}`,
      },
      resourceLimits: {
        cpus: limits?.cpu || "2",
        memory: limits?.memory || "1G",
        cpuReservation: limits?.cpuReservation || "0.25",
        memoryReservation: limits?.memoryReservation || "256M",
      },
    });

    await this.dockerService.startContainer(serviceName);
    log("success", `Next.js container ${serviceName} started`);
  }

  private async runHealthChecks(
    project: ProjectWithResources,
    envName: string,
    log: (
      level: "info" | "success" | "warning" | "error",
      message: string
    ) => void
  ): Promise<void> {
    const dbResources = project.resources.filter((r) => r.type === "mysql-db");
    const apiResources = project.resources.filter(
      (r) => r.type === "laravel-api"
    );
    const frontResources = project.resources.filter(
      (r) => r.type === "nextjs-front"
    );

    for (const resource of dbResources) {
      const serviceName = `${resource.name}-${envName}`;
      log("info", `Health check for MySQL ${serviceName}...`);

      let retries = 30;
      let healthy = false;

      while (retries > 0 && !healthy) {
        try {
          const result = await this.dockerService.execInContainer(
            serviceName,
            ["mysqladmin", "ping", "-h", "localhost"],
            5000
          );

          if (result.exitCode === 0) {
            healthy = true;
            log("success", `MySQL ${serviceName} is healthy`);
          }
        } catch (error) {
          retries--;
          if (retries === 0) {
            log(
              "error",
              `MySQL ${serviceName} health check failed: ${error.message}`
            );
            throw new Error(`Health check failed for ${serviceName}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    for (const resource of [...apiResources, ...frontResources]) {
      const serviceName = `${resource.name}-${envName}`;
      const exposedPort =
        resource.exposedPort ||
        DEFAULT_EXPOSED_PORTS[resource.type as ResourceType];
      log("info", `Health check for ${resource.type} ${serviceName}...`);

      let retries = 30;
      let healthy = false;

      while (retries > 0 && !healthy) {
        try {
          const result = await this.dockerService.execInContainer(
            serviceName,
            [
              "sh",
              "-c",
              `curl -f http://localhost:${exposedPort}/api/health || curl -f http://localhost:${exposedPort}/health || curl -f http://localhost:${exposedPort}/ || exit 0`,
            ],
            5000
          );

          if (result.exitCode === 0) {
            healthy = true;
            log("success", `${resource.type} ${serviceName} is healthy`);
          }
        } catch (error) {
          retries--;
          if (retries === 0) {
            log(
              "warning",
              `${resource.type} ${serviceName} health check timed out, continuing anyway...`
            );
            healthy = true;
          } else {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      }
    }
  }

  private async executePostBuildCommands(
    project: ProjectWithResources,
    envName: string,
    log: (
      level: "info" | "success" | "warning" | "error",
      message: string
    ) => void
  ): Promise<void> {
    for (const resource of project.resources) {
      const commands = resource.postBuildCommands as string[];
      if (commands && Array.isArray(commands) && commands.length > 0) {
        const serviceName = `${resource.name}-${envName}`;
        log(
          "info",
          `Executing ${commands.length} post-build command(s) for ${serviceName}...`
        );

        for (const command of commands) {
          log("info", `Running: ${command}`);

          try {
            const commandParts = command.split(" ");
            const result = await this.dockerService.execInContainer(
              serviceName,
              commandParts,
              120000
            );

            if (result.exitCode === 0) {
              log("success", `Command completed: ${command}`);
              if (result.output) {
                log("info", result.output);
              }
            } else {
              log(
                "error",
                `Command failed with exit code ${result.exitCode}: ${command}`
              );
              if (result.output) {
                log("error", result.output);
              }
              throw new Error(`Post-build command failed: ${command}`);
            }
          } catch (error) {
            log(
              "error",
              `Failed to execute command "${command}": ${error.message}`
            );
            throw error;
          }
        }

        log("success", `All post-build commands completed for ${serviceName}`);
      }
    }
  }

  async getStats(environmentId: string) {
    const environment = await this.prisma.environment.findUnique({
      where: { id: environmentId },
    });

    if (!environment) {
      throw new NotFoundException(
        `Environment with ID ${environmentId} not found`
      );
    }

    const latestStats = await this.statsService.getLatestStats(environmentId);

    if (!latestStats) {
      return {
        cpuPercent: 0,
        memoryUsageGB: 0,
        memoryLimitGB: 0,
        containers: [],
        message: "No stats available yet. Stats are collected every minute.",
      };
    }

    return {
      cpuPercent: Number(latestStats.cpuPercent),
      memoryUsageGB: Number(latestStats.memoryUsageGB),
      memoryLimitGB: Number(latestStats.memoryLimitGB),
      containers: latestStats.containers,
      time: latestStats.time,
    };
  }

  async getStatsHistory(environmentId: string) {
    const environment = await this.prisma.environment.findUnique({
      where: { id: environmentId },
    });

    if (!environment) {
      throw new NotFoundException(
        `Environment with ID ${environmentId} not found`
      );
    }

    const oneHourAgo = new Date(Date.now() - 3600000);
    const history = await this.statsService.getStatsHistory(
      environmentId,
      oneHourAgo
    );

    return history.map((stat) => ({
      time: stat.time,
      cpuPercent: Number(stat.cpuPercent),
      memoryUsageGB: Number(stat.memoryUsageGB),
      memoryLimitGB: Number(stat.memoryLimitGB),
    }));
  }

  async pause(id: string) {
    const environment = await this.findOne(id);

    if (environment.status !== "running") {
      throw new ConflictException(
        `Cannot pause environment with status ${environment.status}. Only running environments can be paused.`
      );
    }

    const actionId = uuidv4();
    await this.prisma.environmentAction.create({
      data: {
        id: actionId,
        environmentId: id,
        action: "pause",
        status: "in_progress",
      },
    });

    try {
      for (const resource of environment.resources) {
        const containerName = `${resource.resourceName}-${environment.name}`;
        console.log(`Stopping container: ${containerName}`);
        await this.dockerService.stopContainer(containerName, 10);
      }

      await this.prisma.environment.update({
        where: { id },
        data: { status: "paused" },
      });

      await this.prisma.environmentAction.update({
        where: { id: actionId },
        data: {
          status: "completed",
          completedAt: new Date(),
        },
      });

      console.log(`Environment ${environment.name} paused successfully`);
      return this.findOne(id);
    } catch (error) {
      await this.prisma.environmentAction.update({
        where: { id: actionId },
        data: {
          status: "failed",
          completedAt: new Date(),
          metadata: { error: error.message },
        },
      });

      throw new InternalServerErrorException(
        `Failed to pause environment: ${error.message}`
      );
    }
  }

  async resume(id: string) {
    const environment = await this.findOne(id);

    if (environment.status !== "paused") {
      throw new ConflictException(
        `Cannot resume environment with status ${environment.status}. Only paused environments can be resumed.`
      );
    }

    const actionId = uuidv4();
    await this.prisma.environmentAction.create({
      data: {
        id: actionId,
        environmentId: id,
        action: "resume",
        status: "in_progress",
      },
    });

    try {
      for (const resource of environment.resources) {
        const containerName = `${resource.resourceName}-${environment.name}`;
        console.log(`Starting container: ${containerName}`);
        await this.dockerService.startContainer(containerName);
      }

      await this.prisma.environment.update({
        where: { id },
        data: { status: "running" },
      });

      await this.prisma.environmentAction.update({
        where: { id: actionId },
        data: {
          status: "completed",
          completedAt: new Date(),
        },
      });

      console.log(`Environment ${environment.name} resumed successfully`);
      return this.findOne(id);
    } catch (error) {
      await this.prisma.environmentAction.update({
        where: { id: actionId },
        data: {
          status: "failed",
          completedAt: new Date(),
          metadata: { error: error.message },
        },
      });

      throw new InternalServerErrorException(
        `Failed to resume environment: ${error.message}`
      );
    }
  }

  async restart(id: string) {
    const environment = await this.findOne(id);

    if (environment.status !== "running") {
      throw new ConflictException(
        `Cannot restart environment with status ${environment.status}. Only running environments can be restarted.`
      );
    }

    const actionId = uuidv4();
    await this.prisma.environmentAction.create({
      data: {
        id: actionId,
        environmentId: id,
        action: "restart",
        status: "in_progress",
      },
    });

    try {
      for (const resource of environment.resources) {
        const containerName = `${resource.resourceName}-${environment.name}`;
        console.log(`Restarting container: ${containerName}`);
        await this.dockerService.restartContainer(containerName, 10);
      }

      await this.prisma.environmentAction.update({
        where: { id: actionId },
        data: {
          status: "completed",
          completedAt: new Date(),
        },
      });

      console.log(`Environment ${environment.name} restarted successfully`);
      return this.findOne(id);
    } catch (error) {
      await this.prisma.environmentAction.update({
        where: { id: actionId },
        data: {
          status: "failed",
          completedAt: new Date(),
          metadata: { error: error.message },
        },
      });

      throw new InternalServerErrorException(
        `Failed to restart environment: ${error.message}`
      );
    }
  }

  async restartResource(id: string, resourceName: string) {
    const environment = await this.findOne(id);

    const resource = environment.resources.find(
      (r) => r.resourceName === resourceName
    );
    if (!resource) {
      throw new NotFoundException(
        `Resource ${resourceName} not found in environment ${environment.name}`
      );
    }

    const actionId = uuidv4();
    await this.prisma.environmentAction.create({
      data: {
        id: actionId,
        environmentId: id,
        action: "restart_resource",
        status: "in_progress",
        metadata: { resourceName },
      },
    });

    try {
      const containerName = `${resourceName}-${environment.name}`;
      console.log(`Restarting resource container: ${containerName}`);
      await this.dockerService.restartContainer(containerName, 10);

      await this.prisma.environmentAction.update({
        where: { id: actionId },
        data: {
          status: "completed",
          completedAt: new Date(),
        },
      });

      console.log(
        `Resource ${resourceName} in environment ${environment.name} restarted successfully`
      );
      return { success: true, message: "Resource restarted successfully" };
    } catch (error) {
      await this.prisma.environmentAction.update({
        where: { id: actionId },
        data: {
          status: "failed",
          completedAt: new Date(),
          metadata: { resourceName, error: error.message },
        },
      });

      throw new InternalServerErrorException(
        `Failed to restart resource ${resourceName}: ${error.message}`
      );
    }
  }

  async update(id: string, branches?: Record<string, string>) {
    const environment = await this.findOne(id);

    if (environment.status !== "running" && environment.status !== "paused") {
      throw new ConflictException(
        `Cannot update environment with status ${environment.status}. Only running or paused environments can be updated.`
      );
    }

    this.logsEmitter.clearLogs(id);

    const log = (
      level: "info" | "success" | "warning" | "error",
      message: string
    ) => {
      console.log(`[${environment.name}] ${message}`);
      this.logsEmitter.emitLog(id, level, message);
    };

    const actionId = uuidv4();
    await this.prisma.environmentAction.create({
      data: {
        id: actionId,
        environmentId: id,
        action: "update",
        status: "in_progress",
        metadata: branches ? { branches } : undefined,
      },
    });

    await this.prisma.environment.update({
      where: { id },
      data: { status: "updating" },
    });

    log("info", "Starting environment update...");

    const reposPath = process.env.REPOS_PATH || "/opt/spawner/repos";
    const errors: string[] = [];
    const commitSHAs: Record<string, string> = {};

    try {
      const gitResources = environment.resources.filter((r) =>
        isGitResource(r.resourceType as any)
      );

      for (const resource of gitResources) {
        const resourceName = resource.resourceName;
        const repoPath = path.join(reposPath, resourceName);
        const targetBranch = branches?.[resourceName] || resource.branch;

        // Find the corresponding project resource to get gitRepo
        const projectResource = environment.project?.resources?.find(
          (pr) => pr.name === resourceName
        );
        if (!projectResource?.gitRepo) {
          log(
            "warning",
            `No git repo found for ${resourceName}, skipping update`
          );
          continue;
        }

        // Get SSH key path for this specific repository
        const privateKeyPath = this.gitKeysService.getKeyPathForRepo(
          projectResource.gitRepo
        );
        const sanitizedKeyPath = sanitizeShellArg(privateKeyPath);
        const sshCommand = `ssh -i ${sanitizedKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;

        if (!targetBranch) {
          log(
            "warning",
            `No branch specified for ${resourceName}, skipping update`
          );
          continue;
        }

        log("info", `Updating ${resourceName} to branch ${targetBranch}`);

        try {
          const { stdout: currentSHA } = await execAsync(
            `cd "${sanitizeShellArg(repoPath)}" && git rev-parse HEAD`
          );
          commitSHAs[resourceName] = currentSHA.trim();

          const sanitizedBranch = sanitizeGitBranch(targetBranch);

          await execAsync(
            `cd "${sanitizeShellArg(repoPath)}" && GIT_SSH_COMMAND="${sshCommand}" git fetch origin`
          );
          await execAsync(
            `cd "${sanitizeShellArg(repoPath)}" && git checkout ${sanitizedBranch}`
          );
          await execAsync(
            `cd "${sanitizeShellArg(repoPath)}" && GIT_SSH_COMMAND="${sshCommand}" git reset --hard origin/${sanitizedBranch}`
          );

          log("success", `Git update successful for ${resourceName}`);
        } catch (gitError) {
          log(
            "error",
            `Git update failed for ${resourceName}: ${gitError.message}`
          );
          errors.push(
            `Git update failed for ${resourceName}: ${gitError.message}`
          );

          if (commitSHAs[resourceName]) {
            try {
              await execAsync(
                `cd "${sanitizeShellArg(repoPath)}" && git reset --hard ${commitSHAs[resourceName]}`
              );
              log("info", `Rolled back ${resourceName} to previous commit`);
            } catch (rollbackError) {
              log(
                "error",
                `Failed to rollback ${resourceName}: ${rollbackError.message}`
              );
            }
          }
          throw gitError;
        }
      }

      log("info", "Git updates completed, starting image rebuild...");

      for (const resource of gitResources) {
        const resourceName = resource.resourceName;
        const repoPath = path.join(reposPath, resourceName);
        const imageTag = `spawner-${resourceName}:${environment.name}`;

        log("info", `Rebuilding image ${imageTag}`);

        try {
          // Check for .spawner.yml config
          let dockerfilePath: string | undefined;
          const spawnerConfigPath = path.join(repoPath, ".spawner.yml");
          try {
            const configContent = await fs.readFile(spawnerConfigPath, "utf-8");
            const spawnerConfig = yaml.load(configContent) as SpawnerConfig;
            dockerfilePath = spawnerConfig?.dockerfile || ".spawner/Dockerfile";
          } catch {
            dockerfilePath = ".spawner/Dockerfile";
          }

          // Check if custom Dockerfile exists
          const dockerfileFullPath = path.join(repoPath, dockerfilePath);
          const dockerfileExists = await fs
            .access(dockerfileFullPath)
            .then(() => true)
            .catch(() => false);

          const finalDockerfilePath = dockerfileExists
            ? dockerfilePath
            : undefined;

          if (dockerfileExists) {
            log("info", `Using Dockerfile: ${dockerfilePath}`);
          } else {
            log("info", `No custom Dockerfile found, using default build`);
          }

          await this.dockerService.buildImage(
            repoPath,
            imageTag,
            (msg) => {
              log("info", `Build progress [${resourceName}]: ${msg}`);
            },
            finalDockerfilePath
          );
          log("success", `Image rebuild successful for ${resourceName}`);
        } catch (buildError) {
          log(
            "error",
            `Image rebuild failed for ${resourceName}: ${buildError.message}`
          );
          errors.push(
            `Image rebuild failed for ${resourceName}: ${buildError.message}`
          );
          throw buildError;
        }
      }

      log("info", "All images rebuilt successfully, restarting containers...");

      for (const resource of gitResources) {
        const containerName = `${resource.resourceName}-${environment.name}`;
        log("info", `Restarting container ${containerName}`);

        try {
          await this.dockerService.restartContainer(containerName, 15);
          log(
            "success",
            `Container restart successful for ${resource.resourceName}`
          );
        } catch (restartError) {
          log(
            "error",
            `Container restart failed for ${resource.resourceName}: ${restartError.message}`
          );
          errors.push(
            `Container restart failed for ${resource.resourceName}: ${restartError.message}`
          );
          throw restartError;
        }
      }

      if (branches) {
        for (const resource of gitResources) {
          const newBranch = branches[resource.resourceName];
          if (newBranch && newBranch !== resource.branch) {
            await this.prisma.environmentResource.update({
              where: { id: resource.id },
              data: { branch: newBranch },
            });
          }
        }

        const config = JSON.parse(environment.configJson);
        config.branches = {
          ...config.branches,
          ...branches,
        };

        await this.prisma.environment.update({
          where: { id },
          data: { configJson: JSON.stringify(config) },
        });
      }

      await this.prisma.environment.update({
        where: { id },
        data: { status: "running" },
      });

      await this.prisma.environmentAction.update({
        where: { id: actionId },
        data: {
          status: "completed",
          completedAt: new Date(),
        },
      });

      log("success", `Environment ${environment.name} updated successfully`);
      return this.findOne(id);
    } catch (error) {
      // Restore environment to running or paused state (whatever it was before)
      const previousStatus = environment.status;
      await this.prisma.environment.update({
        where: { id },
        data: { status: previousStatus },
      });

      await this.prisma.environmentAction.update({
        where: { id: actionId },
        data: {
          status: "failed",
          completedAt: new Date(),
          metadata: {
            branches,
            errors,
            error: error.message,
          },
        },
      });

      log(
        "error",
        `Environment ${environment.name} update failed: ${error.message}`
      );
      throw new InternalServerErrorException(
        `Failed to update environment: ${error.message}${errors.length > 0 ? `. Errors: ${errors.join(", ")}` : ""}`
      );
    }
  }
}
