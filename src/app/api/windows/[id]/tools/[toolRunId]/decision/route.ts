import { assertDatabaseConfigured } from '@/lib/server/config';
import { jsonError } from '@/lib/server/http';
import { approveWindowToolRun } from '@/lib/server/windowTools';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request, context: { params: Promise<{ id: string; toolRunId: string }> }) {
  try {
    assertDatabaseConfigured();
    const { id, toolRunId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const decision = body.decision === 'approve' ? 'approve' : body.decision === 'reject' ? 'reject' : null;
    if (!decision) {
      return jsonError('缺少审批 decision。', 400);
    }

    return Response.json(await approveWindowToolRun({
      workWindowId: id,
      toolRunId,
      decision,
    }));
  } catch (error) {
    return jsonError(error);
  }
}
