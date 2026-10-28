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
  // Inflation adjustment of budgets becomes a switch: each budget remembers the CPI month it was
  // set at, and while the switch is on its amount is shown scaled by the CPI since then.
  // Nothing is multiplied in place any more, so it can't compound.
  `
  ALTER TABLE budgets ADD COLUMN base_month TEXT;
  UPDATE budgets SET base_month = (SELECT MAX(month) FROM cpi_monthly);
  UPDATE settings SET key = 'budget_indexing' WHERE key = 'budget_auto_index';
  DELETE FROM settings WHERE key = 'budget_indexed_cpi_month';
  `,
  // Deudores: money and things lent to other people, with partial returns. Private to whoever lent.
  `
  CREATE TABLE loans (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    person TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('money', 'item')),
    item TEXT,
    amount INTEGER,
    currency TEXT NOT NULL DEFAULT 'ARS' CHECK (currency IN ('ARS', 'USD')),
    lent_on TEXT NOT NULL,
    due_on TEXT,
    notes TEXT,
    closed_on TEXT,
    closed_reason TEXT CHECK (closed_reason IN ('returned', 'forgiven')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX loans_owner ON loans (owner_id, closed_on);
  CREATE TABLE loan_returns (
    id INTEGER PRIMARY KEY,
    loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    amount INTEGER,
    note TEXT
  );
  `,
  // Email notifications: each user's address (users live in the core DB and are copied to profiles).
  `
  ALTER TABLE users ADD COLUMN email TEXT;
  `,
  // Pagos pendientes: commitments the household has to carry out each month (savings plans and
  // debts paid to people), the movements linked to each month, and why a month was paid in part.
  // Loans gain interest and installments, fixed when the loan is created.
  `
  CREATE TABLE commitments (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('savings', 'owe')),
    title TEXT NOT NULL,
    person TEXT,
    amount INTEGER NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
    start_month TEXT NOT NULL,
    months INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE commitment_payments (
    id INTEGER PRIMARY KEY,
    commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    transaction_id INTEGER UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    date TEXT NOT NULL,
    reason TEXT,
    auto INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX commitment_payments_by_month ON commitment_payments (commitment_id, month);
  CREATE TABLE reminders_sent (
    key TEXT PRIMARY KEY,
    sent_at TEXT NOT NULL
  );
  ALTER TABLE loans ADD COLUMN interest_rate REAL;
  ALTER TABLE loans ADD COLUMN installments INTEGER;
  ALTER TABLE loans ADD COLUMN first_due TEXT;
  ALTER TABLE loans ADD COLUMN total INTEGER;
  ALTER TABLE loan_returns ADD COLUMN transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL;
  `,
  // Objetivos (formerly "metas de ahorro"): a picture (file under DATA_DIR/goals), a link,
  // short notes and a priority per goal.
  `
  ALTER TABLE goals ADD COLUMN image_file TEXT;
  ALTER TABLE goals ADD COLUMN url TEXT;
  ALTER TABLE goals ADD COLUMN notes TEXT;
  ALTER TABLE goals ADD COLUMN priority TEXT CHECK (priority IN ('high', 'medium', 'low'));
  `,
  // Mercado Pago, one connection per person (kept in the core database, like the logins). The
  // access token is stored only encrypted (lib/secrets.ts) and never sent back to the browser.
  `
  CREATE TABLE mp_connections (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_enc TEXT NOT NULL,
    mp_user_id INTEGER,
    nickname TEXT,
    site_id TEXT,
    history_start TEXT,
    connected_at TEXT NOT NULL,
    checked_at TEXT,
    checks TEXT
  );
  `,
  // Activity log (Actividad), kept in the core database so it survives profile resets and
  // updates. at_ms is UTC milliseconds; the browser shows it in the viewer's chosen time zone.
  // private_to: only that user may see the entry (private accounts and movements, own connections).
  `
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at_ms INTEGER NOT NULL,
    user_id INTEGER,
    profile_id INTEGER,
    section TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    entity TEXT,
    entity_id INTEGER,
    details TEXT,
    private_to INTEGER
  );
  CREATE INDEX audit_log_at ON audit_log (at_ms);
  CREATE INDEX audit_log_section ON audit_log (section, at_ms);
  `,
  // Which account in this data profile is each person's Mercado Pago (one per person).
  `
  CREATE TABLE mp_links (
    user_id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
  );
  `,
];
