import { WorkWindowPermission } from '@/types';

export const DEFAULT_WORK_WINDOW_PERMISSION: WorkWindowPermission = 'read_only';

export const WORK_WINDOW_PERMISSION_COPY: Record<WorkWindowPermission, {
  title: string;
  shortLabel: string;
  description: string;
}> = {
  read_only: {
    title: '只读分析',
    shortLabel: '只读',
    description: '只能读取项目上下文和回答，不生成落盘修改。',
  },
  propose_patch: {
    title: '提出补丁',
    shortLabel: '提案',
    description: '可以生成代码修改提案，但需要你确认后才会写入。',
  },
  apply_files: {
    title: '写入分支',
    shortLabel: '写文件',
    description: '允许写入该窗口自己的工作分支，不直接修改主项目。',
  },
  run_safe_commands: {
    title: '安全命令',
    shortLabel: '检查',
    description: '允许运行 lint、test、rg、ls 等白名单命令。',
  },
  run_dev_server: {
    title: '启动预览',
    shortLabel: '预览',
    description: '允许为该窗口启动独立开发服务和读取日志。',
  },
  full_local_agent: {
    title: '本地 Agent',
    shortLabel: '完整',
    description: '允许更宽的本地操作，高风险命令仍需你确认。',
  },
};

export const WORK_WINDOW_PERMISSION_ORDER: WorkWindowPermission[] = [
  'read_only',
  'propose_patch',
  'apply_files',
  'run_safe_commands',
  'run_dev_server',
  'full_local_agent',
];

export function isWorkWindowPermission(value: unknown): value is WorkWindowPermission {
  return typeof value === 'string' && value in WORK_WINDOW_PERMISSION_COPY;
}
