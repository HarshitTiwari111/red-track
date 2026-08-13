import mongoose from 'mongoose';
import config from '../config/env.js';
import logger from '../utils/logger.js';

export async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
  });
  logger.info(`MongoDB connected: ${mongoose.connection.name}`);
  return mongoose.connection;
}

export function dbState() {
  // 0 disconnected, 1 connected, 2 connecting, 3 disconnecting
  const map = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return map[mongoose.connection.readyState] || 'unknown';
}

export default connectDb;
