require('dotenv').config();

const express = require('express');
const { pool, initializePgSchema } = require('./database');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());


// Utility: Kill process on port (for localhost dev only)
const killProcessOnPort = (port) => {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    exec(`lsof -t -i :${port}`, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 1) {
          console.log(`No process found on port ${port}.`);
          return resolve();
        }
        console.error(`Error finding process on port ${port}: ${stderr}`);
        return reject(err);
      }
      const pid = stdout.trim();
      if (pid) {
        exec(`kill -9 ${pid}`, (err, stdout, stderr) => {
          if (err) {
            console.error(`Error killing process ${pid} on port ${port}: ${stderr}`);
            return reject(err);
          }
          console.log(`Process ${pid} on port ${port} killed successfully.`);
          resolve();
        });
      } else {
        console.log(`No process found on port ${port}.`);
        resolve();
      }
    });
  });
};

// Route registration
app.use('/workouts', require('./routes/workouts'));
app.use('/workouts', require('./routes/workoutsToday'));
app.use('/workouts', require('./routes/createWorkout'));
app.use('/workouts', require('./routes/updateWorkout'));
app.use('/workouts', require('./routes/deleteWorkout'));
app.use('/exercise-tips', require('./routes/exerciseTips'));
app.use('/suggest-workout', require('./routes/suggestWorkout'));
app.use('/replace-workout', require('./routes/replaceWorkout'));
app.use('/suggest-rest-time', require('./routes/suggestRestTime'));

const startServer = async () => {
  try {
    // Kill process on port 3000 if running locally (not on Render)
    if (!process.env.RENDER) {
      await killProcessOnPort(port);
    }
    await initializePgSchema();
    app.listen(port, () => {
      console.log(`Workout tracker API listening on port ${port}`);
      console.log('Access the API via its public URL if deployed, or http://localhost:3000 locally.');
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();

process.on('SIGINT', async () => {
  try {
    await pool.end();
    console.log('PostgreSQL connection pool closed.');
    process.exit(0);
  } catch (err) {
    console.error('Error closing PostgreSQL connection pool:', err.message);
    process.exit(1);
  }
});