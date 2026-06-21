import { jsonError } from '@/lib/server/http';
import { applyProjectPatch } from '@/lib/server/projectWrite';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { projectPath, proposal, dryRun } = await req.json();
    if (!projectPath) {
      return jsonError('缺少 projectPath。', 400);
    }
    return Response.json(await applyProjectPatch({
      projectPath: String(projectPath),
      proposal,
      dryRun: Boolean(dryRun),
    }));
  } catch (error) {
    return jsonError(error);
  }
}
