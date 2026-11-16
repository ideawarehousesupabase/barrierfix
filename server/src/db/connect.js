import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { config } from '../config/env.js';

let memoryServer = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// MONGODB_URI=memory starts an embedded MongoDB for local development, saved to
// server/.data/mongo so data survives restarts. Production uses MongoDB Atlas.
async function startEmbeddedMongo() {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const dbPath = path.join(config.dataDir, 'mongo');
  fs.mkdirSync(dbPath, { recursive: true });
  let lastError;
  // A restart (node --watch) can race the previous mongod releasing its lock file.
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      memoryServer = await MongoMemoryServer.create({
        instance: { dbPath, storageEngine: 'wiredTiger', port: 27027 },
      });
      console.log(`[db] embedded MongoDB running, data saved in ${dbPath}`);
      return memoryServer.getUri('barrierfix');
    } catch (err) {
      lastError = err;
      await sleep(1500);
    }
  }
  throw lastError;
}

export async function connectDatabase(uri = config.mongoUri) {
  const target = uri === 'memory' ? await startEmbeddedMongo() : uri;
  mongoose.set('strictQuery', true);
  await mongoose.connect(target, { serverSelectionTimeoutMS: 15000 });
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop({ doCleanup: false });
    memoryServer = null;
  }
}
