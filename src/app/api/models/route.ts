import { TOKEN_PLAN_MODELS } from '@/lib/models';
import { getModels } from '@/lib/server/models';
import { getServerConfigAsync } from '@/lib/server/config';
import { jsonError } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const config = await getServerConfigAsync();
    if (!config.hasDatabaseUrl) {
      return Response.json({ models: TOKEN_PLAN_MODELS, databaseReady: false });
    }
    return Response.json({ models: await getModels(), databaseReady: true });
  } catch (error) {
    return jsonError(error);
  }
}
