/**
 * Nestly domain model.
 *
 * Every synced record is an entity with an `id`, an `updatedAt` clock used for
 * last-write-wins replication and an optional `deleted` tombstone flag.
 * Money is always stored as integer minor units (cents) to avoid float errors.
 */

export type ID = string;
/** Integer minor currency units (e.g. cents). */
export type Cents = number;
/** Local calendar date, `YYYY-MM-DD`. */
export type ISODate = string;
/** Milliseconds since epoch. */
export type Timestamp = number;

export interface BaseEntity {
  id: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy?: ID;
  deleted?: boolean;
}

export interface Frequency {
  unit: 'day' | 'week' | 'month' | 'year';
  every: number;
}

/* ------------------------------------------------------------------ */
/* Household & members                                                 */
/* ------------------------------------------------------------------ */

export interface Household extends BaseEntity {
  name: string;
  emoji: string;
  currency: string;
  address?: string;
  wifiSsid?: string;
  wifiPassword?: string;
  wifiSecurity?: 'WPA' | 'WEP' | 'nopass';
  houseRules?: string;
  landlordName?: string;
  landlordPhone?: string;
  landlordEmail?: string;
  /** IANA time zone, used by the server to send reminders at a sensible local time. */
  timezone?: string;
}

export interface Member extends BaseEntity {
  name: string;
  emoji?: string;
  color: string;
  /** True once a device has joined as this member. Placeholders are unclaimed. */
  claimed?: boolean;
  /** Moved out – kept for history, excluded from new splits and chores. */
  leftAt?: Timestamp;
  awayFrom?: ISODate;
  awayUntil?: ISODate;
  /** PayPal.me handle for one-tap settle up. */
  paypal?: string;
  iban?: string;
  /** `MM-DD` */
  birthday?: string;
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

export type SplitMode = 'equal' | 'shares' | 'exact' | 'percent';

export interface SplitPart {
  memberId: ID;
  /** equal: ignored · shares: weight · exact: cents · percent: 0–100 */
  value: number;
}

export type ExpenseCategory =
  | 'groceries'
  | 'drugstore'
  | 'household'
  | 'rent'
  | 'utilities'
  | 'internet'
  | 'insurance'
  | 'subscriptions'
  | 'furniture'
  | 'food'
  | 'drinks'
  | 'party'
  | 'transport'
  | 'repairs'
  | 'other';

export interface Expense extends BaseEntity {
  kind: 'expense' | 'transfer';
  title: string;
  amount: Cents;
  paidBy: ID;
  date: ISODate;
  category: ExpenseCategory;
  splitMode: SplitMode;
  split: SplitPart[];
  note?: string;
  recurringId?: ID;
  listId?: ID;
  method?: 'cash' | 'paypal' | 'bank' | 'other';
}

export interface Recurring extends BaseEntity {
  title: string;
  emoji?: string;
  amount: Cents;
  category: ExpenseCategory;
  paidBy: ID;
  splitMode: SplitMode;
  split: SplitPart[];
  frequency: Frequency;
  /** First due date; all later due dates are derived from this anchor. */
  startDate: ISODate;
  endDate?: ISODate;
  /** Last due date that has been turned into an expense. */
  lastBooked?: ISODate;
  /** Create the expense automatically on the due date. */
  autoBook: boolean;
  active: boolean;
  contractId?: ID;
}

/* ------------------------------------------------------------------ */
/* Chores                                                              */
/* ------------------------------------------------------------------ */

export type RotationMode = 'rotate' | 'fair' | 'fixed' | 'anyone';

export interface Chore extends BaseEntity {
  title: string;
  emoji: string;
  /** null = one-off task */
  frequency: Frequency | null;
  /** Effort 1–5. */
  points: number;
  rotation: RotationMode;
  memberIds: ID[];
  assigneeId?: ID;
  dueDate: ISODate;
  /** Keep a fixed rhythm (e.g. trash day) instead of counting from completion. */
  fixedSchedule?: boolean;
  description?: string;
  paused?: boolean;
}

export interface ChoreLog extends BaseEntity {
  choreId: ID;
  memberId: ID;
  date: ISODate;
  points: number;
  action: 'done' | 'skipped';
  title: string;
  emoji: string;
}

/* ------------------------------------------------------------------ */
/* Shopping                                                            */
/* ------------------------------------------------------------------ */

export type ItemCategory =
  | 'produce'
  | 'bakery'
  | 'dairy'
  | 'meat'
  | 'frozen'
  | 'pantry'
  | 'snacks'
  | 'drinks'
  | 'household'
  | 'drugstore'
  | 'home'
  | 'tools'
  | 'other';

export interface ShoppingList extends BaseEntity {
  name: string;
  emoji: string;
  color: string;
  order: number;
}

export interface ShoppingItem extends BaseEntity {
  listId: ID;
  name: string;
  quantity?: string;
  note?: string;
  category: ItemCategory;
  checked: boolean;
  checkedAt?: Timestamp;
  checkedBy?: ID;
  urgent?: boolean;
}

/* ------------------------------------------------------------------ */
/* Contracts                                                           */
/* ------------------------------------------------------------------ */

export type ContractCategory =
  | 'electricity'
  | 'gas'
  | 'internet'
  | 'broadcast'
  | 'insurance'
  | 'liability'
  | 'phone'
  | 'streaming'
  | 'gym'
  | 'water'
  | 'rent'
  | 'other';

export interface Contract extends BaseEntity {
  name: string;
  provider: string;
  category: ContractCategory;
  emoji?: string;
  customerNumber?: string;
  contractNumber?: string;
  meterNumber?: string;
  /** Cost per month in cents. */
  monthlyCost?: Cents;
  startDate?: ISODate;
  /** Mindestlaufzeit in months. */
  minTermMonths?: number;
  /** Automatic renewal in months after the minimum term. 0 = open-ended (cancel any time). */
  renewalMonths?: number;
  noticeValue?: number;
  noticeUnit?: 'day' | 'week' | 'month';
  /** Contract has been cancelled and ends on `endDate`. */
  cancelled?: boolean;
  endDate?: ISODate;
  holderId?: ID;
  phone?: string;
  email?: string;
  website?: string;
  notes?: string;
  recurringId?: ID;
  /** Remind this many days before the cancellation deadline. */
  remindDays?: number;
}

/* ------------------------------------------------------------------ */
/* Calendar, board, activity                                           */
/* ------------------------------------------------------------------ */

export type EventType = 'party' | 'guest' | 'repair' | 'meeting' | 'away' | 'other';

export interface CalendarEvent extends BaseEntity {
  title: string;
  type: EventType;
  date: ISODate;
  endDate?: ISODate;
  /** `HH:MM`, absent for all-day events. */
  time?: string;
  endTime?: string;
  note?: string;
  location?: string;
  memberIds?: ID[];
}

export interface Note extends BaseEntity {
  text: string;
  color: string;
  pinned: boolean;
  authorId: ID;
  reactions?: Record<string, ID[]>;
}

export type ActivityType =
  | 'expense_added'
  | 'expense_edited'
  | 'transfer_added'
  | 'chore_done'
  | 'chore_added'
  | 'items_added'
  | 'items_bought'
  | 'event_added'
  | 'note_added'
  | 'contract_added'
  | 'member_joined'
  | 'member_added'
  | 'member_left'
  | 'recurring_booked';

export interface Activity extends BaseEntity {
  type: ActivityType;
  actorId: ID;
  title?: string;
  amount?: Cents;
  count?: number;
  points?: number;
  targetId?: ID;
  emoji?: string;
}

/* ------------------------------------------------------------------ */
/* Collections                                                         */
/* ------------------------------------------------------------------ */

export interface Collections {
  household: Household;
  members: Member;
  expenses: Expense;
  recurring: Recurring;
  chores: Chore;
  choreLogs: ChoreLog;
  lists: ShoppingList;
  items: ShoppingItem;
  contracts: Contract;
  events: CalendarEvent;
  notes: Note;
  activity: Activity;
}

export type CollectionName = keyof Collections;

export const COLLECTIONS: readonly CollectionName[] = [
  'household',
  'members',
  'expenses',
  'recurring',
  'chores',
  'choreLogs',
  'lists',
  'items',
  'contracts',
  'events',
  'notes',
  'activity',
];

/** One replicated record as exchanged with the sync server. */
export interface Change {
  /** collection */
  c: CollectionName;
  id: ID;
  /** Full entity payload. */
  data: Record<string, unknown>;
  /** updatedAt clock (ms). */
  u: Timestamp;
  /** Server sequence number, only set on records coming from the server. */
  seq?: number;
}
