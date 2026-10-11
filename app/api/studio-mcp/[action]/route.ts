import { NextRequest, NextResponse } from 'next/server';
import { registerEditorClient, unregisterEditorClient, touchEditorClient, waitForEditorCommand, resolveEditorCommand, onlineEditorClients, requestFromEditor } from '@/lib/mcp/bridge';
import { studioMcpTokenMatches } from '@/lib/mcp/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ action: string }> };

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin) return new URL(origin).host === request.headers.get('host');
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { action } = await context.params;
  if (action === 'health') return NextResponse.json({ online: true, connectedEditors: onlineEditorClients() }, { headers: { 'Cache-Control': 'no-store' } });
  if (action !== 'poll' || !sameOrigin(request)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const sessionId = request.nextUrl.searchParams.get('sessionId') ?? '';
  if (!touchEditorClient(sessionId)) return NextResponse.json({ error: 'editor_session_expired' }, { status: 410 });
  const command = await waitForEditorCommand(sessionId);
  return command ? NextResponse.json(command, { headers: { 'Cache-Control': 'no-store' } }) : new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { action } = await context.params;
  if (action === 'dispatch') {
    if (!await studioMcpTokenMatches(request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => null) as { operation?: unknown; payload?: unknown } | null;
    if (!body || typeof body.operation !== 'string' || body.operation.length > 80) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    try {
      return NextResponse.json({ result: await requestFromEditor('mcp', body.operation, body.payload) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Editor operation failed' }, { status: 503 });
    }
  }
  if (!sameOrigin(request)) return NextResponse.json({ error: 'origin_rejected' }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  if (action === 'register') {
    const sessionId = crypto.randomUUID();
    registerEditorClient(sessionId);
    return NextResponse.json({ sessionId }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (action === 'unregister') {
    if (typeof body.sessionId === 'string') unregisterEditorClient(body.sessionId);
    return NextResponse.json({ ok: true });
  }
  if (action === 'reply') {
    if (typeof body.sessionId !== 'string' || !touchEditorClient(body.sessionId) || typeof body.requestId !== 'string') return NextResponse.json({ error: 'editor_session_expired' }, { status: 410 });
    resolveEditorCommand(body.requestId, body.result, typeof body.error === 'string' ? body.error : undefined);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}
