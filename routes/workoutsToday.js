const express = require('express');
const router = express.Router();
const { getAsync, allAsync } = require('../database');

router.get('/today', async (req, res) => {
 console.log('Fetching workout for today');
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

module.exports = router;
