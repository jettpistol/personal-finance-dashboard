import type { Category } from './domain.js';

/** Finds a category from its "Main > Sub" name (as written in the rule catalog). Archived ones are skipped. */
export function categoryByPath(cats: Category[], path: string | null): Category | null {
  if (!path) return null;
  const [main, sub] = path.split(' > ');
  const parent = cats.find((c) => c.parent_id === null && c.name === main && !c.archived);
  if (!parent) return null;
  return sub ? (cats.find((c) => c.parent_id === parent.id && c.name === sub && !c.archived) ?? null) : parent;
}
