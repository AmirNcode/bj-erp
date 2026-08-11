import { NextResponse } from 'next/server';

/**
 * Container/orchestrator liveness endpoint.
 *
 * This intentionally does not query Postgres: database and Auth health are
 * checked independently by the deployment scripts, so a failure points to the
 * service that actually needs attention.
 */
export function GET() {
  return NextResponse.json(
    { status: 'ok', service: 'bj-erp-app' },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
