// list_all_workout_details.js
const fetch = require('node-fetch'); // You might need to install node-fetch if on older Node.js
                                    // npm install node-fetch@2

const BASE_API_URL = 'http://localhost:3000';

async function listAllWorkoutDetails() {
  console.log('Fetching all workout IDs...');
  try {
    // First, get all workout IDs
    const workoutsResponse = await fetch(`${BASE_API_URL}/workouts`);
    
    if (!workoutsResponse.ok) {
      const errorText = await workoutsResponse.text();
      throw new Error(`HTTP error fetching workouts list! Status: ${workoutsResponse.status}, Message: ${errorText}`);
    }

    const workouts = await workoutsResponse.json();

    if (workouts.length === 0) {
      console.log('No workouts found in the database.');
      return;
    }

    console.log(`Found ${workouts.length} workouts. Fetching full details...`);
    console.log('\n--- All Workout Details ---');

    // Then, for each workout ID, fetch its full details
    for (const workoutSummary of workouts) {
      console.log(`\n--- Workout ID: ${workoutSummary.id} (${workoutSummary.day}) ---`);
      console.log(`  Title: ${workoutSummary.title}`);
      if (workoutSummary.subtitle) {
        console.log(`  Subtitle: ${workoutSummary.subtitle}`);
      }

      const workoutDetailResponse = await fetch(`${BASE_API_URL}/workouts/${workoutSummary.id}`);
      
      if (!workoutDetailResponse.ok) {
        const errorText = await workoutDetailResponse.text();
        console.error(`  Error fetching details for workout ID ${workoutSummary.id}: Status: ${workoutDetailResponse.status}, Message: ${errorText}`);
        continue; // Skip to the next workout if an error occurs
      }

      const fullWorkout = await workoutDetailResponse.json();

      if (fullWorkout.exercises && fullWorkout.exercises.length > 0) {
        console.log('  Exercises:');
        fullWorkout.exercises.forEach((exercise, exIndex) => {
          console.log(`    ${exIndex + 1}. Name: ${exercise.name}`);
          if (exercise.target_muscles) {
            console.log(`       Target Muscles: ${exercise.target_muscles}`);
          }
          if (exercise.machine) {
            console.log(`       Machine: ${exercise.machine}`);
          }
          if (exercise.attachments) {
            console.log(`       Attachments: ${exercise.attachments}`);
          }
          if (exercise.sets && exercise.sets.length > 0) {
            console.log('       Sets:');
            exercise.sets.forEach((set, setIndex) => {
              console.log(`         Set ${setIndex + 1}: ${set.reps} reps @ ${set.weight} ${set.unit}`);
            });
          } else {
            console.log('       No sets logged for this exercise.');
          }
        });
      } else {
        console.log('  No exercises logged for this workout.');
      }
    }
    console.log('\n--- End of All Workout Details ---');

  } catch (error) {
    console.error('An error occurred:', error.message);
  }
}

listAllWorkoutDetails();