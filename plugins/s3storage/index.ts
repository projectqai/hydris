// S3 artifact storage plugin for Hydris.
//
// Pushes its own service entity with a Configurable schema so the user
// can fill in S3 credentials via the UI. Once valid credentials are set,
// validates them against S3 and registers as an artifact store backend.

import { AwsClient } from "aws4fetch";

declare const Hydris: {
  artifacts: {
    registerStore(
      name: string,
      callbacks: {
        get(id: string): Promise<Response>;
        put(id: string, data: Uint8Array): Promise<void>;
        delete(id: string): Promise<void>;
        exists(id: string): Promise<boolean>;
      },
    ): void;
  };
};

const server = process.env.HYDRIS_SERVER || "http://localhost:50051";
const entityId = "artifacts.s3";

// --- Connect RPC helpers ---

async function rpc(service: string, method: string, body: any): Promise<any> {
  const resp = await fetch(`${server}/${service}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${service}/${method} failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

async function push(entities: any[]): Promise<void> {
  await rpc("world.WorldService", "Push", { changes: entities });
}

async function getEntity(id: string): Promise<any> {
  const resp = await rpc("world.WorldService", "GetEntity", { id });
  return resp.entity;
}

// --- Schema + Push ---

const schema = {
  type: "object",
  properties: {
    bucket: {
      type: "string",
      title: "Bucket",
      description: "S3 bucket name",
      "ui:order": 0,
    },
    region: {
      type: "string",
      title: "Region",
      description: "AWS region (e.g. us-east-1)",
      default: "us-east-1",
      "ui:order": 1,
    },
    access_key: {
      type: "string",
      title: "Access Key",
      "ui:order": 2,
    },
    secret_key: {
      type: "string",
      title: "Secret Key",
      "ui:widget": "password",
      "ui:order": 3,
    },
    endpoint: {
      type: "string",
      title: "Endpoint",
      description: "Custom endpoint for S3-compatible stores (e.g. MinIO)",
      "ui:order": 4,
    },
  },
};

await push([
  {
    id: entityId,
    label: "S3 Storage",
    controller: { id: "artifacts" },
    device: {
      parent: "artifacts.service",
      category: "Storage",
    },
    configurable: {
      label: "S3 Storage",
      schema,
    },
    interactivity: {
      icon: "cloud",
    },
  },
]);

// --- Poll for config ---

async function waitForConfig(): Promise<{
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  endpoint: string;
}> {
  while (true) {
    const entity = await getEntity(entityId);
    if (entity?.config?.value) {
      const v = entity.config.value;
      if (v.bucket && v.access_key && v.secret_key) {
        return {
          bucket: v.bucket,
          region: v.region || "us-east-1",
          accessKey: v.access_key,
          secretKey: v.secret_key,
          endpoint: v.endpoint || "",
        };
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

console.log("S3 plugin: waiting for credentials...");
const config = await waitForConfig();
const { bucket, region, accessKey, secretKey, endpoint } = config;

// --- Set up AWS client ---

const aws = new AwsClient({
  accessKeyId: accessKey,
  secretAccessKey: secretKey,
  region,
  service: "s3",
});

function s3Url(key?: string): string {
  const base = endpoint
    ? `${endpoint.replace(/\/$/, "")}/${bucket}`
    : `https://${bucket}.s3.${region}.amazonaws.com`;
  return key ? `${base}/${key}` : `${base}/`;
}

// --- Error reporting ---

async function reportFailed(msg: string): Promise<never> {
  try {
    await push([{
      id: entityId,
      device: { parent: "artifacts.service", category: "Storage", state: "DeviceStateFailed", error: msg },
      configurable: { label: "S3 Storage", schema, state: "ConfigurableStateFailed", error: msg },
    }]);
  } catch (_) {}
  throw new Error(msg);
}

// --- Validate credentials ---

console.log(`S3 plugin: validating credentials for bucket "${bucket}"...`);
try {
  const listResp = await aws.fetch(s3Url() + "?max-keys=0", { method: "GET" });
  if (!listResp.ok) {
    const body = await listResp.text();
    await reportFailed(`S3 validation failed (${listResp.status}): ${body}`);
  }
} catch (err: any) {
  if (err?.message?.startsWith("S3 validation failed")) throw err;
  await reportFailed(`S3 connection failed: ${err?.message || err}`);
}

console.log("S3 plugin: credentials valid, registering store");

// --- Register store ---

Hydris.artifacts.registerStore("s3", {
  async get(id: string): Promise<Response> {
    const resp = await aws.fetch(s3Url(id));
    if (!resp.ok) throw new Error(`S3 GET ${id}: ${resp.status}`);
    return resp;
  },

  async put(id: string, data: Uint8Array): Promise<void> {
    // Fetch the entity to store as S3 object metadata for disaster recovery.
    let entityJson = "";
    try {
      const entity = await getEntity(id);
      if (entity) entityJson = JSON.stringify(entity);
    } catch (_) {}

    const headers: Record<string, string> = {};
    if (entityJson) {
      // S3 user metadata is limited to 2KB per header. Base64-encode and
      // truncate if needed — it's best-effort recovery info.
      const encoded = btoa(entityJson);
      if (encoded.length <= 2048) {
        headers["x-amz-meta-hydris-entity"] = encoded;
      }
    }

    const resp = await aws.fetch(s3Url(id), { method: "PUT", body: data, headers });
    if (!resp.ok) throw new Error(`S3 PUT ${id}: ${resp.status}`);

    // Update entity with S3 location so the system knows the blob lives in S3.
    try {
      await push([{
        id,
        artifact: {
          id,
          location: [{ url: s3Url(id) }],
        },
      }]);
    } catch (_) {}
  },

  async delete(id: string): Promise<void> {
    const resp = await aws.fetch(s3Url(id), { method: "DELETE" });
    if (!resp.ok && resp.status !== 404) throw new Error(`S3 DELETE ${id}: ${resp.status}`);
  },

  async exists(id: string): Promise<boolean> {
    return (await aws.fetch(s3Url(id), { method: "HEAD" })).ok;
  },
});

await push([{
  id: entityId,
  device: { parent: "artifacts.service", category: "Storage", state: "DeviceStateActive" },
  configurable: { label: "S3 Storage", schema, state: "ConfigurableStateActive" },
}]);
console.log("S3 plugin: active and ready");

// Keep alive until cancelled.
await new Promise(() => {});
