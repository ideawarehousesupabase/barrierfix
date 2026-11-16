// Makes a Mongoose schema insert-only: updates and deletes throw, so history cannot be rewritten.
export function makeAppendOnly(schema, label) {
  const blockChange = function blockChange() {
    throw new Error(`${label} is append-only`);
  };
  for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
    schema.pre(op, blockChange);
  }
  schema.pre('save', function onlyInsert(next) {
    if (!this.isNew) return next(new Error(`${label} is append-only`));
    return next();
  });
}
