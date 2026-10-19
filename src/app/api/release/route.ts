/**
 * Public release identity for the deployment that is serving this request.
 *
 * Vercel populates VERCEL_GIT_COMMIT_SHA and VERCEL_DEPLOYMENT_ID at build
 * and runtime when system environment variables are exposed. This project
 * has that exposure enabled. Values that are missing or not the documented
 * shape are reported as null. This route never reads the local git HEAD and
 * never returns other environment values.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FULL_GIT_SHA = /^[0-9a-f]{40}$/;
const VERCEL_DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{8,128}$/;

export type ReleaseIdentity = {
  gitCommitSha: string | null;
  vercelDeploymentId: string | null;
};

type ReleaseEnvironment = {
  VERCEL_GIT_COMMIT_SHA?: string;
  VERCEL_DEPLOYMENT_ID?: string;
};

function readGitCommitSha(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return FULL_GIT_SHA.test(normalized) ? normalized : null;
}

function readDeploymentId(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return VERCEL_DEPLOYMENT_ID.test(normalized) ? normalized : null;
}

export function readReleaseIdentity(
  env: ReleaseEnvironment = {
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID,
  },
): ReleaseIdentity {
  return {
    gitCommitSha: readGitCommitSha(env.VERCEL_GIT_COMMIT_SHA),
    vercelDeploymentId: readDeploymentId(env.VERCEL_DEPLOYMENT_ID),
  };
}

export async function GET(): Promise<Response> {
  return Response.json(readReleaseIdentity(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
