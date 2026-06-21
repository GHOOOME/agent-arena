import { listProjects } from '@/lib/server/projectContext';
import { jsonError } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return Response.json({ projects: await listProjects() });
  } catch (error) {
    return jsonError(error);
  }
}
