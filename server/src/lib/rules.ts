import { db } from '../db/index.js';

export type Rule = {
  id: number;
  name: string;
  priority: number;
  match_type: 'contains' | 'starts_with' | 'equals' | 'regex';
  pattern: string;
  account_id: number | null;
  amount_min: number | null;
  amount_max: number | null;
  set_type: 'expense' | 'income' | 'transfer' | null;
  set_category_id: number | null;
  set_merchant: string | null;
  set_to_account_id: number | null;
  set_shared: number | null;
  set_tags: string | null;
  active: number;
};

export type RuleSubject = { description: string; amount: number; account_id: number | null };

export type RulePatch = {
  rule_id: number;
  rule_name: string;
  type?: 'expense' | 'income' | 'transfer';
  category_id?: number;
  merchant?: string;
  to_account_id?: number;
  is_shared?: boolean;
  tags?: string[];
};

function fold(s: string) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

export function ruleMatches(rule: Rule, subject: RuleSubject): boolean {
  if (rule.account_id != null && rule.account_id !== subject.account_id) return false;
  const abs = Math.abs(subject.amount);
  if (rule.amount_min != null && abs < rule.amount_min) return false;
  if (rule.amount_max != null && abs > rule.amount_max) return false;
  const text = fold(subject.description);
  const pattern = fold(rule.pattern);
  switch (rule.match_type) {
    case 'contains':
      return text.includes(pattern);
    case 'starts_with':
      return text.startsWith(pattern);
    case 'equals':
      return text === pattern;
    case 'regex':
      try {
        return new RegExp(rule.pattern, 'i').test(subject.description);
      } catch {
        return false;
      }
  }
}

export function loadRules(): Rule[] {
  return db().prepare('SELECT * FROM rules WHERE active = 1 ORDER BY priority DESC, id').all() as Rule[];
}

/** The first matching rule (highest priority) decides; returns the fields it sets. */
export function applyRules(rules: Rule[], subject: RuleSubject): RulePatch | null {
  const rule = rules.find((r) => ruleMatches(r, subject));
  if (!rule) return null;
  const patch: RulePatch = { rule_id: rule.id, rule_name: rule.name };
  if (rule.set_type) patch.type = rule.set_type;
  if (rule.set_category_id != null) patch.category_id = rule.set_category_id;
  if (rule.set_merchant) patch.merchant = rule.set_merchant;
  if (rule.set_to_account_id != null) patch.to_account_id = rule.set_to_account_id;
  if (rule.set_shared != null) patch.is_shared = !!rule.set_shared;
  if (rule.set_tags) patch.tags = JSON.parse(rule.set_tags);
  return patch;
}
