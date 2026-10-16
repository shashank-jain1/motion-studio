/**
 * `pnpm deploy:lambda` — set up Remotion Lambda rendering (RENDER_BACKEND=lambda):
 *   1. deployFunction (idempotent: reuses a function with the same version / memory / disk / timeout)
 *   2. getOrCreateBucket in the region
 *   3. bundle the engine (src/engine) and deploySiteFromBundle as site "motion-studio" (re-run after engine changes)
 *   4. write data/lambda.json { region, functionName, bucketName, serveUrl, siteName, deployedAt, remotionVersion }
 *
 * Needs REMOTION_AWS_ACCESS_KEY_ID / REMOTION_AWS_SECRET_ACCESS_KEY (an IAM user with the Remotion policy, see
 * docs/DEPLOY.md) and REMOTION_AWS_REGION (default us-east-1).
 * Tunables: LAMBDA_MEMORY_MB (2048), LAMBDA_DISK_MB (2048), LAMBDA_TIMEOUT_SEC (240), LAMBDA_SITE_NAME (motion-studio).
 */
import fs from "node:fs";
import path from "node:path";
import { LAMBDA_CONFIG_FILE } from "../src/server/config";
import { hasAwsCredentials, type LambdaConfig } from "../src/server/render/lambda";

const main = async () => {
  if (!hasAwsCredentials()) {
    console.error("Missing AWS credentials: set REMOTION_AWS_ACCESS_KEY_ID and REMOTION_AWS_SECRET_ACCESS_KEY (and REMOTION_AWS_REGION). See docs/DEPLOY.md → Lambda.");
    process.exit(1);
  }
  const region = (process.env.REMOTION_AWS_REGION || process.env.AWS_REGION || "us-east-1") as import("@remotion/lambda").AwsRegion;
  const memorySizeInMb = Number(process.env.LAMBDA_MEMORY_MB ?? 2048);
  const diskSizeInMb = Number(process.env.LAMBDA_DISK_MB ?? 2048);
  const timeoutInSeconds = Number(process.env.LAMBDA_TIMEOUT_SEC ?? 240);
  const siteName = process.env.LAMBDA_SITE_NAME || "motion-studio";

  const { deployFunction, getOrCreateBucket, deploySiteFromBundle } = await import("@remotion/lambda");
  const { getBundle } = await import("../src/core/render");

  console.log(`[deploy:lambda] region ${region}`);
  console.log(`[deploy:lambda] deploying function (${memorySizeInMb} MB RAM, ${diskSizeInMb} MB disk, ${timeoutInSeconds}s timeout)…`);
  const fn = await deployFunction({ region, memorySizeInMb, diskSizeInMb, timeoutInSeconds, createCloudWatchLogGroup: true });
  console.log(`[deploy:lambda] function ${fn.functionName}${fn.alreadyExisted ? " (already existed)" : ""}`);

  const { bucketName, alreadyExisted } = await getOrCreateBucket({ region });
  console.log(`[deploy:lambda] bucket ${bucketName}${alreadyExisted ? " (already existed)" : ""}`);

  console.log("[deploy:lambda] bundling the engine…");
  const bundleDir = await getBundle();
  console.log("[deploy:lambda] uploading site…");
  const site = await deploySiteFromBundle({ bucketName, region, bundleDir, siteName });
  console.log(`[deploy:lambda] site ${site.serveUrl} (${site.stats.uploadedFiles} uploaded, ${site.stats.deletedFiles} deleted, ${site.stats.untouchedFiles} unchanged)`);

  let remotionVersion: string | undefined;
  try {
    remotionVersion = (JSON.parse(fs.readFileSync(path.join(process.cwd(), "node_modules", "@remotion", "lambda", "package.json"), "utf8")) as { version: string }).version;
  } catch {
    /* informational */
  }
  const cfg: LambdaConfig = { region, functionName: fn.functionName, bucketName, serveUrl: site.serveUrl, siteName: site.siteName, deployedAt: new Date().toISOString(), remotionVersion };
  fs.mkdirSync(path.dirname(LAMBDA_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(LAMBDA_CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`[deploy:lambda] wrote ${LAMBDA_CONFIG_FILE}. Start the server with RENDER_BACKEND=lambda.`);
};

main().catch((e) => {
  console.error(`[deploy:lambda] failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
