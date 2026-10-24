import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { verifyCsrf } from '@/lib/csrf';
import {
  transitionVisitStatus,
  IllegalTransitionError,
  VersionConflictError,
  OperatoryOccupiedError,
} from '@/lib/queue-service';
import { VisitAction } from '@/lib/visit-state-machine';
import { assertPlainInput } from '@/lib/validation';

export const POST = withAuth(async (req: NextRequest, auth, context?: any) => {
  const params = context?.params ? await context.params : {};
  const visitId = params.id;
  if (!visitId) {
    return NextResponse.json({ error: 'Visit ID is required' }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    assertPlainInput(body);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  const { action, expectedVersion } = body;
  if (!action || typeof expectedVersion !== 'number') {
    return NextResponse.json(
      { error: 'action and expectedVersion (number) are required' },
      { status: 400 }
    );
  }

  try {
    const updatedVisit = await transitionVisitStatus(
      auth.session.clinicId,
      visitId,
      action as VisitAction,
      expectedVersion,
      { type: 'USER', id: auth.user._id.toString() }
    );

    return NextResponse.json({
      success: true,
      visit: {
        id: updatedVisit._id.toString(),
        status: updatedVisit.status,
        version: updatedVisit.version,
      },
    });
  } catch (error: any) {
    if (
      error instanceof IllegalTransitionError ||
      error instanceof VersionConflictError ||
      error instanceof OperatoryOccupiedError ||
      error?.name === 'IllegalTransitionError' ||
      error?.name === 'VersionConflictError' ||
      error?.name === 'OperatoryOccupiedError'
    ) {
      return NextResponse.json(
        { error: error.message, conflict: true },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: error.message || 'Failed to update visit status' },
      { status: 500 }
    );
  }
});
