const express = require('express');
const router = express.Router();
const { runAsync } = require('../database');

router.post('/', async (req, res) => {
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

module.exports = router;
