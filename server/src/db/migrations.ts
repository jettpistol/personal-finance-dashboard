// Each entry runs once, in order. The applied count is stored in PRAGMA user_version.
// Never edit a migration that has shipped; append a new one instead.
export const migrations: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'blue',
    share_dashboard INTEGER NOT NULL DEFAULT 1,
    telegram_chat_id TEXT,
    notify_budget INTEGER NOT NULL DEFAULT 1,
    notify_recurring INTEGER NOT NULL DEFAULT 1,
    notify_review INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE login_attempts (
    key TEXT PRIMARY KEY,
    failures INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    last_failure_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('bank','cash','credit_card','savings','investment','wallet')),
    currency TEXT NOT NULL CHECK (currency IN ('ARS','USD')),
    owner_id INTEGER REFERENCES users(id),
    is_private INTEGER NOT NULL DEFAULT 0,
    opening_balance INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('expense','income')),
    color TEXT,
    icon TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE installment_plans (
    id INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    total_amount INTEGER NOT NULL,
    count INTEGER NOT NULL,
    first_date TEXT NOT NULL,
    purchase_date TEXT NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE recurring (
    id INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('expense','income')),
    amount INTEGER NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','yearly')),
    interval INTEGER NOT NULL DEFAULT 1,
    next_date TEXT NOT NULL,
    day_of_month INTEGER NOT NULL DEFAULT 1,
    end_date TEXT,
    merchant TEXT,
    notes TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    paid_by INTEGER REFERENCES users(id),
    is_shared INTEGER NOT NULL DEFAULT 0,
    split TEXT,
    is_private INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE import_batches (
    id INTEGER PRIMARY KEY,
    file_name TEXT NOT NULL,
    preset_id INTEGER,
    account_id INTEGER REFERENCES accounts(id),
    row_count INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('expense','income','transfer','adjustment')),
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','pending')),
    date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    to_account_id INTEGER REFERENCES accounts(id),
    to_amount INTEGER,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    description TEXT NOT NULL DEFAULT '',
    merchant TEXT,
    notes TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    paid_by INTEGER REFERENCES users(id),
    is_shared INTEGER NOT NULL DEFAULT 0,
    split_method TEXT,
    is_private INTEGER NOT NULL DEFAULT 0,
    is_settlement INTEGER NOT NULL DEFAULT 0,
    installment_plan_id INTEGER REFERENCES installment_plans(id) ON DELETE CASCADE,
    installment_number INTEGER,
    recurring_id INTEGER REFERENCES recurring(id) ON DELETE SET NULL,
    import_batch_id INTEGER REFERENCES import_batches(id) ON DELETE SET NULL,
    import_hash TEXT,
    receipt_file TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_tx_date ON transactions(date);
  CREATE INDEX idx_tx_account ON transactions(account_id);
  CREATE INDEX idx_tx_to_account ON transactions(to_account_id);
  CREATE INDEX idx_tx_category ON transactions(category_id);
  CREATE INDEX idx_tx_import_hash ON transactions(import_hash);

  CREATE TABLE transaction_splits (
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    PRIMARY KEY (transaction_id, user_id)
  );

  CREATE TABLE rules (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    match_type TEXT NOT NULL CHECK (match_type IN ('contains','starts_with','equals','regex')),
    pattern TEXT NOT NULL,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    amount_min INTEGER,
    amount_max INTEGER,
    set_type TEXT CHECK (set_type IN ('expense','income','transfer')),
    set_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    set_merchant TEXT,
    set_to_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    set_shared INTEGER,
    set_tags TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE csv_presets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE budgets (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'ARS',
    UNIQUE (category_id, scope)
  );

  CREATE TABLE budget_alerts_sent (
    budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    threshold INTEGER NOT NULL,
    PRIMARY KEY (budget_id, month, threshold)
  );

  CREATE TABLE goals (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    target_amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'ARS',
    deadline TEXT,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    scope TEXT NOT NULL DEFAULT 'household',
    color TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE goal_contributions (
    id INTEGER PRIMARY KEY,
    goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    note TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id)
  );

  CREATE TABLE fx_rates (
    date TEXT PRIMARY KEY,
    buy REAL NOT NULL,
    sell REAL NOT NULL,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE cpi_monthly (
    month TEXT PRIMARY KEY,
    pct REAL NOT NULL,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE month_reviews (
    month TEXT NOT NULL,
    scope TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    closed_at TEXT,
    sent_at TEXT,
    PRIMARY KEY (month, scope)
  );

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // Redesign: red, yellow and teal are reserved for errors, warnings and positive change,
  // so decorative colors move into the statistical family.
  `
  UPDATE categories SET color = CASE color WHEN 'red' THEN 'violet' WHEN 'yellow' THEN 'lime' WHEN 'teal' THEN 'blue' ELSE color END;
  UPDATE accounts SET color = CASE color WHEN 'red' THEN 'violet' WHEN 'yellow' THEN 'lime' WHEN 'teal' THEN 'blue' ELSE color END;
  UPDATE goals SET color = CASE color WHEN 'red' THEN 'violet' WHEN 'yellow' THEN 'lime' WHEN 'teal' THEN 'blue' ELSE color END;
  `,
  // Data profiles: separate datasets (e.g. real data, test data, empty) the household can switch between.
  // Only the core database uses this table; each profile has its own database file.
  `
  CREATE TABLE profiles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    file TEXT NOT NULL UNIQUE,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];
