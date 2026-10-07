import { describe, expect, it } from "vitest";
import { attributeDisk } from "./disk";

describe("attributeDisk", () => {
  it("gives each environment its own layers, volumes, writable layers and sources", () => {
    const breakdown = attributeDisk(
      {
        LayersSize: 5000,
        Images: [
          { Id: "built-a", Size: 1200, SharedSize: 1000, Labels: { "com.docker.compose.project": "spn-blog--feat-a" } },
          { Id: "built-b", Size: 1300, SharedSize: 1000, Labels: { "com.docker.compose.project": "spn-blog--feat-b" } },
          { Id: "postgres", Size: 800, SharedSize: -1, Labels: null },
        ],
        Volumes: [
          { Name: "spn-blog--feat-a_db-data", Labels: { "dev.spawner.env": "a" }, UsageData: { Size: 50 } },
          { Name: "spawner_postgres-data", Labels: { "com.docker.compose.project": "spawner" }, UsageData: { Size: 70 } },
          { Name: "unknown", Labels: null, UsageData: { Size: -1 } },
        ],
        Containers: [
          { Id: "c1", SizeRw: 7, Labels: { "dev.spawner.env": "a" } },
          { Id: "c2", SizeRw: 3, Labels: {} },
        ],
        BuildCache: [{ Size: 400 }, { Size: 100 }],
      },
      {
        environmentsByProject: new Map([
          ["spn-blog--feat-a", "a"],
          ["spn-blog--feat-b", "b"],
        ]),
        sources: new Map([
          ["a", 10],
          ["c", 20],
        ]),
        ownProject: "spawner",
        logsBytes: 99,
      },
    );
    expect(breakdown).toEqual({
      imagesBytes: 5000,
      buildCacheBytes: 500,
      volumesBytes: 120,
      writableBytes: 10,
      sourcesBytes: 30,
      logsBytes: 99,
      spawnerBytes: 70,
      environments: {
        a: { imagesUniqueBytes: 200, imagesSharedBytes: 1000, volumesBytes: 50, writableBytes: 7, sourcesBytes: 10, totalBytes: 267 },
        b: { imagesUniqueBytes: 300, imagesSharedBytes: 1000, volumesBytes: 0, writableBytes: 0, sourcesBytes: 0, totalBytes: 300 },
        c: { imagesUniqueBytes: 0, imagesSharedBytes: 0, volumesBytes: 0, writableBytes: 0, sourcesBytes: 20, totalBytes: 20 },
      },
    });
  });
});
