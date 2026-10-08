import { describe, expect, it } from "vitest";
import { DockerService } from "./docker.service";

/**
 * A DockerService whose networks record what they are asked, and answer
 * with the given error.
 */
function withNetworks(error?: Error) {
  const calls: { network: string; options: Record<string, unknown> }[] = [];
  const service = new DockerService();
  Object.assign(service, {
    docker: {
      getNetwork: (network: string) => ({
        connect: async (options: Record<string, unknown>) => {
          calls.push({ network, options });
          if (error) {
            throw error;
          }
        },
      }),
    },
  });
  return { service, calls };
}

describe("DockerService.connectNetwork", () => {
  it("attaches with the gateway priority asked for, and without one otherwise", async () => {
    const { service, calls } = withNetworks();
    await service.connectNetwork("spn-blog--feat_default", "spawner-traefik", -1);
    await service.connectNetwork("spawner-core", "spawner-traefik");
    expect(calls).toEqual([
      { network: "spn-blog--feat_default", options: { Container: "spawner-traefik", EndpointConfig: { GwPriority: -1 } } },
      { network: "spawner-core", options: { Container: "spawner-traefik", EndpointConfig: undefined } },
    ]);
  });

  it("does nothing when the container is already attached, and fails otherwise", async () => {
    const attached = withNetworks(new Error("(HTTP code 403) unexpected - endpoint with name spawner-traefik already exists in network spn-blog--feat_default"));
    await expect(attached.service.connectNetwork("spn-blog--feat_default", "spawner-traefik", -1)).resolves.toBeUndefined();

    const missing = withNetworks(new Error("(HTTP code 404) network or container is not found"));
    await expect(missing.service.connectNetwork("spn-blog--feat_default", "spawner-traefik", -1)).rejects.toThrow("not found");
  });
});
