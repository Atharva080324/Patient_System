import { Schema } from 'mongoose';

export class AppendOnlyViolationError extends Error {
  constructor(message = 'Append-only collection violation: modifications and deletions are strictly prohibited.') {
    super(message);
    this.name = 'AppendOnlyViolationError';
  }
}

/**
 * Mongoose plugin that strictly blocks any update, replace, or delete operations on a collection.
 * Ensures the collection remains 100% append-only and immutable.
 */
export function appendOnlyPlugin(schema: Schema): void {
  // Block saving existing documents
  schema.pre('save', function () {
    if (!this.isNew) {
      throw new AppendOnlyViolationError(
        'Cannot update an existing document in an append-only collection.'
      );
    }
  });

  // Query middleware to block all update and delete mutations
  const blockedQueryOps = [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
    'findOneAndReplace',
  ] as const;

  for (const op of blockedQueryOps) {
    schema.pre(op as any, function () {
      throw new AppendOnlyViolationError(
        `Operation "${op}" is prohibited on this append-only collection.`
      );
    });
  }
}
