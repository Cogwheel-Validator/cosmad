import {
  BLOB,
  type DuckDBConnection,
  DuckDBDataChunk,
  TIMESTAMP,
  TINYINT,
  UBIGINT,
  VARCHAR,
} from "@duckdb/node-api";
import type { Logger } from "pino";
import type { Result } from "../../../models/result";
import type { BlockWindowStats, ChainSignatureStats } from "../../analytics";
import type { Block } from "../../tables";
import { toError } from "../errors";
import { blockToRow, rowToBlock, rowToBlockWindowStats, rowToSignStats } from "../mappers";

const APPENDER_CHUNK_ROWS = 2048;

/**
 * appendBlocks appends an array of blocks to the database
 * @param chainId unique chain identification
 * @param blocks array of blocks to append
 * @returns promise wrapped result of the append
 */
export async function appendBlocks(
  conn: DuckDBConnection,
  log: Logger,
  chainId: string,
  blocks: Block[],
): Promise<Result<undefined, Error>> {
  log.debug("Appending %d blocks for %s to the database", blocks.length, chainId);
  log.info(
    "Inserting from %s to %s",
    blocks[0]?.height.toString(),
    blocks[blocks.length - 1]?.height.toString(),
  );
  const duckdbData = blocks.map((block) => blockToRow(block));
  try {
    const appender = await conn.createAppender("blocks");
    // A DuckDBDataChunk is capped at DuckDB's internal STANDARD_VECTOR_SIZE (2048 rows)
    // Split larger batches across multiple chunks on the same appender.
    for (let i = 0; i < duckdbData.length; i += APPENDER_CHUNK_ROWS) {
      const slice = duckdbData.slice(i, i + APPENDER_CHUNK_ROWS);
      const chunk = DuckDBDataChunk.create([VARCHAR, UBIGINT, BLOB, TIMESTAMP, TINYINT, BLOB]);
      chunk.setRows(
        slice.map((data) => [
          data.chainId,
          data.height,
          data.hash,
          data.time,
          data.signed,
          data.signature ?? null,
        ]),
      );
      appender.appendDataChunk(chunk);
    }
    appender.closeSync();
    log.info("Blocks appended successfully");
    return { ok: true, value: undefined };
  } catch (error) {
    log.error("Error appending blocks: %s", error);
    return { ok: false, error: toError(error) };
  }
}

/**
 * insertBlocks inserts an array of blocks into the database
 * @param chainId unique chain identification
 * @param blocks array of blocks to insert
 * @returns promise wrapped result of the insert
 */
export async function insertBlocks(
  conn: DuckDBConnection,
  log: Logger,
  chainId: string,
  blocks: Block[],
): Promise<Result<void, Error>> {
  log.debug("Inserting %d blocks for %s into the database", blocks.length, chainId);
  log.info(
    "Inserting from %s to %s",
    blocks[0]?.height.toString(),
    blocks[blocks.length - 1]?.height.toString(),
  );
  const duckdbData = blocks.map((block) => blockToRow(block));
  const placeholders = duckdbData.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
  const sql = `INSERT INTO blocks VALUES ${placeholders}`;
  const values = duckdbData.flatMap((data) => [
    data.chainId,
    data.height,
    data.hash,
    data.time,
    data.signed,
    data.signature ?? null,
  ]);
  try {
    const result = await conn.run(sql, values);
    log.debug("Insert result: %o", result);
    log.info("Blocks inserted successfully");
    return { ok: true, value: undefined };
  } catch (error) {
    log.error("Error inserting blocks: %s", error);
    return { ok: false, error: toError(error) };
  }
}

/**
 * latestBlock returns the latest block for the given chain
 * @param chainId unique chain identification
 * @param chainType the type of chain to get blocks for
 * @returns promise wrapped result of the latest block
 */
export async function latestBlock(
  conn: DuckDBConnection,
  log: Logger,
  chainId: string,
  chainType: "bft" | "tm2",
): Promise<Result<Block | null, Error>> {
  const sql = `
    SELECT
      chain_id,
      height,
      hash,
      time,
      signed,
      signature
    FROM blocks
    WHERE chain_id = ?
    ORDER BY height DESC LIMIT 1`;
  try {
    const result = await conn.runAndReadAll(sql, [chainId]);
    const row = result.getRowObjects(); // only 1 row
    if (row.length === 0) return { ok: true, value: null };
    return { ok: true, value: rowToBlock(row[0], chainType) };
  } catch (error) {
    log.error("Error getting latest block: %s", error);
    return { ok: false, error: toError(error) };
  }
}

/**
 * latestBlockHeight returns the latest block height for the given chain
 * @param chainId unique chain identification
 * @returns promise wrapped result of the latest block height
 */
export async function latestBlockHeight(
  conn: DuckDBConnection,
  log: Logger,
  chainId: string,
): Promise<Result<bigint | null, Error>> {
  const sql = `SELECT height FROM blocks WHERE chain_id = ? ORDER BY height DESC LIMIT 1`;
  try {
    const result = await conn.runAndReadAll(sql, [chainId]);
    const rows = result.getRows();
    if (rows.length === 0) {
      return { ok: true, value: null };
    }
    return { ok: true, value: rows[0][0] as bigint };
  } catch (error) {
    log.error("Error getting latest block height: %s", error);
    return { ok: false, error: toError(error) };
  }
}

/**
 * getChainSignedPercentage returns a promise wrapped result of the chain's signed percentage
 * @param chainId a unique id for the chain
 * @param days an integer number of days to look back
 * @returns a promise wrapped result of the chain's signed percentage
 */
export async function getChainSignedPercentage(
  conn: DuckDBConnection,
  log: Logger,
  chainId: string,
  days: number,
): Promise<Result<ChainSignatureStats | null, Error>> {
  const sql = `
    WITH current_time AS (
      SELECT current_timestamp() as now
    ),
    missed AS (
      SELECT count() * 1.0 as missed
      FROM blocks
      CROSS JOIN current_time
      WHERE chain_id = ? AND time >= current_time.now - INTERVAL '? days' AND time <= current_time.now
    ),
    total AS (
      SELECT count() * 1.0 as total
      FROM blocks
      CROSS JOIN current_time
      WHERE chain_id = ? AND time >= current_time.now - INTERVAL '? days' AND time <= current_time.now
    )
    SELECT
      (t.total - m.missed) / t.total as signed,
      m.missed / t.total as missed
    FROM total t
    CROSS JOIN missed m`;
  try {
    const result = await conn.run(sql, [chainId, days, chainId, days]);
    const row = await result.getRowObjects(); // only one row
    if (row.length === 0) return { ok: true, value: null };
    return { ok: true, value: rowToSignStats(row[0]) };
  } catch (error) {
    log.error("Error getting chain signed percentage: %s", error);
    return { ok: false, error: toError(error) };
  }
}

/**
 * getBlockByHeight returns a promise wrapped result of the block at the given height
 * @param chainId id specific to that chain
 * @param height a height to get the block for
 * @param chainType the type of chain to get blocks for
 * @returns a promise wrapped result of the block at the given height
 */
export async function getBlockByHeight(
  conn: DuckDBConnection,
  log: Logger,
  chainId: string,
  height: bigint,
  chainType: "bft" | "tm2",
): Promise<Result<Block | null, Error>> {
  const sql = `
    SELECT
      chain_id,
      height,
      hash,
      time,
      signed,
      signature
    FROM blocks
    WHERE
      chain_id = ? AND height = ?`;
  try {
    const result = await conn.run(sql, [chainId, height]);
    const row = await result.getRowObjects(); // only one row
    if (row.length === 0) return { ok: true, value: null };
    return { ok: true, value: rowToBlock(row[0], chainType) };
  } catch (error) {
    log.error("Error getting block by height: %s", error);
    return { ok: false, error: toError(error) };
  }
}

/**
 * getBlockByRange returns a promise wrapped result of the blocks in the range
 * @param chainId a id that is unique to that chain
 * @param startHeight a height to start the range from
 * @param endHeight a height to end the range at
 * @param chainType the type of chain to get blocks for
 * @returns a promise wrapped result of the blocks in the range
 */
export async function getBlockByRange(
  conn: DuckDBConnection,
  log: Logger,
  chainId: string,
  startHeight: bigint,
  endHeight: bigint,
  chainType: "bft" | "tm2",
): Promise<Result<Block[], Error>> {
  const sql = `
    SELECT
      chain_id,
      height,
      hash,
      time,
      signed,
      signature
    FROM blocks
    WHERE
      chain_id = ? AND height >= ? AND height <= ?`;
  try {
    const result = await conn.run(sql, [chainId, startHeight, endHeight]);
    const rows = await result.getRowObjects();
    return { ok: true, value: rows.map((row) => rowToBlock(row, chainType)) };
  } catch (error) {
    log.error("Error getting block by range: %s", error);
    return { ok: false, error: toError(error) };
  }
}

/**
 * Aggregate total/missed counts over a height range.
 * Used for percentageMissedBlocksAlert so a wide signing window never needs every row pulled
 * across the wire, just two counts.
 * @param chainId the chain ID to query
 * @param startHeight the start height of the range
 * @param endHeight the end height of the range
 * @returns a result containing the aggregated stats or an error
 */
export async function getBlockStats(
  conn: DuckDBConnection,
  log: Logger,
  chainId: string,
  startHeight: bigint,
  endHeight: bigint,
): Promise<Result<BlockWindowStats, Error>> {
  const sql = `
    SELECT
      count(*) FILTER (WHERE signed != -1) as total,
      count(*) FILTER (WHERE signed = 0) as missed
    FROM blocks
    WHERE chain_id = ? AND height >= ? AND height <= ?`;
  try {
    const result = await conn.run(sql, [chainId, startHeight, endHeight]);
    const rows = await result.getRowObjects();
    return { ok: true, value: rowToBlockWindowStats(rows[0] ?? { total: 0, missed: 0 }) };
  } catch (error) {
    log.error("Error getting block stats: %s", error);
    return { ok: false, error: toError(error) };
  }
}
