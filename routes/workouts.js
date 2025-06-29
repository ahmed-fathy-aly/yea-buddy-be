const express = require('express');
const router = express.Router();
const { allAsync } = require('../database');

router.get('/', async (req, res) => {
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

module.exports = router;
