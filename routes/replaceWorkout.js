const express = require('express');
const router = express.Router();
const { getAsync, allAsync, runAsync } = require('../database');
// You may need to import Gemini helpers if using Gemini API

router.post('/', async (req, res) => {
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
    // 3. Build prompt for Gemini (AI)
    let prompt = `Suggest a replacement for the following exercise in the context of its workout.\n` +
      `Exercise to replace:\n${JSON.stringify(exercise, null, 2)}\n` +
      `Workout context:\n${JSON.stringify(workoutDetails, null, 2)}\n` +
      `Return ONLY the replacement exercise as a JSON object matching the original exercise schema.`;
    if (user_input) {
      prompt += `\nUser request: ${user_input}`;
    }
    // 4. Call Gemini (replace with your actual Gemini API call)
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

module.exports = router;