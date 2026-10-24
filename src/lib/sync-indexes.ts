import mongoose, { Model } from 'mongoose';
import {
  Clinic,
  User,
  Patient,
  Appointment,
  Visit,
  Medicine,
  DoctorMedicine,
  PrescriptionSet,
  Prescription,
  Treatment,
  Estimate,
  Bill,
  Payment,
  FollowUp,
  Counter,
  AuditLog,
  DeviceToken,
  RateLimit,
  Session,
  IdempotencyKey,
} from '../models';

export const ALL_MODELS: Model<any>[] = [
  Clinic,
  User,
  Patient,
  Appointment,
  Visit,
  Medicine,
  DoctorMedicine,
  PrescriptionSet,
  Prescription,
  Treatment,
  Estimate,
  Bill,
  Payment,
  FollowUp,
  Counter,
  AuditLog,
  DeviceToken,
  RateLimit,
  Session,
  IdempotencyKey,
];

export async function syncDatabaseIndexes(): Promise<Record<string, any>> {
  const results: Record<string, any> = {};

  for (const model of ALL_MODELS) {
    try {
      const res = await model.syncIndexes();
      results[model.modelName] = { success: true, details: res };
    } catch (error: any) {
      results[model.modelName] = { success: false, error: error.message };
    }
  }

  return results;
}

export async function getLiveAndDeclaredIndexes(model: Model<any>): Promise<{
  modelName: string;
  declared: any[];
  live: any[];
}> {
  const declared = model.schema.indexes();
  const live = await model.collection.indexes();
  return {
    modelName: model.modelName,
    declared,
    live,
  };
}
