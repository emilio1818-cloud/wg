/**
 * SQLite persistence for the sync server.
 *
 * The server is a generic record store: it knows nothing about the domain
 * besides the collection names. Every accepted write gets a per-household,
 * strictly increasing `seq` so clients can pull "everything after my cursor".
 */
import { DatabaseSync } from 'node:sqlite';
import type { Change, CollectionName } from '../../core/src/types.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS households (
  id          TEXT PRIMARY KEY,
  invite_code TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  token_hash   TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  member_id    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS memberships_member ON memberships (household_id, member_id);

CREATE TABLE IF NOT EXISTS records (
  household_id TEXT NOT NULL REFERENCES households(id),
  collection   TEXT NOT NULL,
  id           TEXT NOT NULL,
  data         TEXT NOT NULL,
  updated_at   INTEGER NOT NULL,
  seq          INTEGER NOT NULL,
  PRIMARY KEY (household_id, collection, id)
);
CREATE INDEX IF NOT EXISTS records_seq ON records (household_id, seq);
`;

export interface Membership {
  householdId: string;
  memberId: string;
}

export interface PullResult {
  changes: Change[];
  cursor: number;
  more: boolean;
}

export interface StoredRecord {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Last-write-wins: the incoming version replaces the stored one if it is newer,
 * or — on an exact clock tie — if its JSON string sorts higher. The tie-break
 * makes the outcome independent of the order in which writes arrive.
 */
export function lwwWins(incomingU: number, incomingData: string, storedU: number, storedData: string): boolean {
  return incomingU > storedU || (incomingU === storedU && incomingData > storedData);
}

/**
 * `updated_at` is read back as REAL: SQLite stores integral doubles as 64-bit
 * integers, and node:sqlite refuses to return integers above
 * Number.MAX_SAFE_INTEGER. The cast round-trips any JS number exactly.
 */
function prepareStatements(db: DatabaseSync) {
  const prepare = (sql: string) => db.prepare(sql);
  return {
    householdExists: prepare('SELECT 1 FROM households WHERE id = ?'),
    insertHousehold: prepare('INSERT INTO households (id, invite_code, created_at) VALUES (?, ?, ?)'),
    householdByInvite: prepare('SELECT id FROM households WHERE invite_code = ?'),
    inviteCode: prepare('SELECT invite_code FROM households WHERE id = ?'),
    setInviteCode: prepare('UPDATE households SET invite_code = ? WHERE id = ?'),
    insertMembership: prepare(
      'INSERT INTO memberships (token_hash, household_id, member_id, created_at) VALUES (?, ?, ?, ?)',
    ),
    membership: prepare(
      'SELECT household_id, member_id FROM memberships WHERE token_hash = ? AND revoked_at IS NULL',
    ),
    revokeMembership: prepare(
      'UPDATE memberships SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
    ),
    memberClaimed: prepare(
      'SELECT 1 FROM memberships WHERE household_id = ? AND member_id = ? AND revoked_at IS NULL LIMIT 1',
    ),
    claimedMembers: prepare(
      'SELECT DISTINCT member_id FROM memberships WHERE household_id = ? AND revoked_at IS NULL',
    ),
    head: prepare('SELECT COALESCE(MAX(seq), 0) AS head FROM records WHERE household_id = ?'),
    record: prepare(
      'SELECT data, CAST(updated_at AS REAL) AS u FROM records WHERE household_id = ? AND collection = ? AND id = ?',
    ),
    collection: prepare('SELECT id, data FROM records WHERE household_id = ? AND collection = ?'),
    upsert: prepare(`
      INSERT INTO records (household_id, collection, id, data, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (household_id, collection, id)
      DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, seq = excluded.seq`),
    since: prepare(`
      SELECT collection, id, data, CAST(updated_at AS REAL) AS u, seq FROM records
      WHERE household_id = ? AND seq > ? ORDER BY seq LIMIT ?`),
  };
}

type Statements = ReturnType<typeof prepareStatements>;

type RecordRow = { collection: CollectionName; id: string; data: string; u: number; seq: number };

export class Store {
  private readonly db: DatabaseSync;
  private readonly stmt: Statements;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:' && path !== '') {
      // WAL lets readers proceed while a write transaction is open.
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    }
    this.db.exec(SCHEMA);
    this.stmt = prepareStatements(this.db);
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  /**
   * Runs `fn` in a write transaction. `BEGIN IMMEDIATE` takes the write lock up
   * front so seq allocation (max + 1) cannot race with another connection.
   * Nested calls join the outer transaction.
   */
  transaction<T>(fn: () => T): T {
    if (this.db.isTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /* -------------------------------- households ------------------------------- */

  householdExists(id: string): boolean {
    return this.stmt.householdExists.get(id) !== undefined;
  }

  insertHousehold(id: string, inviteCode: string): void {
    this.stmt.insertHousehold.run(id, inviteCode, Date.now());
  }

  householdIdForInvite(code: string): string | undefined {
    const row = this.stmt.householdByInvite.get(code) as { id: string } | undefined;
    return row?.id;
  }

  inviteCode(householdId: string): string | undefined {
    const row = this.stmt.inviteCode.get(householdId) as { invite_code: string } | undefined;
    return row?.invite_code;
  }

  setInviteCode(householdId: string, code: string): void {
    this.stmt.setInviteCode.run(code, householdId);
  }

  /* -------------------------------- memberships ------------------------------ */

  addMembership(tokenHash: string, householdId: string, memberId: string): void {
    this.stmt.insertMembership.run(tokenHash, householdId, memberId, Date.now());
  }

  /** Active (non-revoked) membership for a token hash. */
  membership(tokenHash: string): Membership | undefined {
    const row = this.stmt.membership.get(tokenHash) as { household_id: string; member_id: string } | undefined;
    return row && { householdId: row.household_id, memberId: row.member_id };
  }

  revokeMembership(tokenHash: string): void {
    this.stmt.revokeMembership.run(Date.now(), tokenHash);
  }

  isMemberClaimed(householdId: string, memberId: string): boolean {
    return this.stmt.memberClaimed.get(householdId, memberId) !== undefined;
  }

  claimedMemberIds(householdId: string): Set<string> {
    const rows = this.stmt.claimedMembers.all(householdId) as { member_id: string }[];
    return new Set(rows.map((r) => r.member_id));
  }

  /* --------------------------------- records --------------------------------- */

  /** Highest seq of the household, 0 if it has no records. */
  head(householdId: string): number {
    return (this.stmt.head.get(householdId) as { head: number }).head;
  }

  record(householdId: string, collection: CollectionName, id: string): StoredRecord | undefined {
    const row = this.stmt.record.get(householdId, collection, id) as { data: string } | undefined;
    return row && { id, data: JSON.parse(row.data) };
  }

  records(householdId: string, collection: CollectionName): StoredRecord[] {
    const rows = this.stmt.collection.all(householdId, collection) as { id: string; data: string }[];
    return rows.map((r) => ({ id: r.id, data: JSON.parse(r.data) }));
  }

  /**
   * Applies changes with last-write-wins and returns how many were accepted.
   * Changes are expected to be validated already.
   */
  applyChanges(householdId: string, changes: readonly Change[]): number {
    if (changes.length === 0) return 0;
    return this.transaction(() => {
      let seq = this.head(householdId);
      let accepted = 0;
      for (const change of changes) {
        const data = JSON.stringify(change.data);
        const stored = this.stmt.record.get(householdId, change.c, change.id) as { data: string; u: number } | undefined;
        if (stored && !lwwWins(change.u, data, stored.u, stored.data)) continue;
        this.stmt.upsert.run(householdId, change.c, change.id, data, change.u, ++seq);
        accepted++;
      }
      return accepted;
    });
  }

  /** Records with `seq > since`, ordered by seq, at most `limit` of them. */
  pull(householdId: string, since: number, limit: number): PullResult {
    const rows = this.stmt.since.all(householdId, since, limit + 1) as RecordRow[];
    const more = rows.length > limit;
    const page = more ? rows.slice(0, limit) : rows;
    const changes: Change[] = page.map((r) => ({ c: r.collection, id: r.id, u: r.u, data: JSON.parse(r.data), seq: r.seq }));
    // An empty page means `since` is at (or beyond) the head; report the head.
    const cursor = page.length > 0 ? page[page.length - 1].seq : this.head(householdId);
    return { changes, cursor, more };
  }
}
