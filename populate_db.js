// populate_db.js
// This script will populate the PostgreSQL database with data from workouts_data.json
// by sending POST requests to your Node.js server.

require('dotenv').config(); // NEW: Load environment variables from .env file

const fs = require('fs').promises;
const path = require('path');

const workoutsDataPath = path.resolve(__dirname, 'workouts_data.json');
// API_URL will be read from environment variable or default to localhost
const API_URL = process.env.API_URL || 'http://localhost:3000/workouts'; 

const populateDatabase = async () => {
  try {
    console.log("Please ensure your Node.js server (app.js) is running and connected to PostgreSQL.");
    console.log(`Using API_URL: ${API_URL}`);
    console.log("Press Enter to continue populating the database...");
    await new Promise(resolve => {
        process.stdin.once('data', () => {
            resolve();
        });
    });

    const data = await fs.readFile(workoutsDataPath, 'utf8');
    const workouts = JSON.parse(data);
    console.log(`Read ${workouts.length} workouts from ${workoutsDataPath}`);

    for (const workout of workouts) {
      console.log(`Attempting to add workout: ${workout.day} - ${workout.title}`);
      try {
        const response = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(workout),
        });

        const result = await response.json();

        if (response.ok) {
          console.log(`Successfully added workout: ${workout.title}. Server response:`, result);
        } else {
          console.error(`Failed to add workout: ${workout.title}. Status: ${response.status}. Error:`, result);
        }
      } catch (postError) {
        console.error(`Error sending POST request for workout ${workout.title}:`, postError.message);
      }
    }
    console.log('\nDatabase population process completed.');

  } catch (error) {
    console.error('An error occurred during database population:', error.message);
  } finally {
    process.exit(0);
  }
};

populateDatabase();