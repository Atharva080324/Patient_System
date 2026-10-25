import { Metadata } from 'next';
import ConsultClient from './consult-client';

export const metadata: Metadata = {
  title: 'Consultation & Prescription | Dr. Susheel Dental Clinic',
  description: 'Doctor consultation workspace, case sheet recording, and prescription generation.',
};

export default async function ConsultPage({
  params,
}: {
  params: Promise<{ visitId: string }>;
}) {
  const { visitId } = await params;
  return <ConsultClient visitId={visitId} />;
}
