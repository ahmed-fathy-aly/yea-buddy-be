const express = require('express');
const router = express.Router();
const { getAsync, allAsync, runAsync } = require('../database');

// Helper functions (move to utils if needed)
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

const buildGeminiPrompt = (allWorkoutDetails, additional_input) => {
  let prompt = `Based on the following past workout data, suggest a workout plan for today.\n` +
    `The suggestion MUST be returned as a JSON object strictly following this schema:\n` +
    `...schema omitted for brevity...` +
    `Past Workout Data:\n${JSON.stringify(allWorkoutDetails, null, 2)}\n`;
  if (additional_input) {
    prompt += `\nAdditional instructions from user: ${additional_input}`;
  }
  prompt += `\n\nSuggested workout for today (as JSON):`;
  return prompt;
};

// You must implement callGeminiAPI and parseAndCleanGeminiResponse or import them from a shared file

router.post('/', async (req, res) => {
  const { additional_input } = req.body;
  try {
    // Delete today's workout
    const today = new Date().toDateString();
    await runAsync('DELETE FROM workouts WHERE day = $1', [today]);
    // Fetch all workout data
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
    // Build prompt for Gemini
    const prompt = buildGeminiPrompt(allWorkoutDetails, additional_input);
    // Call Gemini API (implement this or import from utils)
    // const geminiResult = await callGeminiAPI(prompt);
    // const suggestedWorkoutJson = parseAndCleanGeminiResponse(geminiResult);
    // suggestedWorkoutJson.day = today;
    // await saveSuggestedWorkoutToDb(suggestedWorkoutJson);
    // const formattedText = formatWorkoutAsText(suggestedWorkoutJson);
    // res.send(formattedText);
    res.status(501).json({ error: 'Gemini API integration required for full implementation.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
