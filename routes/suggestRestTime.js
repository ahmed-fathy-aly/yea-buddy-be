const express = require('express');
const router = express.Router();
const { getAsync, allAsync } = require('../database');
const { callGeminiAPI } = require('../app'); // Adjust the path as necessary

router.post('/', async (req, res) => {
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
    const { user_input } = req.body;
    let prompt = `Given the following workout for today, suggest the optimal rest time (in seconds) between sets and exercises. ` +
      `Respond ONLY with a JSON object: { "rest_time_seconds": NUMBER }. ` +
      `Today's workout: ${JSON.stringify(workoutDetails, null, 2)}`;
    if (user_input) {
      prompt += `\nUser input: ${user_input}`;
    }
    prompt += `\nRespond only with the JSON.`;
    
    // Call Gemini API
    const geminiResult = await callGeminiAPI(prompt);
    let restTimeJson;
    try {
      let text = geminiResult.candidates[0].content.parts[0].text;
      text = text.replace(/^```json\n/, '').replace(/\n```$/, '').trim();
      restTimeJson = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse Gemini response.' });
    }
    if (restTimeJson && typeof restTimeJson.rest_time_seconds === 'number') {
      res.json({ rest_time_seconds: restTimeJson.rest_time_seconds });
    } else {
      res.status(500).json({ error: 'Gemini did not return a valid rest time.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
