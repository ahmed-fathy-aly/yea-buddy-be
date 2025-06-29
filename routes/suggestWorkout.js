const express = require('express');
const router = express.Router();
const { getAsync, allAsync, runAsync } = require('../database');
const { formatWorkoutAsText, buildGeminiPrompt, callGeminiAPI, parseAndCleanGeminiResponse } = require('./utils');

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
    // Call Gemini API
    const geminiResult = await callGeminiAPI(prompt);
    const suggestedWorkoutJson = parseAndCleanGeminiResponse(geminiResult);
    suggestedWorkoutJson.day = today;
    // Save to DB
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
    const formattedText = formatWorkoutAsText(suggestedWorkoutJson);
    res.send(formattedText);
  } catch (err) {
    console.error('Error suggesting workout:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
