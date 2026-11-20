/**
 * FR-94 ERP › Sales: shapes of the JSON the app_sales_* functions return
 * (supabase/migrations/20261116200100_sales_functions.sql). Price keys are
 * optional: they are absent, not null, for a reader without `sales_prices`.
 */

export type SalesCaps = {
  edit: boolean;
  prices: boolean;
  prices_edit: boolean;
  bonds: boolean;
  bonds_edit: boolean;
  decide: boolean;
  reports: boolean;
  settings: boolean;
  items: boolean;
  items_edit: boolean;
};

export type FlowKind = 'bid' | 'contract';
export type StageKind = 'open' | 'lost' | 'no_bid' | 'cancelled' | 'done';
export type StageAction = 'decide' | 'quote' | 'submit';

export type Flow = { id: string; kind: FlowKind; name_fa: string; name_en: string };

export type Stage = {
  id: string;
  flow_id: string;
  position: number;
  name_fa: string;
  name_en: string;
  kind: StageKind;
  action: StageAction | null;
  code: string | null;
  owner_role_id: string | null;
  required: string[];
  active: boolean;
};

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'yes_no';
export type FieldDef = {
  id: string;
  entity: 'rfp' | 'item';
  key: string;
  label_fa: string;
  label_en: string;
  type: FieldType;
  options: string[];
  position: number;
  show_in_list: boolean;
  active: boolean;
};

export type Customer = { id: string; name: string; kind: 'government' | 'contractor' | null };
export type Person = { id: string; name: string; personnel_no: string | null; role_ids: string[] };
export type RoleRef = { id: string; name: string };

export type SalesSettings = {
  next_record_no: number;
  warn_days: number;
  validity_days: number;
  doc_template: string[];
};

export type ImportBatch = {
  id: string;
  file_name: string | null;
  created_at: string;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  records: number;
  untouched: number;
  kind: 'ledger' | 'inquiry';
  /** false while an inquiry import is still sending its parts (or was stopped). */
  closed: boolean;
};

/** A company-managed currency (sales_currencies); `decimals` is display only. */
export type Currency = {
  code: string;
  name_fa: string;
  name_en: string;
  symbol: string | null;
  decimals: number;
  active: boolean;
  position: number;
};

export type Bootstrap = {
  caps: SalesCaps;
  me: string;
  flows: Flow[];
  stages: Stage[];
  fields: FieldDef[];
  customers: Customer[];
  people: Person[];
  roles: RoleRef[];
  settings: SalesSettings;
  batches: ImportBatch[];
  currencies: Currency[];
};

export type CustomValues = Record<string, string | number | boolean>;

/** A product family (sales_products) with its item columns and their default values. */
export type Product = {
  id: string;
  code: string | null;
  name_fa: string;
  name_en: string;
  active: boolean;
  position: number;
  /** Item rows that picked this product. */
  used_count: number;
  fields: { field: string; default: string | number | boolean | null }[];
};

export type RecordRow = {
  id: string;
  record_no: number;
  revision: number;
  buyer_id: string | null;
  buyer_name: string | null;
  buyer_kind: 'government' | 'contractor' | null;
  client_id: string | null;
  client_name: string | null;
  customer_ref: string | null;
  project_site: string | null;
  source: 'website' | 'email' | 'other' | null;
  title: string;
  description: string | null;
  received_on: string | null;
  flow_id: string;
  flow_kind: FlowKind;
  stage_id: string;
  stage_kind: StageKind;
  owner_id: string | null;
  owner_name: string | null;
  in_charge_text: string | null;
  bid_decision: 'pending' | 'bid' | 'no_bid';
  decided_at: string | null;
  decision_reason: string | null;
  needs_quote: boolean;
  needs_bond: boolean;
  proposal_due: string | null;
  quote_due: string | null;
  bond_due: string | null;
  submitted_on: string | null;
  delivery_method: 'hand' | 'courier' | null;
  received_by: string | null;
  validity_days: number | null;
  bid_result: 'won' | 'lost' | 'cancelled' | null;
  result_at: string | null;
  result_reason: string | null;
  currency: string | null;
  our_price?: number | null;
  winning_bid?: number | null;
  winner_name?: string | null;
  total_value?: number | null;
  order_date: string | null;
  contract_start: string | null;
  delivery_amount: number | null;
  delivery_unit: 'day' | 'week' | 'month' | null;
  delivery_text: string | null;
  delivery_date: string | null;
  prepayment: boolean | null;
  prepayment_date: string | null;
  addendum: boolean | null;
  custom: CustomValues;
  item_columns: Record<string, string[]> | null;
  imported: boolean;
  next_deadline: string | null;
  created_at: string;
  updated_at: string;
};

export type NodeRow = {
  id: string;
  parent_id: string | null;
  seq: number;
  code: string;
  depth: number;
  description: string | null;
  product_type: string | null;
  size: string | null;
  rating: string | null;
  qty: number | null;
  unit: string | null;
  custom: CustomValues;
  product_id: string | null;
  unit_price?: number | null;
};

export type BondKind = 'bid' | 'performance' | 'advance_payment';
export type BondStatus = 'needed' | 'requested' | 'issued' | 'delivered' | 'released' | 'expired' | 'void';
export type BondForm = 'bank' | 'safteh' | 'cheque';
/** Without `sales_bonds` only id, kind, seq and status arrive. */
export type Bond = {
  id: string;
  kind: BondKind;
  seq: number;
  status: BondStatus;
  percent?: number | null;
  form?: BondForm | null;
  amount?: number | null;
  currency?: string | null;
  bank?: string | null;
  number?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  note?: string | null;
  imported?: boolean;
};

export type Payment = { id: string; seq: number; amount: number | null; paid_on: string | null; note: string | null };

export type DeadlineKind =
  | 'proposal_due' | 'quote_due' | 'bond_due' | 'offer_valid_until' | 'bond_expires' | 'delivery_due' | 'other';
export type Deadline = {
  id: string;
  kind: DeadlineKind;
  label: string | null;
  due_on: string;
  responsible_id: string | null;
  responsible_name: string | null;
  done_at: string | null;
  auto: boolean;
  created_at: string;
};
/** A row of the cross-record Deadlines page. */
export type DeadlineRow = Deadline & {
  rfp_id: string;
  record_no: number;
  title: string;
  stage_id: string;
  buyer_name: string | null;
};

export type DocumentRow = {
  id: string;
  position: number;
  name: string;
  assignee_id: string | null;
  assignee_name: string | null;
  status: 'todo' | 'in_progress' | 'ready';
  note: string | null;
};

export type EventKind = 'created' | 'edit' | 'stage' | 'decision' | 'result' | 'comment' | 'import' | 'items' | 'finance';
export type EventRow = {
  id: string;
  at: string;
  kind: EventKind;
  actor_name: string | null;
  body: Record<string, unknown>;
};

export type RecordDetail = {
  record: RecordRow;
  nodes: NodeRow[];
  bonds: Bond[];
  payments?: Payment[];
  deadlines: Deadline[];
  documents: DocumentRow[];
  events: EventRow[];
  quote_revisions?: number[];
};

export type PriceHistoryRow = {
  code: string;
  revision: number;
  product_type: string | null;
  size: string | null;
  rating: string | null;
  description: string | null;
  qty: number | null;
  unit: string | null;
  unit_price: number;
  quoted_on: string;
  rfp_id: string;
  record_no: number;
  currency: string | null;
  bid_result: 'won' | 'lost' | 'cancelled' | null;
  winning_bid: number | null;
  buyer_name: string | null;
};

export type ImportResult = {
  batch_id: string;
  created: number;
  updated: number;
  skipped: number;
  skipped_rows: { rec: string | number | null; reason: 'bad_rec' | 'exists_in_app' | 'unreadable' | 'duplicate' }[];
};

export type InquiryResultKey = 'won' | 'lost' | 'no_bid' | 'cancelled' | 'open' | 'archived';
export type InquiryImportResult = ImportResult & { by_result: Record<InquiryResultKey, number> };

/** Record numbers by origin (app_sales_record_numbers): what an import would do to each. */
export type RecordNumbers = { app: number[]; ledger: number[]; inquiry: number[] };

export type RecordFilters = {
  state?: 'open' | 'closed' | 'all';
  flow?: FlowKind | '';
  stage?: string;
  owner?: string;
  buyer?: string;
  q?: string;
  limit?: number;
  sort?: RecordSort;
  dir?: 'asc' | 'desc';
  /** received_on range, ISO dates (§16.9). */
  from?: string;
  to?: string;
  result?: ResultFilter;
};
/** Result filter of lists and figures: by bid_result / bid_decision / stage kind (§16.9). */
export type ResultFilter = 'won' | 'lost' | 'no_bid' | 'cancelled' | 'open' | 'archived';
/** Filters of the Customers tab and a customer page: records counted in figures and metrics. */
export type CustomerFilters = {
  from?: string;
  to?: string;
  result?: ResultFilter;
  owner?: string;
  kind?: 'government' | 'contractor';
};
export type RecordSort = 'record_no' | 'received_on' | 'buyer' | 'title' | 'stage' | 'owner' | 'deadline' | 'value';
export type RecordPage = { rows: RecordRow[]; total: number; truncated: boolean };

export type CustomerRef = { id: string; name: string; kind: 'government' | 'contractor' | null };
export type AddedCustomer = CustomerRef & { existed: boolean };
export type SimilarCustomer = CustomerRef & { distance: number };

/** One row of the Customers tab (app_sales_customers); value keys only for sales_prices holders. */
export type CustomerSummary = {
  id: string;
  name: string;
  kind: 'government' | 'contractor' | null;
  records: number;
  as_client: number;
  open: number;
  won: number;
  lost: number;
  no_bid: number;
  archived: number;
  cancelled: number;
  decided: number;
  win_rate: number | null;
  first_inquiry: string | null;
  last_inquiry: string | null;
  next_deadline: string | null;
  main_owner_name: string | null;
  contract_value?: Record<string, number>;
  quoted?: Record<string, number>;
  /** Won records: contract value, else our won price, per currency (§16.8). */
  sales?: Record<string, number>;
};

export type CustomerDetail = {
  customer: CustomerSummary;
  /** Gregorian year of received_on; the page shows it as a Persian year range. */
  per_year: { year: number; total: number; won: number; lost: number }[];
  client_of: { id: string; name: string; count: number }[];
  top_words: { word: string; count: number }[];
  /** People in charge on this customer's records (owner set), for the page's filter. */
  owners: { id: string; name: string; count: number }[];
};

export type SalesReport = {
  pipeline: { stage_id: string; count: number; value?: Record<string, number> }[];
  decided: { buyer_name: string | null; result_at: string; bid_result: 'won' | 'lost' | 'cancelled' }[];
};

/** Figure strip of the Customers tab (all) or one customer page (§16.8). Money keys only with sales_prices. */
export type SalesMetrics = {
  projects: number;
  active: number;
  won: number;
  lost: number;
  decided: number;
  win_rate: number | null;
  /** All-customers view only. */
  customers?: number;
  new_customers?: number;
  sales_all?: Record<string, number>;
  sales_ytd?: Record<string, number>;
  sales_prev_year?: Record<string, number>;
  pipeline?: Record<string, number>;
  /** One-customer view only: this customer's fraction of all sales, per currency. */
  share?: Record<string, number>;
  last_sale_on?: string | null;
};

/** An in-charge name kept as text, for the Name matching page. */
export type PersonToMatch = { name: string; count: number; matched_id: string | null; matched_name: string | null };
export type NameAlias = {
  id: string;
  kind: 'customer' | 'person';
  alias: string;
  target_id: string;
  target_name: string | null;
  created_at: string;
};
