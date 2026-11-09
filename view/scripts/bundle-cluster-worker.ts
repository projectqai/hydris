async function main() {
  // Pass "shape" to rebuild shape geometry without rewriting the cluster artifact.
  const selected = process.argv[2];
  if (selected !== undefined && selected !== "cluster" && selected !== "shape") {
    throw new Error("Usage: bun run scripts/bundle-cluster-worker.ts [cluster|shape]");
  }
  for (const [directory, name, exportName] of [
    ["layers", "cluster", "CLUSTER_WORKER_CODE"],
    ["geometry", "shape", "SHAPE_WORKER_CODE"],
  ]) {
    if (selected !== undefined && name !== selected) continue;
    const base = `${import.meta.dir}/../packages/map-engine/src/${directory}/${name}-worker`;
    const result = await Bun.build({
      entrypoints: [`${base}.ts`],
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
export const ${exportName} = ${JSON.stringify(code)};
`;

    await Bun.write(`${base}-code.ts`, output);

    console.log(`Bundled ${name} worker: ${code.length} bytes`);
  }
}

main();
