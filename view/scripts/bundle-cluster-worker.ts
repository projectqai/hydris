async function main() {
  const result = await Bun.build({
    entrypoints: ["./packages/map-engine/src/layers/cluster-worker.ts"],
    target: "browser",
    format: "iife",
    minify: true,
  });

  if (!result.success) {
    console.error("Bundle failed:");
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }

  const code = await result.outputs[0].text();
  const output = `// Auto-generated — run \`bun run scripts/bundle-cluster-worker.ts\` to rebuild
export const CLUSTER_WORKER_CODE = ${JSON.stringify(code)};
`;

  await Bun.write("./packages/map-engine/src/layers/cluster-worker-code.ts", output);

  console.log(`Bundled cluster worker: ${code.length} bytes`);
}

main();
