import { assertDatabaseConfigured } from '@/lib/server/config';
import { jsonError } from '@/lib/server/http';
import { executeWindowTool, WindowToolName } from '@/lib/server/windowTools';

export const runtime = 'nodejs';
export const maxDuration = 300;

const TOOL_NAMES = new Set<WindowToolName>([
  'list_files',
  'read_file',
  'search',
  'apply_code_patch',
  'run_command',
  'start_dev_server',
  'check_preview_server',
  'recover_preview_server',
  'stop_dev_server',
  'read_dev_server_log',
]);

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDatabaseConfigured();
    const { id } = await context.params;
    const body = await req.json();
    const toolName = String(body.toolName || '');
    if (!TOOL_NAMES.has(toolName as WindowToolName)) {
      return jsonError(`未知工具：${toolName}`, 400);
    }

    const result = await executeWindowTool({
      workWindowId: id,
      toolName: toolName as WindowToolName,
      input: body.input,
    });
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
