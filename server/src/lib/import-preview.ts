import { db } from '../db/index.js';
import { categoryByPath } from './category-path.js';
import { loadCategories, type Account, type Category } from './domain.js';
import { RULE_CATALOG } from './rule-catalog.js';
import { applyRules, loadRules } from './rules.js';
import { importHash } from './transactions.js';

/** A line read from a file, before it becomes a movement. */
export type PreviewRow = {
  line: number;
  date: string;
  description: string;
  amount: number; // signed cents: negative = money out
  currency: 'ARS' | 'USD' | null;
  merchant: string | null;
  notes: string | null;
  // The following are set by statement readers; a CSV preset leaves them out.
  type?: 'expense' | 'income' | 'transfer';
  categoryPath?: string | null;
  include?: boolean;
  hint?: { label: string; text: string } | null;
};

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '');

const catalogRegexes = RULE_CATALOG.flatMap((r) => {
  try {
    return [{ rule: r, re: new RegExp(r.pattern, 'i') }];
  } catch {
    return [];
  }
});

/** The suggested-rules bank, used for rows no rule of the household matched. */
function catalogSuggestion(text: string, cats: Category[], type: 'expense' | 'income') {
  const plain = fold(text);
  for (const { rule, re } of catalogRegexes) {
    if (!re.test(text) && !re.test(plain)) continue;
    const cat = categoryByPath(cats, rule.category);
    // The first store that matches decides, even when its category is missing or of the other kind.
    return cat && cat.kind === type ? { category_id: cat.id, name: rule.name, merchant: rule.merchant || null } : null;
  }
  return null;
}

/**
 * Turns parsed lines into the rows of the import review: applies the household's rules,
 * proposes categories and flags duplicates. `suggest` also uses the suggested-rules bank.
 */
export function buildPreviewItems(rows: PreviewRow[], account: Account, opts: { suggest?: boolean } = {}) {
  const rules = loadRules();
  const cats = [...loadCategories().values()];
  const kinds = new Map(cats.map((c) => [c.id, c.kind]));
  const hashExists = db().prepare('SELECT 1 FROM transactions WHERE import_hash = ? LIMIT 1');
  const similar = db().prepare('SELECT id, description FROM transactions WHERE account_id = ? AND date = ? AND amount = ? LIMIT 1');
  return rows.map((r) => {
    const amount = Math.abs(r.amount);
    const direction = r.amount < 0 ? 'out' : 'in';
    const hash = importHash(account.id, r.date, r.amount, r.description);
    const patch = applyRules(rules, { description: r.description, amount: r.amount, account_id: account.id });
    const type = patch?.type ?? r.type ?? (direction === 'out' ? 'expense' : 'income');
    // A rule's category only applies when it matches the row's kind (gasto / ingreso).
    let categoryId = patch?.category_id != null && kinds.get(patch.category_id) === type ? patch.category_id : null;
    let suggested: string | null = null;
    let merchant = patch?.merchant ?? r.merchant;
    if (categoryId == null && r.categoryPath && type !== 'transfer') {
      const c = categoryByPath(cats, r.categoryPath);
      if (c && c.kind === type) categoryId = c.id;
    }
    if (categoryId == null && !patch && opts.suggest && type !== 'transfer') {
      const s = catalogSuggestion(`${r.description} ${r.merchant ?? ''}`, cats, type);
      if (s) {
        categoryId = s.category_id;
        suggested = s.name;
        merchant = s.merchant ?? merchant;
      }
    }
    const dup = hashExists.get(hash) ? 'exact' : similar.get(account.id, r.date, amount) ? 'similar' : null;
    const mismatch = r.currency != null && r.currency !== account.currency;
    return {
      line: r.line,
      date: r.date,
      description: r.description,
      amount,
      direction,
      currency_mismatch: mismatch,
      type,
      category_id: categoryId,
      merchant,
      notes: r.notes,
      tags: patch?.tags ?? [],
      to_account_id: patch?.to_account_id ?? null,
      is_shared: patch?.is_shared ?? false,
      rule: patch ? patch.rule_name : null,
      suggested,
      hint: r.hint ?? null,
      duplicate: dup,
      import_hash: hash,
      include: r.include !== false && dup !== 'exact' && !mismatch,
    };
  });
}
