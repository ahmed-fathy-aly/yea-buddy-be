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

app.use('/workouts', require('./routes/workouts'));
app.use('/workouts', require('./routes/workoutsToday'));
app.use('/workouts', require('./routes/createWorkout'));
app.use('/workouts', require('./routes/updateWorkout'));
app.use('/workouts', require('./routes/deleteWorkout'));
app.use('/exercise-tips', require('./routes/exerciseTips'));
app.use('/suggest-workout', require('./routes/suggestWorkout'));
app.use('/replace-workout', require('./routes/replaceWorkout'));
app.use('/suggest-rest-time', require('./routes/suggestRestTime'));


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