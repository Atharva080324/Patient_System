import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { RateLimitRules } from '@/lib/rate-limit';
import { verifyPassword } from '@/lib/passwords';
import { clock } from '@/lib/clock';
import { clinicDate } from '@/lib/date';
import { audit } from '@/lib/audit';
import { AuditAction } from '@/models/AuditLog';
import { searchPatients, PatientSearchOptions } from '@/lib/patient-search-service';
import { generatePatientsCsv, formatAgeDisplay } from '@/lib/csv-writer';

export const POST = withAuth(
  async (req: NextRequest, { session, user }) => {
    await connectDb();

    // 1. Rate limiting
    const rl = await RateLimitRules.patientExport(
      session.userId.toString(),
      session.clinicId.toString()
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many export requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    const body = await req.json().catch(() => ({}));

    // 2. Fresh password confirmation check (5 minutes)
    const now = clock.now();
    const fiveMinutesMs = 5 * 60 * 1000;
    const isFresh =
      session.recentPasswordConfirmAt &&
      now.getTime() - session.recentPasswordConfirmAt.getTime() <= fiveMinutesMs;

    if (!isFresh) {
      if (body.password && typeof body.password === 'string') {
        const valid = await verifyPassword(user.passwordHash, body.password);
        if (!valid) {
          return NextResponse.json(
            { error: 'Invalid password. Password confirmation failed.' },
            { status: 403 }
          );
        }
        session.recentPasswordConfirmAt = now;
        await session.save();
      } else {
        return NextResponse.json(
          { error: 'Fresh password confirmation required (valid for 5 minutes).' },
          { status: 403 }
        );
      }
    }

    // 3. Search options with 20k cap check
    const searchOptions: PatientSearchOptions = {
      clinicId: session.clinicId,
      q: body.q,
      sortBy: body.sortBy,
      sortOrder: body.sortOrder,
      hasBalance: body.hasBalance,
      hasFollowUpDue: body.hasFollowUpDue,
      source: body.source,
      lastVisitFrom: body.lastVisitFrom,
      lastVisitTo: body.lastVisitTo,
      page: 1,
      pageSize: 20000,
    };

    const result = await searchPatients(searchOptions);

    if (result.total > 20000) {
      return NextResponse.json(
        {
          error: `Export exceeds 20,000 row cap (found ${result.total} matching records). Please narrow down your search filters.`,
        },
        { status: 400 }
      );
    }

    // 4. Audit PATIENT_EXPORT with row count and filter field names ONLY
    const appliedFilterKeys = Object.keys(body).filter(
      (k) =>
        k !== 'password' &&
        body[k] !== undefined &&
        body[k] !== null &&
        body[k] !== '' &&
        body[k] !== false
    );

    await audit.record({
      clinicId: session.clinicId,
      action: AuditAction.PATIENT_EXPORT,
      entity: 'Patient',
      entityId: 'csv_export',
      actor: { type: 'USER', id: session.userId.toString() },
      meta: {
        rowCount: result.patients.length,
        filterFieldNames: appliedFilterKeys,
      },
    });

    // 5. Generate CSV with BOM, CRLF, RFC 4180 quoting, formula injection neutralization
    const exportRows = result.patients.map((p) => ({
      patientCode: p.patientCode,
      name: p.name,
      ageDisplay: formatAgeDisplay({ ageYears: p.ageYears, dob: p.dob, createdAt: p.createdAt }),
      sex: p.sex,
      phone: p.phone,
      source: p.source,
      registeredDate: p.createdAt ? p.createdAt.slice(0, 10) : '',
      lastVisitDate: p.lastVisitDate ? p.lastVisitDate.slice(0, 10) : '',
      visitCount: p.visitCount,
      outstandingBalancePaise: p.outstandingBalancePaise || 0,
    }));
    const csvContent = generatePatientsCsv(exportRows);
    const dateStr = clinicDate(clock.now());
    const filename = `patients-${dateStr}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  },
  { roles: ['DOCTOR'] }
);
