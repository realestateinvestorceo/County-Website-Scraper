/**
 * GET /api/errors — Retrieve recent error log entries.
 * DELETE /api/errors — Clear the error log.
 */
import { NextResponse } from 'next/server';
import { getErrors, clearErrors } from '@/lib/errorLog';

export async function GET() {
  return NextResponse.json({ errors: getErrors() });
}

export async function DELETE() {
  clearErrors();
  return NextResponse.json({ cleared: true });
}
