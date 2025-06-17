// This file handles the PostgreSQL database initialization and operations.
const { Pool } = require('pg');

// Create a new Pool instance for PostgreSQL connection
// For Render deployment, DATABASE_URL will be automatically set by Render
// For local development, it will be loaded from the .env file by dotenv
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Access directly from process.env
  ssl: {
    rejectUnauthorized: false
  }
});

// Test the connection
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error acquiring client from pool', err.stack);
  }
  client.query('SELECT NOW()', (err, result) => {
    release();
    if (err) {
      return console.error('Error executing query', err.stack);
    }
    console.log('Connected to PostgreSQL database successfully:', result.rows[0].now);
  });
});

// Function to initialize the database schema for PostgreSQL
const initializePgSchema = async () => {
  try {
    // Removed DROP TABLE statements to prevent data loss on restart
    // await pool.query(`DROP TABLE IF EXISTS sets CASCADE`);
    // await pool.query(`DROP TABLE IF EXISTS exercises CASCADE`);
    // await pool.query(`DROP TABLE IF EXISTS workouts CASCADE`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS workouts (
        id SERIAL PRIMARY KEY,
        day TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT,
        ai_tips TEXT
      );
    `);
    console.log('Workouts table created or already exists (PostgreSQL).');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS exercises (
        id SERIAL PRIMARY KEY,
        workout_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        target_muscles TEXT,
        machine TEXT,
        attachments TEXT,
        FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE
      );
    `);
    console.log('Exercises table created or already exists (PostgreSQL).');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sets (
        id SERIAL PRIMARY KEY,
        exercise_id INTEGER NOT NULL,
        reps INTEGER NOT NULL,
        weight REAL NOT NULL,
        unit TEXT CHECK(unit IN ('kg', 'lbs')) NOT NULL,
        ai_tips TEXT,
        FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
      );
    `);
    console.log('Sets table created or already exists (PostgreSQL).');

  } catch (err) {
    console.error('Error initializing PostgreSQL schema:', err.message);
  }
};

module.exports = {
  pool,
  initializePgSchema
};