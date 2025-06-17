// This is the main application file, setting up the Express server and API endpoints.
// Create a file named 'app.js' with this content.
const express = require('express');
const { pool, initializePgSchema } = require('./database'); // Import pool and init function
const { exec } = require('child_process');
const config = require('./config');
const cors = require('cors');

const app = express();
const port = 3000;

// Middleware
app.use(express.json());
app.use(cors()); // Enable CORS

// Helper function to run a SQL query that returns a single row
const getAsync = async (sql, params = []) => {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows[0]; // Return the first row
  } finally {
    client.release();
  }
};

// Helper function to run a SQL query that returns multiple rows
const allAsync = async (sql, params = []) => {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows; // Return all rows
  } finally {
    client.release();
  }
};

// Helper function to run a SQL query (e.g., INSERT, UPDATE, DELETE)
const runAsync = async (sql, params = []) => {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return { changes: result.rowCount, lastID: result.rows[0]?.id }; // For INSERT, result.rows[0].id will give last inserted ID
  } finally {
    client.release();
  }
};


// Function to kill a process on a given port (remains the same as it's OS-specific)
const killProcessOnPort = (port) => {
  return new Promise((resolve, reject) => {
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

// Helper function to format workout data as text (remains the same)
const formatWorkoutAsText = (workout) => {
  let text = `\n--- Suggested Workout for ${workout.day || 'Today'} ---\n`;
  text += `Title: ${workout.title}\n`;
  if (workout.subtitle) {
    text += `Subtitle: ${workout.subtitle}\n`;
  }
  if (workout.ai_tips) {
    text += `AI Tips (Workout): ${workout.ai_tips}\n`;
  }
  text += '------------------------------------\n';

  if (workout.exercises && workout.exercises.length > 0) {
    workout.exercises.forEach((exercise, exIndex) => {
      text += `\nExercise ${exIndex + 1}: ${exercise.name}\n`;
      text += `  Target Muscles: ${exercise.target_muscles || 'N/A'}\n`;
      text += `  Machine: ${exercise.machine || 'N/A'}\n`;
      if (exercise.attachments) {
        text += `  Attachments: ${exercise.attachments}\n`;
      }
      if (exercise.sets && exercise.sets.length > 0) {
        text += '  Sets:\n';
        exercise.sets.forEach((set, setIndex) => {
          text += `    Set ${setIndex + 1}: ${set.reps} reps @ ${set.weight} ${set.unit}`;
          if (set.ai_tips) {
            text += ` - Tips: ${set.ai_tips}\n`;
          } else {
            text += `\n`;
          }
        });
      } else {
        text += '  No sets logged for this exercise.\n';
      }
    });
  } else {
    text += 'No exercises suggested for this workout.\n';
  }
  text += '------------------------------------\n';
  return text;
};


// -------------------- API Endpoints --------------------

// GET all workouts with full details
app.get('/workouts', async (req, res) => {
  try {
    const workouts = await allAsync('SELECT * FROM workouts');
    const allWorkoutDetails = [];

    for (const workout of workouts) {
      const exercises = await allAsync('SELECT * FROM exercises WHERE workout_id = $1', [workout.id]);
      const workoutWithExercises = { ...workout, exercises: [] };

      for (const exercise of exercises) {
        const sets = await allAsync('SELECT * FROM sets WHERE exercise_id = $1', [exercise.id]);
        workoutWithExercises.exercises.push({ ...exercise, sets });
      }
      allWorkoutDetails.push(workoutWithExercises);
    }
    res.json(allWorkoutDetails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NEW ENDPOINT: GET today's workout
app.get('/workouts/today', async (req, res) => {
  try {
    const today = new Date().toDateString();
    const workout = await getAsync('SELECT * FROM workouts WHERE day = $1', [today]);

    if (!workout) {
      return res.status(404).json({ message: `No workout found for today (${today}).` });
    }

    const exercises = await allAsync('SELECT * FROM exercises WHERE workout_id = $1', [workout.id]);
    const workoutDetails = { ...workout, exercises: [] };

    for (const exercise of exercises) {
      const sets = await allAsync('SELECT * FROM sets WHERE exercise_id = $1', [exercise.id]);
      workoutDetails.exercises.push({ ...exercise, sets });
    }

    res.json(workoutDetails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// POST a new workout
app.post('/workouts', async (req, res) => {
  const { day, title, subtitle, exercises } = req.body;

  if (!day || !title) {
    return res.status(400).json({ error: 'Day and title are required for a workout.' });
  }

  try {
    const workoutResult = await runAsync('INSERT INTO workouts (day, title, subtitle, ai_tips) VALUES ($1, $2, $3, $4) RETURNING id', [day, title, subtitle, req.body.ai_tips || null]);
    const workoutId = workoutResult.lastID;

    if (exercises && Array.isArray(exercises)) {
      for (const exercise of exercises) {
        const { name, target_muscles, machine, attachments, sets } = exercise;
        if (!name) continue;

        const exerciseResult = await runAsync(
          'INSERT INTO exercises (workout_id, name, target_muscles, machine, attachments) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [workoutId, name, target_muscles, machine, attachments]
        );
        const exerciseId = exerciseResult.lastID;

        if (sets && Array.isArray(sets)) {
          for (const set of sets) {
            const { reps, weight, unit, ai_tips } = set;
            if (typeof reps !== 'number' || typeof weight !== 'number' || !['kg', 'lbs'].includes(unit)) {
              console.warn(`Skipping invalid set for exercise ${name}:`, set);
              continue;
            }
            await runAsync('INSERT INTO sets (exercise_id, reps, weight, unit, ai_tips) VALUES ($1, $2, $3, $4, $5) RETURNING id', [exerciseId, reps, weight, unit, ai_tips || null]);
          }
        }
      }
    }

    res.status(201).json({ message: 'Workout created successfully', workoutId: workoutId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT (Update) an existing workout
app.put('/workouts/:id', async (req, res) => {
  const workoutId = req.params.id;
  const { day, title, subtitle, exercises } = req.body;

  try {
    const updateWorkoutSql = 'UPDATE workouts SET day = $1, title = $2, subtitle = $3, ai_tips = $4 WHERE id = $5';
    const workoutUpdateResult = await runAsync(updateWorkoutSql, [day, title, subtitle, req.body.ai_tips || null, workoutId]);

    if (workoutUpdateResult.changes === 0) {
      return res.status(404).json({ message: 'Workout not found or no changes made' });
    }

    // Delete existing exercises and sets for this workout
    await runAsync('DELETE FROM sets WHERE exercise_id IN (SELECT id FROM exercises WHERE workout_id = $1)', [workoutId]);
    await runAsync('DELETE FROM exercises WHERE workout_id = $1', [workoutId]);

    if (exercises && Array.isArray(exercises)) {
      for (const exercise of exercises) {
        const { name, target_muscles, machine, attachments, sets } = exercise;
        if (!name) continue;

        const exerciseResult = await runAsync(
          'INSERT INTO exercises (workout_id, name, target_muscles, machine, attachments) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [workoutId, name, target_muscles, machine, attachments]
        );
        const exerciseId = exerciseResult.lastID;

        if (sets && Array.isArray(sets)) {
          for (const set of sets) {
            const { reps, weight, unit, ai_tips: set_ai_tips } = set;
            if (typeof reps !== 'number' || typeof weight !== 'number' || !['kg', 'lbs'].includes(unit)) {
              console.warn(`Skipping invalid set for exercise ${name}:`, set);
              continue;
            }
            await runAsync('INSERT INTO sets (exercise_id, reps, weight, unit, ai_tips) VALUES ($1, $2, $3, $4, $5) RETURNING id', [exerciseId, reps, weight, unit, set_ai_tips || null]);
          }
        }
      }
    }

    res.json({ message: 'Workout updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE a workout
app.delete('/workouts/:id', async (req, res) => {
  const workoutId = req.params.id;
  try {
    const result = await runAsync('DELETE FROM workouts WHERE id = $1', [workoutId]);
    if (result.changes === 0) {
      return res.status(404).json({ message: 'Workout not found' });
    }
    res.json({ message: 'Workout deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Refactored helper functions for suggest-workout API
/**
 * Fetches all workout data, including exercises and their sets, from the database.
 * @returns {Array<Object>} An array of workout objects with nested exercises and sets.
 */
const fetchAllWorkoutData = async () => {
  const workouts = await allAsync('SELECT * FROM workouts');
  const allWorkoutDetails = [];

  for (const workout of workouts) {
    const exercises = await allAsync('SELECT * FROM exercises WHERE workout_id = $1', [workout.id]);
    const workoutWithExercises = { ...workout, exercises: [] };

    for (const exercise of exercises) {
      const sets = await allAsync('SELECT * FROM sets WHERE exercise_id = $1', [exercise.id]);
      workoutWithExercises.exercises.push({ ...exercise, sets });
    }
    allWorkoutDetails.push(workoutWithExercises);
  }
  return allWorkoutDetails;
};

/**
 * Builds the prompt string for the Gemini API based on past workout data and additional user input.
 * @param {Array<Object>} allWorkoutDetails - The fetched workout data.
 * @param {string} [additional_input] - Optional additional instructions from the user.
 * @returns {string} The complete prompt string.
 */
const buildGeminiPrompt = (allWorkoutDetails, additional_input) => {
  let prompt = `Based on the following past workout data, suggest a workout plan for today.
    The suggestion MUST be returned as a JSON object strictly following this schema:
    {
      "day": "STRING (e.g., Monday, June 17th, 2025)",
      "title": "STRING (e.g., Leg Day)",
      "subtitle": "STRING (optional, e.g., Focus on strength)",
      "exercises": [
        {
          "name": "STRING (e.g., Barbell Squats)",
          "target_muscles": "STRING (e.g., Quadriceps, Glutes)",
          "machine": "STRING (e.g., Squat Rack, Dumbbells, Bodyweight)",
          "attachments": "STRING (optional, e.g., Barbell, Resistance Band)",
          "sets": [
            { "reps": "NUMBER", "weight": "NUMBER (always 0, user will fill actual weight)", "unit": "STRING (either 'kg' or 'lbs')", "ai_tips": "STRING (optional, e.g., Focus on slow eccentric)" }
          ]
        }
      ],
      "ai_tips": "STRING (optional, overall tips for the workout)"
    }
    For each exercise, and for each set within an exercise, include a brief 'ai_tips' field with relevant suggestions (e.g., proper form, common mistakes, intensity cues). **IMPORTANT: Set the 'weight' field to 0 for all suggested sets; the user will determine their actual working weight.**
    For the overall workout, provide an 'ai_tips' field with general advice or focus.
    Ensure all fields are correctly populated and units are 'kg' or 'lbs'.
    If no exercises are suggested, provide an empty array for 'exercises'.
    DO NOT include any conversational text outside the JSON.

    Past Workout Data:
    ${JSON.stringify(allWorkoutDetails, null, 2)}
    `;

  if (additional_input) {
    prompt += `\nAdditional instructions from user: ${additional_input}`;
  }

  prompt += `\n\nSuggested workout for today (as JSON):`;
  return prompt;
};

/**
 * Calls the Gemini API with the given prompt and returns the raw response.
 * @param {string} prompt - The prompt to send to the Gemini API.
 * @returns {Object} The JSON response from the Gemini API.
 * @throws {Error} If the API call fails or returns an unexpected structure.
 */
const callGeminiAPI = async (prompt) => {
  let chatHistory = [];
  chatHistory.push({ role: "user", parts: [{ text: prompt }] });
  const payload = { contents: chatHistory };
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.GEMINI_API_KEY}`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (result.candidates && result.candidates.length > 0 &&
      result.candidates[0].content && result.candidates[0].content.parts &&
      result.candidates[0].content.parts.length > 0) {
    return result;
  } else {
    throw new Error('Failed to get workout suggestions from AI, or unexpected response format.');
  }
};

/**
 * Parses and cleans the raw text response from the Gemini API into a JSON object.
 * @param {Object} geminiResult - The raw JSON result from the Gemini API.
 * @returns {Object} The parsed and cleaned workout JSON object.
 */
const parseAndCleanGeminiResponse = (geminiResult) => {
  let suggestedWorkoutRawText = geminiResult.candidates[0].content.parts[0].text;

  // Clean the raw text by removing leading/trailing markdown code block fences
  suggestedWorkoutRawText = suggestedWorkoutRawText.replace(/^```json\n/, '').replace(/\n```$/, '').trim();

  return JSON.parse(suggestedWorkoutRawText);
};

/**
 * Deletes today's workout from the database.
 * @returns {Promise<void>} A promise that resolves when the deletion is complete.
 */
const deleteTodaysWorkout = async () => {
  const today = new Date().toDateString();
  try {
    // Use `DELETE FROM` with `WHERE` clause for PostgreSQL
    const result = await runAsync('DELETE FROM workouts WHERE day = $1', [today]);
    if (result.changes > 0) {
      console.log(`Deleted existing workout for today (${today}).`);
    } else {
      console.log(`No existing workout found for today (${today}) to delete.`);
    }
  } catch (error) {
    console.error(`Error deleting today's workout:`, error.message);
    throw error; // Re-throw to halt if critical
  }
};

/**
 * Saves the suggested workout JSON to the database.
 * @param {Object} suggestedWorkoutJson - The workout data to save.
 * @returns {Promise<void>} A promise that resolves when the data is saved.
 */
const saveSuggestedWorkoutToDb = async (suggestedWorkoutJson) => {
  // PostgreSQL uses SERIAL for auto-incrementing IDs, so we don't need to explicitly pass 'id' for new inserts.
  // The RETURNING id clause in runAsync will provide the lastID.
  const { day, title, subtitle, exercises, ai_tips } = suggestedWorkoutJson;
  const workoutResult = await runAsync('INSERT INTO workouts (day, title, subtitle, ai_tips) VALUES ($1, $2, $3, $4) RETURNING id', [day, title, subtitle, ai_tips || null]);
  const workoutId = workoutResult.lastID;

  if (exercises && Array.isArray(exercises)) {
    for (const exercise of exercises) {
      const { name, target_muscles, machine, attachments, sets } = exercise;
      if (!name) continue;

      const exerciseResult = await runAsync(
        'INSERT INTO exercises (workout_id, name, target_muscles, machine, attachments) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [workoutId, name, target_muscles, machine, attachments]
      );
      const exerciseId = exerciseResult.lastID;

      if (sets && Array.isArray(sets)) {
        for (const set of sets) {
          const { reps, weight, unit, ai_tips: set_ai_tips } = set;
          // IMPORTANT: Force weight to 0 for suggested workouts as per requirement
          const weightToSave = 0;
          if (typeof reps !== 'number' || !['kg', 'lbs'].includes(unit)) { // Unit check is still important
            console.warn(`Skipping invalid set for exercise ${name}:`, set);
            continue;
          }
          await runAsync('INSERT INTO sets (exercise_id, reps, weight, unit, ai_tips) VALUES ($1, $2, $3, $4, $5) RETURNING id', [exerciseId, reps, weightToSave, unit, set_ai_tips || null]);
        }
      }
    }
  }
  console.log(`Suggested workout for ${suggestedWorkoutJson.day} saved to database with ID: ${workoutId}`);
};


// MODIFIED ENDPOINT: Suggest workout for today using Gemini API
// Now accepts additional user input, saves to DB, and returns formatted text
app.post('/suggest-workout', async (req, res) => {
  const { additional_input } = req.body;

  try {
    // Step 1: Delete any existing workout for today
    await deleteTodaysWorkout();

    // Step 2: Fetch all workout data
    const allWorkoutDetails = await fetchAllWorkoutData();
    
    // Step 3: Build the prompt for Gemini
    const prompt = buildGeminiPrompt(allWorkoutDetails, additional_input);
    
    // Step 4: Call Gemini API
    const geminiResult = await callGeminiAPI(prompt);
    
    // Step 5: Parse and clean Gemini's response
    const suggestedWorkoutJson = parseAndCleanGeminiResponse(geminiResult);
      
    // Step 6: Set today's date for the workout
    suggestedWorkoutJson.day = new Date().toDateString();

    // Step 7: Save the newly suggested workout to the database
    await saveSuggestedWorkoutToDb(suggestedWorkoutJson);

    // Step 8: Return the nicely formatted text to the client
    const formattedText = formatWorkoutAsText(suggestedWorkoutJson);
    res.send(formattedText);

  } catch (err) {
    console.error('Error suggesting workout:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start the Express server
const startServer = async () => {
  try {
    // Attempt to kill any existing process on the port before starting (OS-specific)
    if (process.platform !== 'win32') { // lsof is typically Unix-like
      await killProcessOnPort(port);
    } else {
      console.log('Skipping process kill by port on Windows. Please ensure port 3000 is free manually if starting locally.');
    }

    // Initialize PostgreSQL schema (create tables if they don't exist)
    await initializePgSchema();

    app.listen(port, () => {
      console.log(`Workout tracker API listening at http://localhost:${port}`);
      console.log('Use tools like Postman or curl to test the API endpoints.');
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1); // Exit if unable to start server
  }
};

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    await pool.end(); // Close the PostgreSQL connection pool
    console.log('PostgreSQL connection pool closed.');
    process.exit(0);
  } catch (err) {
    console.error('Error closing PostgreSQL connection pool:', err.message);
    process.exit(1);
  }
});
