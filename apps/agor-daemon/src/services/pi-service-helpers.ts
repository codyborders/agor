import type { Database } from '@agor/core/db';
import { WorktreeRepository } from '@agor/core/db';

export async function resolveOptionalWorktreePath(
  db: Database,
  worktreeId?: string
): Promise<string | undefined> {
  if (!worktreeId) {
    return undefined;
  }

  const worktreeRepository = new WorktreeRepository(db);
  const worktree = await worktreeRepository.findById(worktreeId);
  if (!worktree) {
    throw new Error(`Pi service could not resolve worktree ${worktreeId}`);
  }
  if (!worktree.path) {
    throw new Error(`Pi worktree ${worktreeId} does not have a filesystem path`);
  }

  return worktree.path;
}
