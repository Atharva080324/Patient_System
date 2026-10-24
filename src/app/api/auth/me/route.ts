import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { Clinic } from '@/models/Clinic';

export const GET = withAuth(async (req: NextRequest, auth) => {
  const clinic = await Clinic.findById(auth.user.clinicId);

  return NextResponse.json({
    user: {
      id: auth.user._id.toString(),
      name: auth.user.name,
      email: auth.user.email,
      role: auth.user.role,
      totpEnabled: auth.user.totpEnabled,
    },
    clinic: clinic
      ? {
          id: clinic._id.toString(),
          name: clinic.name,
          phone: clinic.phone,
          email: clinic.email,
          registrationNo: clinic.registrationNo,
          paperSize: clinic.paperSize,
          timezone: clinic.timezone,
        }
      : null,
  });
});
