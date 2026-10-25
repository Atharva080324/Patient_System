import { Metadata } from 'next';
import PrintPrescriptionClient from './print-client';

export const metadata: Metadata = {
  title: 'Print Prescription | Dr. Susheel Dental Clinic',
  description: 'Official clinical prescription print and reprint view.',
};

export default async function PrintPrescriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PrintPrescriptionClient prescriptionId={id} />;
}
