import * as crypto from "crypto";
import type { Project, ProjectResource, Environment } from "@prisma/client";

/**
 * Service to generate complete environment variables for a resource
 * Combines static variables with auto-generated ones
 */
export class EnvVarsGenerator {
  // Store shared secrets per environment (like DB passwords)
  private static sharedSecrets: Map<string, Record<string, string>> = new Map();

  /**
   * Generate complete environment variables for a resource
   * @param resource - The resource to generate vars for
   * @param environment - The environment being created
   * @param project - The project containing the resource
   * @param allResources - All resources in the project (for lookups)
   * @param envVarsOverride - Optional overrides for this specific environment
   * @param localMode - Whether this is a local development environment
   * @param resourcePorts - Port mapping for local mode (resource name -> port)
   * @returns Complete environment variables object
   */
  static generateForResource(
    resource: ProjectResource,
    environment: Environment,
    project: Project,
    allResources: ProjectResource[],
    envVarsOverride?: Record<string, string>,
    localMode?: boolean,
    resourcePorts?: Record<string, number>
  ): Record<string, string> {
    const envVars: Record<string, string> = {};

    // 1. Start with static variables from the resource
    Object.assign(envVars, resource.staticEnvVars);

    // 2. Add auto-generated variables based on resource type
    if (resource.type === "laravel-api") {
      this.addLaravelVars(
        envVars,
        resource,
        environment,
        project,
        localMode,
        resourcePorts
      );
    } else if (resource.type === "nextjs-front") {
      this.addNextJsVars(envVars);
    } else if (resource.type === "mysql-db") {
      this.addMySQLVars(envVars, resource, environment);
    }

    // 3. Apply overrides if present
    if (envVarsOverride) {
      Object.assign(envVars, envVarsOverride);
    }

    // 4. Resolve templates in all variables
    const resolvedVars = this.resolveTemplates(
      envVars,
      resource,
      environment,
      project,
      allResources,
      localMode,
      resourcePorts
    );

    return resolvedVars;
  }

  /**
   * Resolve template placeholders in environment variables
   * Supports: {{resource.NAME.property}}, {{self.property}}, {{env.property}}, {{project.property}}
   */
  private static resolveTemplates(
    envVars: Record<string, string>,
    resource: ProjectResource,
    environment: Environment,
    project: Project,
    allResources: ProjectResource[],
    localMode?: boolean,
    resourcePorts?: Record<string, number>
  ): Record<string, string> {
    const resolved: Record<string, string> = {};

    for (const [key, value] of Object.entries(envVars)) {
      if (typeof value !== "string") {
        resolved[key] = value;
        continue;
      }

      // Find all {{...}} patterns
      let resolvedValue = value;
      const templateRegex = /\{\{([^}]+)\}\}/g;
      let match;

      while ((match = templateRegex.exec(value)) !== null) {
        const placeholder = match[0]; // {{resource.my-api.url}}
        const expression = match[1].trim(); // resource.my-api.url
        const parts = expression.split(".");

        let replacementValue = "";

        if (parts[0] === "self") {
          // {{self.url}}, {{self.name}}, etc.
          replacementValue = this.resolveSelfProperty(
            parts[1],
            resource,
            environment,
            project,
            localMode,
            resourcePorts
          );
        } else if (parts[0] === "resource" && parts.length >= 3) {
          // {{resource.my-api.url}} or {{resource.my-api.url.internal}}

          // Check if it's url.internal first
          if (
            parts.length >= 4 &&
            parts[parts.length - 2] === "url" &&
            parts[parts.length - 1] === "internal"
          ) {
            // Extract resource name without url.internal
            const resourceName = parts.slice(1, -2).join(".");
            const targetResource = allResources.find(
              (r) => r.name === resourceName
            );
            if (targetResource) {
              replacementValue = this.getResourceInternalUrl(
                targetResource,
                environment,
                project,
                localMode,
                resourcePorts
              );
            } else {
              console.warn(
                `Template warning: Resource "${resourceName}" not found for url.internal`
              );
            }
          } else {
            // Normal property like {{resource.my-api.url}}
            const targetResourceName = parts.slice(1, -1).join("."); // Handle names with dots
            const property = parts[parts.length - 1];
            const targetResource = allResources.find(
              (r) => r.name === targetResourceName
            );
            if (targetResource) {
              replacementValue = this.resolveResourceProperty(
                property,
                targetResource,
                environment,
                project,
                localMode,
                resourcePorts
              );
            } else {
              console.warn(
                `Template warning: Resource "${targetResourceName}" not found`
              );
            }
          }
        } else if (parts[0] === "env") {
          // {{env.name}}, {{env.id}}, etc.
          replacementValue = this.resolveEnvProperty(parts[1], environment);
        } else if (parts[0] === "project") {
          // {{project.baseDomain}}, {{project.name}}, etc.
          replacementValue = this.resolveProjectProperty(parts[1], project);
        }

        resolvedValue = resolvedValue.replace(placeholder, replacementValue);
      }

      resolved[key] = resolvedValue;
    }

    return resolved;
  }

  private static resolveSelfProperty(
    property: string,
    resource: ProjectResource,
    environment: Environment,
    project: Project,
    localMode?: boolean,
    resourcePorts?: Record<string, number>
  ): string {
    if (property === "url") {
      return this.getResourceUrl(
        resource,
        environment,
        project,
        localMode,
        resourcePorts
      );
    } else if (property === "name") {
      return resource.name;
    } else if (property === "host") {
      return this.getResourceHost(resource, environment, project, localMode);
    }
    return "";
  }

  private static resolveResourceProperty(
    property: string,
    resource: ProjectResource,
    environment: Environment,
    project: Project,
    localMode?: boolean,
    resourcePorts?: Record<string, number>
  ): string {
    if (property === "url") {
      return this.getResourceUrl(
        resource,
        environment,
        project,
        localMode,
        resourcePorts
      );
    } else if (property === "name") {
      return resource.name;
    } else if (property === "host") {
      return this.getResourceHost(resource, environment, project, localMode);
    } else if (property === "port") {
      if (resource.type === "mysql-db") return "3306";
      return "";
    } else if (property === "database") {
      if (resource.type === "mysql-db") {
        return resource.name.replace("-db", "");
      }
    } else if (property === "username" || property === "user") {
      if (resource.type === "mysql-db") {
        return `${resource.name.replace("-db", "")}_user`;
      }
    } else if (property === "password") {
      if (resource.type === "mysql-db") {
        const secrets = this.getSharedSecrets(environment.id);
        const passwordKey = `db_password_${resource.name}`;
        if (!secrets[passwordKey]) {
          secrets[passwordKey] = this.generateRandomPassword();
        }
        return secrets[passwordKey];
      }
    }
    return "";
  }

  private static resolveEnvProperty(
    property: string,
    environment: Environment
  ): string {
    if (property === "name") return environment.name;
    if (property === "id") return environment.id;
    return "";
  }

  private static resolveProjectProperty(
    property: string,
    project: Project
  ): string {
    if (property === "baseDomain") return project.baseDomain;
    if (property === "name") return project.name;
    return "";
  }

  private static getResourceUrl(
    resource: ProjectResource,
    environment: Environment,
    project: Project,
    localMode?: boolean,
    resourcePorts?: Record<string, number>
  ): string {
    if (resource.type === "mysql-db") return "";

    if (localMode && resourcePorts && resourcePorts[resource.name]) {
      return `http://localhost:${resourcePorts[resource.name]}`;
    }
    return `https://${resource.name}.${environment.name}.${project.baseDomain}`;
  }

  private static getResourceHost(
    resource: ProjectResource,
    environment: Environment,
    project: Project,
    localMode?: boolean
  ): string {
    if (resource.type === "mysql-db") {
      return `${resource.name}-${environment.name}`;
    }
    if (localMode) {
      return "localhost";
    }
    return `${resource.name}.${environment.name}.${project.baseDomain}`;
  }

  /**
   * Get the internal Docker URL for a resource (accessible from within containers)
   * In local mode: http://host.docker.internal:PORT
   * In production: same as normal URL
   */
  private static getResourceInternalUrl(
    resource: ProjectResource,
    environment: Environment,
    project: Project,
    localMode?: boolean,
    resourcePorts?: Record<string, number>
  ): string {
    if (resource.type === "mysql-db") return "";

    if (localMode && resourcePorts && resourcePorts[resource.name]) {
      // Use host.docker.internal so containers can access host services
      return `http://host.docker.internal:${resourcePorts[resource.name]}`;
    }
    // In production, internal and external URLs are the same
    return `https://${resource.name}.${environment.name}.${project.baseDomain}`;
  }

  /**
   * Get or create shared secrets for an environment
   */
  private static getSharedSecrets(
    environmentId: string
  ): Record<string, string> {
    if (!this.sharedSecrets.has(environmentId)) {
      this.sharedSecrets.set(environmentId, {});
    }
    return this.sharedSecrets.get(environmentId);
  }

  /**
   * Clear shared secrets for an environment (call after environment creation is complete)
   */
  static clearSharedSecrets(environmentId: string): void {
    this.sharedSecrets.delete(environmentId);
  }

  private static addLaravelVars(
    envVars: Record<string, string>,
    resource?: ProjectResource,
    environment?: Environment,
    project?: Project,
    localMode?: boolean,
    resourcePorts?: Record<string, number>
  ): void {
    envVars.APP_KEY = this.generateLaravelKey();

    if (resource && environment && project) {
      const appUrl = this.getResourceUrl(
        resource,
        environment,
        project,
        localMode,
        resourcePorts
      );
      envVars.APP_URL = appUrl;
      envVars.ASSET_URL = appUrl;

      // Force HTTPS scheme when behind reverse proxy (Traefik)
      if (!localMode) {
        envVars.FORCE_HTTPS = 'true';
        // Trust only internal Docker networks for proxy headers
        envVars.TRUSTED_PROXIES = '172.16.0.0/12,10.0.0.0/8';
      }
    }
  }

  private static addNextJsVars(envVars: Record<string, string>): void {
    // No automatic variable generation - everything should be configured via templates
    envVars.NODE_ENV = "production";
  }

  private static addMySQLVars(
    envVars: Record<string, string>,
    resource: ProjectResource,
    environment: Environment
  ): void {
    const dbName = resource.name.replace("-db", "");
    const dbUser = `${dbName}_user`;

    // Use shared secrets to ensure same password is used by Laravel
    const secrets = this.getSharedSecrets(environment.id);
    const secretKey = `db_password_${resource.name}`;

    if (!secrets[secretKey]) {
      secrets[secretKey] = this.generateRandomPassword();
    }
    const dbPassword = secrets[secretKey];
    const rootPassword = this.generateRandomPassword();

    envVars.MYSQL_ROOT_PASSWORD = rootPassword;
    envVars.MYSQL_DATABASE = dbName;
    envVars.MYSQL_USER = dbUser;
    envVars.MYSQL_PASSWORD = dbPassword;
  }

  /**
   * Generate a random password
   */
  private static generateRandomPassword(length: number = 32): string {
    return crypto.randomBytes(length).toString("base64").slice(0, length);
  }

  /**
   * Generate a Laravel APP_KEY in the correct format
   */
  private static generateLaravelKey(): string {
    const key = crypto.randomBytes(32).toString("base64");
    return `base64:${key}`;
  }
}
