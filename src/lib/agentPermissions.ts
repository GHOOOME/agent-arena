import { ProjectAgentPermission } from '@/types';

export const DEFAULT_PROJECT_AGENT_PERMISSION: ProjectAgentPermission = 'request_approval';

export const PROJECT_AGENT_PERMISSION_COPY: Record<ProjectAgentPermission, {
  title: string;
  shortLabel: string;
  description: string;
}> = {
  request_approval: {
    title: '请求批准',
    shortLabel: '始终询问',
    description: '编辑文件和使用联网能力前始终请求你确认。',
  },
  auto_approve_safe: {
    title: '替我审批',
    shortLabel: '风险操作询问',
    description: '安全、可验证的本地改动可合并确认；检测到风险时请求你确认。',
  },
  full_access: {
    title: '完全访问权限',
    shortLabel: '少询问',
    description: '尽量减少确认步骤；当前版本仍保留项目目录、密钥和文件类型保护。',
  },
};
