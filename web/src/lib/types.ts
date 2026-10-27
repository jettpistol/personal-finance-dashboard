// Shapes returned by the API. Amounts are integer cents.

export type Currency = 'ARS' | 'USD';
export type Scope = 'household' | `user:${number}`;
export type TxType = 'expense' | 'income' | 'transfer' | 'adjustment';
export type AccountType = 'bank' | 'cash' | 'credit_card' | 'savings' | 'investment' | 'wallet';

export type User = {
  id: number;
  username: string;
  display_name: string;
  color: string;
  share_dashboard: number;
  has_telegram?: boolean;
};

export type Me = User & {
  telegram_chat_id: string | null;
  notify_budget: number;
  notify_recurring: number;
  notify_review: number;
  telegram_available: boolean;
  email: string | null;
  mail_available: boolean;
};

export type Account = {
  id: number;
  name: string;
  type: AccountType;
  currency: Currency;
  owner_id: number | null;
  is_private: number;
  opening_balance: number;
  color: string | null;
  archived: number;
  sort: number;
  balance: number;
  balance_ars: number | null;
  balance_usd: number | null;
  can_edit: boolean;
};

export type Category = {
  id: number;
  name: string;
  parent_id: number | null;
  kind: 'expense' | 'income';
  color: string | null;
  icon: string | null;
  archived: number;
  sort: number;
};

export type Split = { user_id: number; amount: number };
export type SplitMethod = 'default' | 'equal' | 'percent' | 'exact';

export type Tx = {
  id: number;
  type: TxType;
  status: 'confirmed' | 'pending';
  date: string;
  amount: number;
  currency: Currency;
  account_id: number | null;
  to_account_id: number | null;
  to_amount: number | null;
  category_id: number | null;
  description: string;
  merchant: string | null;
  notes: string | null;
  tags: string[];
  paid_by: number | null;
  is_shared: number;
  split_method: SplitMethod | null;
  is_private: number;
  is_settlement: number;
  installment_plan_id: number | null;
  installment_number: number | null;
  recurring_id: number | null;
  import_batch_id: number | null;
  has_receipt: boolean;
  masked: boolean;
  owner_id: number | null;
  /** Whose movement it is: shared (or in a joint account), or a user id. */
  owner: 'shared' | number;
  can_edit: boolean;
  created_by: number;
  splits: Split[];
};

export type TxList = { total: number; page: number; page_size: number; totals_ars: { income: number; expense: number }; items: Tx[] };

export type CategoryAmount = { category_id: number | null; name: string; color?: string | null; amount: number };

export type MonthSummary = {
  month: string;
  income: number;
  /** Household: money put into the joint pot. Personal: negative, what the user handed to it. */
  contributions: number;
  expense: number;
  net: number;
  savings_rate: number | null;
  by_category: (CategoryAmount & { children: CategoryAmount[] })[];
  income_by_category: CategoryAmount[];
  top_merchants: { name: string; amount: number; count: number }[];
  count: number;
  missing_rates: boolean;
};

export type BudgetStatus = {
  id: number;
  category_id: number;
  scope: Scope;
  amount: number;
  currency: Currency;
  category_name: string;
  parent_id: number | null;
  color: string | null;
  spent: number;
  pct: number;
  /** As entered; `amount` includes the inflation adjustment when it is on. */
  base_amount: number;
  indexed_pct: number;
};

export type BalanceSummary = {
  currency: Currency;
  users: { user_id: number; name: string; net: number }[];
  settlements: { from: number; to: number; amount: number }[];
};

export type FxRate = { date: string; buy: number; sell: number; source: string };

export type Dashboard = {
  month: string;
  scope: Scope;
  currency: Currency;
  summary: MonthSummary;
  previous: { income: number; contributions: number; expense: number; net: number; savings_rate: number | null };
  budgets: BudgetStatus[];
  accounts: { id: number; name: string; type: AccountType; currency: Currency; balance: number; converted: number | null }[];
  accounts_total: number;
  balances: BalanceSummary[];
  recent: Tx[];
  pending: number;
  upcoming_installments: { month: string; amount: number }[];
  fx: FxRate | null;
  day_of_month: number | null;
};

export type Goal = {
  id: number;
  name: string;
  target_amount: number;
  currency: Currency;
  deadline: string | null;
  account_id: number | null;
  scope: Scope;
  color: string | null;
  archived: number;
  saved: number;
  pct: number;
  remaining: number;
  months_left: number | null;
  monthly_needed: number | null;
  account_name: string | null;
};

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
  set_tags: string[];
  active: number;
};

export type Recurring = {
  id: number;
  description: string;
  type: 'expense' | 'income';
  amount: number;
  currency: Currency;
  account_id: number;
  category_id: number | null;
  frequency: 'weekly' | 'monthly' | 'yearly';
  interval: number;
  next_date: string;
  end_date: string | null;
  merchant: string | null;
  notes: string | null;
  tags: string[];
  is_shared: number;
  split: { method: SplitMethod; values?: { user_id: number; value: number }[] } | null;
  is_private: number;
  active: number;
};

export type PresetConfig = {
  delimiter: 'auto' | ',' | ';' | '\t' | '|';
  encoding: 'utf-8' | 'windows-1252';
  sheet: number;
  skipRows: number;
  hasHeader: boolean;
  columns: {
    date: number;
    description: number[];
    amount?: number | null;
    debit?: number | null;
    credit?: number | null;
    currency?: number | null;
    merchant?: number | null;
    notes?: number | null;
  };
  amountMode: 'single' | 'split';
  invertSign: boolean;
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'DD/MM/YY' | 'DD-MM-YYYY' | 'DD.MM.YYYY';
  decimalSeparator: ',' | '.';
  skipIfContains: string[];
  accountId?: number | null;
};

export type Preset = { id: number; name: string; config: PresetConfig };

export type ImportItem = {
  line: number;
  date: string;
  description: string;
  amount: number;
  direction: 'out' | 'in';
  currency_mismatch: boolean;
  type: 'expense' | 'income' | 'transfer';
  category_id: number | null;
  merchant: string | null;
  notes: string | null;
  tags: string[];
  to_account_id: number | null;
  is_shared: boolean;
  rule: string | null;
  duplicate: 'exact' | 'similar' | null;
  import_hash: string;
  include: boolean;
};

export type Notification = { id: number; kind: string; title: string; body: string; link: string | null; read: number; created_at: string };

export type Settings = {
  household_name: string;
  default_split: Record<string, number>;
  fx_side: 'sell' | 'buy' | 'avg';
  budget_thresholds: number[];
  budget_indexing: boolean;
};
