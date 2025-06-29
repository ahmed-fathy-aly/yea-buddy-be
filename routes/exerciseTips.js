const express = require('express');
const router = express.Router();
const { getAsync, allAsync } = require('../database');
const { callGeminiAPI } = require('./utils');

router.post('/:exerciseId', async (req, res) => {
  const exerciseId = parseInt(req.params.exerciseId);
  const { additional_input } = req.body;
  try {
    const exercise = await getAsync('SELECT * FROM exercises WHERE id = $1', [exerciseId]);
    if (!exercise) {
      return res.status(404).json({ message: 'Exercise not found.' });
    }
    const workout = await getAsync('SELECT * FROM workouts WHERE id = $1', [exercise.workout_id]);
    if (!workout) {
      return res.status(404).json({ message: 'Workout associated with exercise not found.' });
    }
    const allExercisesInWorkout = await allAsync('SELECT * FROM exercises WHERE workout_id = $1', [workout.id]);
    const workoutDetailsWithAllExercises = { ...workout, exercises: [] };
    for (const ex of allExercisesInWorkout) {
      const sets = await allAsync('SELECT * FROM sets WHERE exercise_id = $1', [ex.id]);
      workoutDetailsWithAllExercises.exercises.push({ ...ex, sets });
    }
    let prompt = `Provide detailed tips and advice for the following exercise, considering its context within the full workout plan. Focus on proper form, common mistakes, variations, and how to maximize effectiveness.\n\nExercise to get tips for:\n${JSON.stringify(exercise, null, 2)}\n\nContext of its workout plan:\n${JSON.stringify(workoutDetailsWithAllExercises, null, 2)}\n`;
    if (additional_input) {
      prompt += `\nAdditional specific request from user: ${additional_input}`;
    }
    prompt += `\n\nDetailed tips:`;
    // Call Gemini API
    let chatHistory = [];
    chatHistory.push({ role: "user", parts: [{ text: prompt }] });
    const payload = { contents: chatHistory };
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts.length > 0) {
      res.send(result.candidates[0].content.parts[0].text);
    } else {
      res.status(500).json({ error: 'Failed to get exercise tips from AI, or unexpected response format.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
