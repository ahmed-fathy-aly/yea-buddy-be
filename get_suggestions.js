// get_suggestions.js
const fetch = require('node-fetch'); // Keep this if you need it for older Node.js
                                    // npm install node-fetch@2

const SUGGESTIONS_API_URL = 'http://localhost:3000/suggest-workout';

async function getWorkoutSuggestions(additionalInput = '') {
  console.log('Requesting workout suggestions from the AI...');

  try {
    const payload = {
      additional_input: additionalInput
    };

    const response = await fetch(SUGGESTIONS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      // If the server returns text directly on error, read as text.
      // If it returns JSON, parse as JSON.
      const errorText = await response.text(); 
      try {
        const errorData = JSON.parse(errorText);
        throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorData.error || response.statusText}`);
      } catch (jsonError) {
        throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
      }
    }

    // The /suggest-workout endpoint now returns a plain text string
    const suggestedWorkoutText = await response.text(); 

    if (suggestedWorkoutText) {
      console.log('\n--- AI Suggested Workout for Today ---');
      console.log(suggestedWorkoutText);
      console.log('------------------------------------');
    } else {
      console.log('No specific workout suggestion was returned by the AI.');
    }

  } catch (error) {
    console.error('Error fetching workout suggestions:', error.message);
    console.warn('Ensure your Node.js server is running and has access to the Gemini API key.');
  }
}

// You can pass an optional argument when running the script
// Example: node get_suggestions.js "Focus on chest and triceps, low intensity."
const userInput = process.argv[2] || ''; // Get user input from command line arguments
getWorkoutSuggestions(userInput);