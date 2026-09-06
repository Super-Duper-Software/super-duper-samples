import { rmSync } from 'node:fs'
import { openDb, type DB } from '../../src/core/db/index'
import { onCleanup } from './cleanup'

/**
 * A second connection to a test core's database, so a test can assert on rows
 * the core wrote. Closed after the test.
 */
export function openTempDb(dbPath: string): DB {
  const db = openDb(dbPath)
  onCleanup(() => {
    db.close()
  })
  return db
}

/** `SELECT COUNT(*) FROM <table> [WHERE <where>]`. */
export function countRows(
  db: DB,
  table: string,
  where?: string,
  ...params: unknown[]
): number {
  const sql = `SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ''}`
  return (db.prepare(sql).get(...params) as { n: number }).n
}

/** The one row matching `where`, or `undefined`. */
export function getRow<T>(
  db: DB,
  table: string,
  where: string,
  ...params: unknown[]
): T | undefined {
  return db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(...params) as
    T | undefined
}

/** Every row matching `where`, unordered. */
export function getRows<T>(
  db: DB,
  table: string,
  where: string,
  ...params: unknown[]
): T[] {
  return db
    .prepare(`SELECT * FROM ${table} WHERE ${where}`)
    .all(...params) as T[]
}

/** Delete a SQLite database and its journal files — the "user lost the DB" case. */
export function deleteDatabaseFiles(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(dbPath + suffix, { force: true })
  }
}
