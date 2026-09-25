// MongoDB connection (serverless ke liye global cache)
const { MongoClient } = require('mongodb');

const config = require('../config');

const MONGODB_URI = process.env.MONGODB_URI || config.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || config.MONGODB_DB || 'filebot';

let mongoPromise = global._mongoClientPromise;

async function getDb() {
  if (!MONGODB_URI || MONGODB_URI.startsWith('YAHAN_')) throw new Error('config.js mein MONGODB_URI nahi daala');
  if (!mongoPromise) {
    const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
    mongoPromise = global._mongoClientPromise = client.connect().then(async (c) => {
      const uploads = c.db(MONGODB_DB).collection('uploads');
      await uploads.createIndex({ userId: 1, createdAt: -1 }).catch(() => {});
      await uploads
        .createIndex({ key: 1 }, { unique: true, partialFilterExpression: { key: { $exists: true } } })
        .catch(() => {});
      return c;
    });
    mongoPromise.catch(() => {
      mongoPromise = global._mongoClientPromise = null; // agli baar dobara try
    });
  }
  const client = await mongoPromise;
  return client.db(MONGODB_DB);
}

module.exports = { getDb };
