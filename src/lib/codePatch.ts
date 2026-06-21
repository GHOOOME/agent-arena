import { CodePatchProposal, ProposedFileEdit } from '@/types';

const MAX_EDITS = 8;
const MAX_TEXT_LENGTH = 180_000;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeEdit(value: unknown): ProposedFileEdit | null {
  const item = asObject(value);
  if (!item) return null;

  const operation = String(item.operation || '').trim();
  const filePath = String(item.path || '').trim();
  const newText = typeof item.newText === 'string' ? item.newText : null;
  const oldText = typeof item.oldText === 'string' ? item.oldText : undefined;
  const note = typeof item.note === 'string' ? item.note.slice(0, 300) : undefined;

  if ((operation !== 'create' && operation !== 'update') || !filePath || newText === null) {
    return null;
  }
  if (operation === 'update' && !oldText) {
    return null;
  }
  if (newText.length > MAX_TEXT_LENGTH || (oldText && oldText.length > MAX_TEXT_LENGTH)) {
    return null;
  }

  return {
    operation,
    path: filePath,
    oldText,
    newText,
    note,
  };
}

export function normalizeCodePatchProposal(value: unknown): CodePatchProposal | null {
  const object = asObject(value);
  if (!object) return null;

  const type = String(object.type || '').trim();
  const edits = Array.isArray(object.edits)
    ? object.edits.map(normalizeEdit).filter(Boolean).slice(0, MAX_EDITS)
    : [];

  if (type !== 'code_patch' || edits.length === 0) {
    return null;
  }

  return {
    type: 'code_patch',
    projectPath: typeof object.projectPath === 'string' ? object.projectPath.trim() : undefined,
    summary: typeof object.summary === 'string' ? object.summary.trim().slice(0, 600) : undefined,
    edits: edits as ProposedFileEdit[],
  };
}

function parseProposal(candidate: string) {
  try {
    return normalizeCodePatchProposal(JSON.parse(candidate));
  } catch {
    return null;
  }
}

export function extractCodePatchProposal(content: string): CodePatchProposal | null {
  const blocks = [...content.matchAll(/```(?:CODE_PATCH|code_patch|json)?\s*([\s\S]*?)```/g)];

  for (const block of blocks) {
    const proposal = parseProposal(block[1].trim());
    if (proposal) return proposal;
  }

  const loose = content.match(/\{\s*"type"\s*:\s*"code_patch"[\s\S]*\}/);
  return loose ? parseProposal(loose[0]) : null;
}

export function stripCodePatchProposals(content: string) {
  return content
    .replace(/```(?:CODE_PATCH|code_patch|json)?\s*\{[\s\S]*?"type"\s*:\s*"code_patch"[\s\S]*?\}\s*```/g, '')
    .replace(/\{\s*"type"\s*:\s*"code_patch"[\s\S]*\}\s*$/g, '')
    .trim();
}
