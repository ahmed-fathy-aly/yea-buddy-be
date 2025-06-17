// populate_db.js
// This script will populate the PostgreSQL database with data from workouts_data.json
// by sending POST requests to your Node.js server.

const fs = require('fs').promises; // For file system operations
const path = require('path');
// const fetch = require('node-fetch'); // Removed: Node.js v18+ has native fetch

const workoutsDataPath = path.resolve(__dirname, 'workouts_data.json');
const API_URL = 'http://localhost:3000/workouts'; // Your server's workout endpoint

const populateDatabase = async () => {
  try {
    // IMPORTANT: Ensure your Node.js backend server (app.js) is running
    // and connected to your PostgreSQL database BEFORE running this script.
    console.log("Please ensure your Node.js server (app.js) is running and connected to PostgreSQL.");
    console.log("Press Enter to continue populating the database...");
    await new Promise(resolve => {
        process.stdin.once('data', () => {
            resolve();
        });
    });

    // Read the workouts data from the JSON file
    const data = await fs.readFile(workoutsDataPath, 'utf8');
    const workouts = JSON.parse(data);
    console.log(`Read ${workouts.length} workouts from ${workoutsDataPath}`);

    // Send each workout as a POST request to the server
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
    process.exit(0); // Ensure the script exits
  }
};

populateDatabase();
