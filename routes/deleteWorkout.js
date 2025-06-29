const express = require('express');
const router = express.Router();
const { runAsync } = require('../database');

router.delete('/:id', async (req, res) => {
  const workoutId = req.params.id;
  try {
    const result = await runAsync('DELETE FROM workouts WHERE id = $1', [workoutId]);
    if (result.changes === 0) {
      return res.status(404).json({ message: 'Workout not found' });
    }
    res.json({ message: 'Workout deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
