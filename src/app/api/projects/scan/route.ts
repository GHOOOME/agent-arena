import { scanProject } from '@/lib/server/projectContext';
import { jsonError } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { projectPath } = await req.json();
    if (!projectPath) {
      return jsonError('缺少 projectPath。', 400);
    }
    return Response.json(await scanProject(String(projectPath)));
  } catch (error) {
    return jsonError(error);
  }
}
