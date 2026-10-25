import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { connectDb } from '@/lib/db';
import { Patient } from '@/models/Patient';
import { Types } from 'mongoose';

export const GET = withAuth(async (req: NextRequest, { session }) => {
  await connectDb();
  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() || '';

  const clinicObjectId = new Types.ObjectId(session.clinicId);
  const query: Record<string, unknown> = {
    clinicId: clinicObjectId,
    deletedAt: null,
  };

  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    query.$or = [{ name: regex }, { phone: regex }, { patientCode: regex }];
  }

  const patients = await Patient.find(query)
    .sort({ createdAt: -1 })
    .limit(30)
    .select('_id name phone patientCode sex ageYears dob');

  return NextResponse.json({
    patients: patients.map((p) => ({
      _id: p._id.toString(),
      name: p.name,
      phone: p.phone,
      patientCode: p.patientCode,
      sex: p.sex,
      ageYears: p.ageYears,
      dob: p.dob,
    })),
  });
}, { roles: ['DOCTOR', 'STAFF', 'ADMIN'] });
