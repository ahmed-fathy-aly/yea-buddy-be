require('dotenv').config();

const express = require('express');
const { pool, initializePgSchema } = require('./database');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000; 

app.use(express.json());
app.use(cors());

const getAsync = async (sql, params = []) => {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows[0];
  } finally {
    client.release();
  }
};

const allAsync = async (sql, params = []) => {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
};

const runAsync = async (sql, params = []) => {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return { changes: result.rowCount, lastID: result.rows[0]?.id };
  } finally {
    client.release();
  }
};

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
          // Displaying 0 reps and weight, but AI tip will have the suggestion
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

app.put('/workouts/:id', async (req, res) => {
  const workoutId = req.params.id;
  const { day, title, subtitle, exercises } = req.body;

  try {
    const updateWorkoutSql = 'UPDATE workouts SET day = $1, title = $2, subtitle = $3, ai_tips = $4 WHERE id = $5';
    const workoutUpdateResult = await runAsync(updateWorkoutSql, [day, title, subtitle, req.body.ai_tips || null, workoutId]);

    if (workoutUpdateResult.changes === 0) {
      return res.status(404).json({ message: 'Workout not found or no changes made' });
    }

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

// NEW ENDPOINT: Request tips for a specific exercise
app.post('/exercise-tips/:exerciseId', async (req, res) => {
  const exerciseId = parseInt(req.params.exerciseId);
  const { additional_input } = req.body;

  try {
    // 1. Fetch the specific exercise details
    const exercise = await getAsync('SELECT * FROM exercises WHERE id = $1', [exerciseId]);
    if (!exercise) {
      return res.status(404).json({ message: 'Exercise not found.' });
    }

    // 2. Fetch the full workout details this exercise belongs to
    const workout = await getAsync('SELECT * FROM workouts WHERE id = $1', [exercise.workout_id]);
    if (!workout) {
      // This should ideally not happen if data integrity is maintained
      return res.status(404).json({ message: 'Workout associated with exercise not found.' });
    }

    // 3. Fetch all exercises and sets for that workout to provide full context
    const allExercisesInWorkout = await allAsync('SELECT * FROM exercises WHERE workout_id = $1', [workout.id]);
    const workoutDetailsWithAllExercises = { ...workout, exercises: [] };

    for (const ex of allExercisesInWorkout) {
      const sets = await allAsync('SELECT * FROM sets WHERE exercise_id = $1', [ex.id]);
      workoutDetailsWithAllExercises.exercises.push({ ...ex, sets });
    }

    // 4. Construct the prompt for Gemini
    let prompt = `Provide detailed tips and advice for the following exercise, considering its context within the full workout plan. Focus on proper form, common mistakes, variations, and how to maximize effectiveness.
    
    Exercise to get tips for:
    ${JSON.stringify(exercise, null, 2)}

    Context of its workout plan:
    ${JSON.stringify(workoutDetailsWithAllExercises, null, 2)}
    `;

    if (additional_input) {
      prompt += `\nAdditional specific request from user: ${additional_input}`;
    }

    prompt += `\n\nDetailed tips:`;

    // 5. Call the Gemini API
    let chatHistory = [];
    chatHistory.push({ role: "user", parts: [{ text: prompt }] });
    const payload = { contents: chatHistory };
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(apiUrl, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify(payload)
           });

    const result = await response.json();

    // 6. Return the AI's tips as plain text
    if (result.candidates && result.candidates.length > 0 &&
        result.candidates[0].content && result.candidates[0].content.parts &&
        result.candidates[0].content.parts.length > 0) {
      res.send(result.candidates[0].content.parts[0].text);
    } else {
      res.status(500).json({ error: 'Failed to get exercise tips from AI, or unexpected response format.' });
    }

  } catch (err) {
    console.error('Error fetching exercise tips:', err);
    res.status(500).json({ error: err.message });
  }
});


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
    For each exercise, and for each set within an exercise, set the 'reps' and 'weight' fields to 0. **IMPORTANT: Include the suggested weight and reps (e.g., 'Aim for 8-12 reps, 50-60kg') in the 'ai_tips' field for each set.** Also, provide a sensible 'unit' (kg or lbs).
    For the overall workout, provide an 'ai_tips' field with general advice or focus.
    Ensure all fields are correctly populated and units are 'kg' or 'lbs'.
    If no exercises is suggested, provide an empty array for 'exercises'.
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

const callGeminiAPI = async (prompt) => {
  let chatHistory = [];
  chatHistory.push({ role: "user", parts: [{ text: prompt }] });
  const payload = { contents: chatHistory };
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const response = await fetch(apiUrl, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify(payload)
           });

  const result = await response.json(); // Corrected: Added 'await'

  if (result.candidates && result.candidates.length > 0 &&
      result.candidates[0].content && result.candidates[0].content.parts &&
      result.candidates[0].content.parts.length > 0) {
    return result;
  } else {
    throw new Error('Failed to get workout suggestions from AI, or unexpected response format.');
  }
};

const parseAndCleanGeminiResponse = (geminiResult) => {
  let suggestedWorkoutRawText = geminiResult.candidates[0].content.parts[0].text;
  suggestedWorkoutRawText = suggestedWorkoutRawText.replace(/^```json\n/, '').replace(/\n```$/, '').trim();
  return JSON.parse(suggestedWorkoutRawText);
};

const deleteTodaysWorkout = async () => {
  const today = new Date().toDateString();
  try {
    const result = await runAsync('DELETE FROM workouts WHERE day = $1', [today]);
    if (result.changes > 0) {
      console.log(`Deleted existing workout for today (${today}).`);
    } else {
      console.log(`No existing workout found for today (${today}) to delete.`);
    }
  } catch (error) {
    console.error(`Error deleting today's workout:`, error.message);
    throw error;
  }
};

const saveSuggestedWorkoutToDb = async (suggestedWorkoutJson) => {
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
          const repsToSave = 0;
          const weightToSave = 0;
          if (!['kg', 'lbs'].includes(unit)) {
            console.warn(`Skipping invalid set for exercise ${name}:`, set);
            continue;
          }
          await runAsync('INSERT INTO sets (exercise_id, reps, weight, unit, ai_tips) VALUES ($1, $2, $3, $4, $5) RETURNING id', [exerciseId, repsToSave, weightToSave, unit, set_ai_tips || null]);
        }
      }
    }
  }
  console.log(`Suggested workout for ${suggestedWorkoutJson.day} saved to database with ID: ${workoutId}`);
};

app.post('/suggest-workout', async (req, res) => {
  const { additional_input } = req.body;

  try {
    await deleteTodaysWorkout();
    const allWorkoutDetails = await fetchAllWorkoutData();
    const prompt = buildGeminiPrompt(allWorkoutDetails, additional_input);
    const geminiResult = await callGeminiAPI(prompt);
    const suggestedWorkoutJson = parseAndCleanGeminiResponse(geminiResult);
      
    suggestedWorkoutJson.day = new Date().toDateString();

    await saveSuggestedWorkoutToDb(suggestedWorkoutJson);

    const formattedText = formatWorkoutAsText(suggestedWorkoutJson);
    res.send(formattedText);

  } catch (err) {
    console.error('Error suggesting workout:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/replace-workout', async (req, res) => {
  const { exerciseId, user_input } = req.body;
  if (!exerciseId) {
    return res.status(400).json({ error: 'exerciseId is required.' });
  }
  try {
    // 1. Fetch the exercise
    const exercise = await getAsync('SELECT * FROM exercises WHERE id = $1', [exerciseId]);
    if (!exercise) {
      return res.status(404).json({ error: 'Exercise not found.' });
    }
    // 2. Fetch the workout and all exercises in it
    const workout = await getAsync('SELECT * FROM workouts WHERE id = $1', [exercise.workout_id]);
    if (!workout) {
      return res.status(404).json({ error: 'Workout not found.' });
    }
    const allExercises = await allAsync('SELECT * FROM exercises WHERE workout_id = $1', [workout.id]);
    const workoutDetails = { ...workout, exercises: [] };
    for (const ex of allExercises) {
      const sets = await allAsync('SELECT * FROM sets WHERE exercise_id = $1', [ex.id]);
      workoutDetails.exercises.push({ ...ex, sets });
    }
    // 3. Build prompt for Gemini
    let prompt = `Suggest a replacement for the following exercise in the context of its workout.\n` +
      `Exercise to replace:\n${JSON.stringify(exercise, null, 2)}\n` +
      `Workout context:\n${JSON.stringify(workoutDetails, null, 2)}\n` +
      `Return ONLY the replacement exercise as a JSON object matching the original exercise schema.`;
    if (user_input) {
      prompt += `\nUser request: ${user_input}`;
    }
    // 4. Call Gemini
    const geminiResult = await callGeminiAPI(prompt);
    const replacementExercise = parseAndCleanGeminiResponse(geminiResult);
    // 5. Update the exercise in the database
    await runAsync(
      'UPDATE exercises SET name = $1, target_muscles = $2, machine = $3, attachments = $4 WHERE id = $5',
      [replacementExercise.name, replacementExercise.target_muscles, replacementExercise.machine, replacementExercise.attachments, exerciseId]
    );
    res.json({ message: 'Exercise replaced successfully.', replacement: replacementExercise });
  } catch (err) {
    console.error('Error replacing exercise:', err);
    res.status(500).json({ error: err.message });
  }
});

// Suggest optimal rest time endpoint
app.post('/suggest-rest-time', async (req, res) => {
  try {
    // 1. Fetch today’s workout
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

    // 2. Get optional user input
    const { user_input } = req.body;

    // 3. Build prompt for Gemini
    let prompt = `Given the following workout for today, suggest the optimal rest time (in seconds) between sets and exercises. ` +
      `Respond ONLY with a JSON object: { \"rest_time_seconds\": NUMBER }. ` +
      `Today's workout: ${JSON.stringify(workoutDetails, null, 2)}`;
    if (user_input) {
      prompt += `\nUser input: ${user_input}`;
    }
    prompt += `\nRespond only with the JSON.`;

    // 4. Call Gemini
    const geminiResult = await callGeminiAPI(prompt);
    let restTimeJson;
    try {
      let text = geminiResult.candidates[0].content.parts[0].text;
      text = text.replace(/^```json\n/, '').replace(/\n```$/, '').trim();
      restTimeJson = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse Gemini response.' });
    }
    // 5. Return rest time in seconds
    if (restTimeJson && typeof restTimeJson.rest_time_seconds === 'number') {
      res.json({ rest_time_seconds: restTimeJson.rest_time_seconds });
    } else {
      res.status(500).json({ error: 'Gemini did not return a valid rest time.' });
    }
  } catch (err) {
    console.error('Error suggesting rest time:', err);
    res.status(500).json({ error: err.message });
  }
});

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