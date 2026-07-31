import { jsonResponse } from '../security/responseHeaders';
import type { SqlDatabase } from '../repositories/sessionRepository';

type HistoryClearEnv = {
  DB: SqlDatabase;
};

type WorkerModule<Env extends HistoryClearEnv> = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?: (
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) => Promise<void> | void;
};

const historyClearPath = /^\/api\/sessions\/([^/]+)\/clear-history$/;
const staleClaimSeconds = 60 * 60;

function historyClearConflict() {
  return jsonResponse(
    { error: 'history_clear_state_conflict' },
    { status: 409 },
  );
}

function dryRunRequest(req: Request) {
  const url = new URL(req.url);
  url.pathname += '/dry-run';
  return new Request(url, {
    method: 'POST',
    headers: req.headers,
  });
}

async function claimHistoryClear(
  env: HistoryClearEnv,
  sessionId: string,
  claimedAt: string,
) {
  const result = await env.DB.prepare(
    `UPDATE sessions
        SET history_clear_claimed_at=?,updated_at=?
      WHERE id=?
        AND purged_at IS NULL
        AND (
          deleted_at IS NOT NULL
          OR archived_at IS NOT NULL
          OR status IN ('ARCHIVED','CLOSED')
        )
        AND (
          history_clear_claimed_at IS NULL
          OR datetime(history_clear_claimed_at) <= datetime(?, '-' || ? || ' seconds')
        )`,
  ).bind(claimedAt, claimedAt, sessionId, claimedAt, staleClaimSeconds).run();
  return Number(result.meta?.changes || 0) === 1;
}

async function releaseHistoryClear(
  env: HistoryClearEnv,
  sessionId: string,
  claimedAt: string,
) {
  await env.DB.prepare(
    `UPDATE sessions
        SET history_clear_claimed_at=NULL
      WHERE id=? AND history_clear_claimed_at=?`,
  ).bind(sessionId, claimedAt).run();
}

export function createHistoryClearGuard<Env extends HistoryClearEnv>(
  inner: WorkerModule<Env>,
): WorkerModule<Env> {
  return {
    scheduled(controller, env, ctx) {
      return inner.scheduled?.(controller, env, ctx);
    },
    async fetch(req, env, ctx) {
      const match = req.method === 'POST'
        ? new URL(req.url).pathname.match(historyClearPath)
        : null;
      if (!match) return inner.fetch(req, env, ctx);

      const authorized = await inner.fetch(dryRunRequest(req), env, ctx);
      if (!authorized.ok) return authorized;

      const sessionId = decodeURIComponent(match[1]);
      const claimedAt = new Date().toISOString();
      if (!(await claimHistoryClear(env, sessionId, claimedAt))) {
        return historyClearConflict();
      }

      try {
        return await inner.fetch(req, env, ctx);
      } finally {
        try {
          await releaseHistoryClear(env, sessionId, claimedAt);
        } catch (error) {
          console.error('history clear claim release failed', {
            sessionId,
            error: String(error),
          });
        }
      }
    },
  };
}
