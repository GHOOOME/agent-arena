import { assertDatabaseConfigured } from '@/lib/server/config';
import { jsonError } from '@/lib/server/http';
import { createWork, listWorks, normalizeNullableText } from '@/lib/server/works';

export const runtime = 'nodejs';

export async function GET() {
  try {
    assertDatabaseConfigured();
    return Response.json({ works: await listWorks() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request) {
  try {
    assertDatabaseConfigured();
    const body = await req.json();
    const work = await createWork({
      title: normalizeNullableText(body.title) ?? undefined,
      goal: normalizeNullableText(body.goal) ?? undefined,
      projectPath: normalizeNullableText(body.projectPath) ?? null,
    });
    return Response.json({ work });
  } catch (error) {
    return jsonError(error);
  }
}
