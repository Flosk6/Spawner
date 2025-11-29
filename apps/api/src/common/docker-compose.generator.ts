import { DEFAULT_RESOURCE_LIMITS, DEFAULT_EXPOSED_PORTS } from "@spawner/config";
import type { ResourceType } from "@spawner/types";
import type { ProjectResource } from "@prisma/client";

export interface DockerComposeService {
  image?: string;
  build?: {
    context: string;
  };
  environment?: Record<string, string>;
  env_file?: string[];
  depends_on?: string[];
  labels?: string[];
  networks: string[];
  volumes?: string[];
  ports?: string[];
  extra_hosts?: string[];
  deploy?: {
    resources: {
      limits: {
        cpus: string;
        memory: string;
      };
      reservations?: {
        cpus: string;
        memory: string;
      };
    };
  };
}

export interface DockerComposeConfig {
  version: string;
  networks: Record<string, {}>;
  services: Record<string, DockerComposeService>;
  volumes?: Record<string, {}>;
}

export class DockerComposeGenerator {
  private portCounter = 8000;

  constructor(
    private readonly envName: string,
    private readonly baseDomain: string,
    private readonly resources: ProjectResource[],
    private readonly branches: Record<string, string>,
    private readonly reposPath: string,
    private readonly resourcesEnvVars?: Record<string, Record<string, string>>,
    private readonly localMode?: boolean
  ) {}

  private getResourceLimits(resource: ProjectResource): {
    limits: { cpus: string; memory: string };
    reservations: { cpus: string; memory: string };
  } {
    const defaults = DEFAULT_RESOURCE_LIMITS[resource.type as ResourceType];
    const custom = resource.resourceLimits as {
      cpu?: string;
      memory?: string;
      cpuReservation?: string;
      memoryReservation?: string;
    } | null;

    return {
      limits: {
        cpus: custom?.cpu || defaults.cpu,
        memory: custom?.memory || defaults.memory,
      },
      reservations: {
        cpus: custom?.cpuReservation || defaults.cpuReservation,
        memory: custom?.memoryReservation || defaults.memoryReservation,
      },
    };
  }

  generate(): string {
    const config: DockerComposeConfig = {
      version: "3.9",
      networks: {
        [`net-${this.envName}`]: {},
      },
      services: {},
      volumes: {},
    };

    // Generate services for each resource
    for (const resource of this.resources) {
      const serviceName = `${resource.name}-${this.envName}`;
      const networkName = `net-${this.envName}`;

      if (resource.type === "mysql-db") {
        config.services[serviceName] = this.generateMySQLService(
          resource,
          networkName
        );
        config.volumes[`${serviceName}-data`] = {};
      } else if (resource.type === "laravel-api") {
        config.services[serviceName] = this.generateLaravelService(
          resource,
          networkName
        );
      } else if (resource.type === "nextjs-front") {
        config.services[serviceName] = this.generateNextJSService(
          resource,
          networkName
        );
      }
    }

    return this.stringifyYAML(config);
  }

  private generateMySQLService(
    resource: ProjectResource,
    networkName: string
  ): DockerComposeService {
    const serviceName = `${resource.name}-${this.envName}`;
    const dbName = `${resource.name.replace(/-/g, "_")}_${this.envName.replace(/-/g, "_")}`;

    const environment = this.resourcesEnvVars?.[resource.name] || {
      MYSQL_DATABASE: dbName,
      MYSQL_USER: `${resource.name}_user`,
      MYSQL_PASSWORD: `${resource.name}_password`,
      MYSQL_ROOT_PASSWORD: "root_password",
    };

    const resourceLimits = this.getResourceLimits(resource);

    return {
      image: "mysql:8",
      environment,
      volumes: [`${serviceName}-data:/var/lib/mysql`],
      networks: [networkName],
      deploy: {
        resources: resourceLimits,
      },
    };
  }

  private generateLaravelService(
    resource: ProjectResource,
    networkName: string
  ): DockerComposeService {
    const serviceName = `${resource.name}-${this.envName}`;
    const dbResource = this.resources.find(
      (r) => r.id === resource.dbResourceId
    );

    if (!dbResource) {
      throw new Error(`Database resource not found for ${resource.name}`);
    }

    const dbServiceName = `${dbResource.name}-${this.envName}`;
    const dbName = `${dbResource.name.replace(/-/g, "_")}_${this.envName.replace(/-/g, "_")}`;

    const hostname = `${resource.name}.${this.envName}.${this.baseDomain}`;
    const exposedPort = resource.exposedPort || DEFAULT_EXPOSED_PORTS['laravel-api'];

    // Use pre-generated env vars if available, otherwise use defaults
    const environment = this.resourcesEnvVars?.[resource.name] || {
      DB_HOST: dbServiceName,
      DB_DATABASE: dbName,
      DB_USERNAME: `${dbResource.name}_user`,
      DB_PASSWORD: `${dbResource.name}_password`,
      APP_ENV: "local",
      APP_DEBUG: "true",
      APP_URL: `https://${hostname}`,
    };

    const resourceLimits = this.getResourceLimits(resource);

    const service: DockerComposeService = {
      build: {
        context: `${this.reposPath}/${resource.name}`,
      },
      environment,
      depends_on: [dbServiceName],
      labels: [
        "traefik.enable=true",
        `traefik.http.routers.${serviceName}.rule=Host(\`${hostname}\`)`,
        `traefik.http.services.${serviceName}.loadbalancer.server.port=${exposedPort}`,
      ],
      networks: [networkName],
      deploy: {
        resources: resourceLimits,
      },
    };

    // Add port mapping in local mode
    if (this.localMode) {
      const hostPort = this.getNextPort();
      service.ports = [`${hostPort}:${exposedPort}`];
    }

    return service;
  }

  private getNextPort(): number {
    return this.portCounter++;
  }

  private generateNextJSService(
    resource: ProjectResource,
    networkName: string
  ): DockerComposeService {
    const serviceName = `${resource.name}-${this.envName}`;
    const apiResource = this.resources.find(
      (r) => r.id === resource.apiResourceId
    );

    if (!apiResource) {
      throw new Error(`API resource not found for ${resource.name}`);
    }

    const apiHostname = `${apiResource.name}.${this.envName}.${this.baseDomain}`;
    const hostname = `${resource.name}.${this.envName}.${this.baseDomain}`;
    const exposedPort = resource.exposedPort || DEFAULT_EXPOSED_PORTS['nextjs-front'];

    // Use pre-generated env vars if available, otherwise use defaults
    const environment = this.resourcesEnvVars?.[resource.name] || {
      NEXT_PUBLIC_API_URL: `https://${apiHostname}`,
      NODE_ENV: "production",
    };

    const resourceLimits = this.getResourceLimits(resource);

    const service: DockerComposeService = {
      build: {
        context: `${this.reposPath}/${resource.name}`,
      },
      environment,
      labels: [
        "traefik.enable=true",
        `traefik.http.routers.${serviceName}.rule=Host(\`${hostname}\`)`,
        `traefik.http.services.${serviceName}.loadbalancer.server.port=${exposedPort}`,
      ],
      networks: [networkName],
      deploy: {
        resources: resourceLimits,
      },
    };

    // Add port mapping in local mode
    if (this.localMode) {
      const hostPort = this.getNextPort();
      service.ports = [`${hostPort}:${exposedPort}`];
      // Add host.docker.internal mapping for container to access host
      service.extra_hosts = ["host.docker.internal:host-gateway"];
    }

    return service;
  }

  /**
   * Escape a value for safe YAML output
   * - If value contains special chars or starts/ends with quotes, use double quotes and escape inner quotes
   * - Otherwise use as-is
   */
  private escapeYAMLValue(value: string): string {
    // If value is empty, return empty quotes
    if (!value) {
      return '""';
    }

    // Check if value needs quoting (contains special YAML characters or quotes)
    const needsQuoting =
      /[:\{\}\[\],&*#?|\-<>=!%@`"']/.test(value) ||
      value.startsWith(" ") ||
      value.endsWith(" ") ||
      value.includes("\n");

    if (needsQuoting) {
      // Escape any double quotes in the value and wrap in double quotes
      const escaped = value.replace(/"/g, '\\"');
      return `"${escaped}"`;
    }

    // Safe to use without quotes
    return `"${value}"`;
  }

  private stringifyYAML(config: DockerComposeConfig): string {
    // Simple YAML stringification
    let yaml = `version: "${config.version}"\n\n`;

    // Networks
    yaml += "networks:\n";
    for (const network of Object.keys(config.networks)) {
      yaml += `  ${network}: {}\n`;
    }
    yaml += "\n";

    // Services
    yaml += "services:\n";
    for (const [serviceName, service] of Object.entries(config.services)) {
      yaml += `  ${serviceName}:\n`;

      if (service.image) {
        yaml += `    image: ${service.image}\n`;
      }

      if (service.build) {
        yaml += `    build:\n`;
        yaml += `      context: ${service.build.context}\n`;
      }

      if (service.environment) {
        yaml += `    environment:\n`;
        for (const [key, value] of Object.entries(service.environment)) {
          // Escape the value properly for YAML
          const escapedValue = this.escapeYAMLValue(value);
          yaml += `      ${key}: ${escapedValue}\n`;
        }
      }

      if (service.depends_on && service.depends_on.length > 0) {
        yaml += `    depends_on:\n`;
        for (const dep of service.depends_on) {
          yaml += `      - ${dep}\n`;
        }
      }

      if (service.volumes && service.volumes.length > 0) {
        yaml += `    volumes:\n`;
        for (const vol of service.volumes) {
          yaml += `      - ${vol}\n`;
        }
      }

      if (service.ports && service.ports.length > 0) {
        yaml += `    ports:\n`;
        for (const port of service.ports) {
          yaml += `      - "${port}"\n`;
        }
      }

      if (service.labels && service.labels.length > 0) {
        yaml += `    labels:\n`;
        for (const label of service.labels) {
          yaml += `      - "${label}"\n`;
        }
      }

      if (service.networks && service.networks.length > 0) {
        yaml += `    networks:\n`;
        for (const net of service.networks) {
          yaml += `      - ${net}\n`;
        }
      }

      yaml += "\n";
    }

    // Volumes
    if (config.volumes && Object.keys(config.volumes).length > 0) {
      yaml += "volumes:\n";
      for (const volume of Object.keys(config.volumes)) {
        yaml += `  ${volume}: {}\n`;
      }
    }

    return yaml;
  }
}
