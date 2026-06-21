import { jsonError } from '@/lib/server/http';
import {
  chatOnlyProject,
  createLocalProject,
  importRemoteProject,
  prepareExistingProject,
} from '@/lib/server/projectOnboarding';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode = String(body.mode || '');

    if (mode === 'chat_only') {
      return Response.json(chatOnlyProject());
    }

    if (mode === 'new_project') {
      return Response.json(await createLocalProject({
        projectName: String(body.projectName || body.title || '新的项目'),
      }));
    }

    if (mode === 'existing_project') {
      return Response.json(await prepareExistingProject({
        projectPath: String(body.projectPath || ''),
      }));
    }

    if (mode === 'remote_project') {
      return Response.json(await importRemoteProject({
        remoteUrl: String(body.remoteUrl || ''),
        projectName: body.projectName ? String(body.projectName) : undefined,
      }));
    }

    return jsonError('未知的项目启动方式。', 400);
  } catch (error) {
    return jsonError(error);
  }
}
