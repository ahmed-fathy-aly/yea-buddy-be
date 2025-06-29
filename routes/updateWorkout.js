const express = require('express');
const router = express.Router();
const { runAsync } = require('../database');

router.put('/:id', async (req, res) => {
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

module.exports = router;
