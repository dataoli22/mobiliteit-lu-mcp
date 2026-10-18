import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("stdio server starts and advertises its MCP tools", async (t) => {
  const client = new Client({ name: "mobiliteit-test-client", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts"],
    env: { MOBILITEIT_API_KEY: "test-only-key" },
    cwd: process.cwd(),
    stderr: "pipe",
  });
  t.after(async () => {
    await client.close();
  });

  await client.connect(transport);
  const [{ tools }, { resourceTemplates }] = await Promise.all([
    client.listTools(),
    client.listResourceTemplates(),
  ]);

  assert.deepEqual(
    tools.map(({ name }) => name).sort(),
    ["find_nearby_stops", "get_departures", "search_stops"],
  );
  assert.equal(
    resourceTemplates[0].uriTemplate,
    "mobiliteit://stops/{stopId}/departures",
  );
});

test("stdio server accepts an API key from a mounted secret file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mobiliteit-mcp-test-"));
  const keyFile = join(directory, "api-key");
  await writeFile(keyFile, "test-only-key");
  const client = new Client({
    name: "file-secret-test-client",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts"],
    env: { MOBILITEIT_API_KEY_FILE: keyFile },
    cwd: process.cwd(),
    stderr: "pipe",
  });

  t.after(async () => {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  });

  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 3);
});
