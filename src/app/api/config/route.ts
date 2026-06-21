import { getServerConfigAsync, updateLocalTokenPlanConfig } from '@/lib/server/config';
import { jsonError } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json(await getServerConfigAsync());
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    await updateLocalTokenPlanConfig({
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
      clearApiKey: Boolean(body.clearApiKey),
    });
    return Response.json(await getServerConfigAsync());
  } catch (error) {
    return jsonError(error);
  }
}
