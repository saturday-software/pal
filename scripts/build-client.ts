import tailwindPlugin from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";
import { watch } from "node:fs";

const isWatch = process.argv.includes("--watch");

async function build() {
  if (!isWatch) await rm("dist", { force: true, recursive: true });
  const start = performance.now();
  const result = await Bun.build({
    entrypoints: ["src/client/index.html"],
    outdir: "dist",
    minify: !isWatch,
    plugins: [tailwindPlugin],
    tsconfig: "./tsconfig.client.json",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    if (!isWatch) process.exit(1);
    return;
  }
  const ms = Math.round(performance.now() - start);
  console.log(`built ${result.outputs.length} files in ${ms}ms`);
}

await build();

if (isWatch) {
  console.log("watching src/client for changes…");
  let pending: ReturnType<typeof setTimeout> | null = null;
  let building = false;
  const trigger = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(async () => {
      if (building) return;
      building = true;
      try {
        await build();
      } catch (err) {
        console.error(err);
      } finally {
        building = false;
      }
    }, 50);
  };
  watch("src/client", { recursive: true }, trigger);
}
