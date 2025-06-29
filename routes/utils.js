const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const formatWorkoutAsText = (workout) => {
  let text = `\n--- Suggested Workout for ${workout.day || 'Today'} ---\n`;
  text += `Title: ${workout.title}\n`;
  if (workout.subtitle) {
    text += `Subtitle: ${workout.subtitle}\n`;
  }
  if (workout.ai_tips) {
    text += `AI Tips (Workout): ${workout.ai_tips}\n`;
  }
  text += '------------------------------------\n';
  if (workout.exercises && workout.exercises.length > 0) {
    workout.exercises.forEach((exercise, exIndex) => {
      text += `\nExercise ${exIndex + 1}: ${exercise.name}\n`;
      text += `  Target Muscles: ${exercise.target_muscles || 'N/A'}\n`;
      text += `  Machine: ${exercise.machine || 'N/A'}\n`;
      if (exercise.attachments) {
        text += `  Attachments: ${exercise.attachments}\n`;
      }
      if (exercise.sets && exercise.sets.length > 0) {
        text += '  Sets:\n';
        exercise.sets.forEach((set, setIndex) => {
          text += `    Set ${setIndex + 1}: ${set.reps} reps @ ${set.weight} ${set.unit}`;
          if (set.ai_tips) {
            text += ` - Tips: ${set.ai_tips}\n`;
          } else {
            text += `\n`;
          }
        });
      } else {
        text += '  No sets logged for this exercise.\n';
      }
    });
  } else {
    text += 'No exercises suggested for this workout.\n';
  }
  text += '------------------------------------\n';
  return text;
};

const buildGeminiPrompt = (allWorkoutDetails, additional_input) => {
  let prompt = `Based on the following past workout data, suggest a workout plan for today.\n` +
    `The suggestion MUST be returned as a JSON object strictly following this schema:\n` +
    `{"day":"STRING","title":"STRING","subtitle":"STRING (optional)","exercises":[{"name":"STRING","target_muscles":"STRING","machine":"STRING","attachments":"STRING (optional)","sets":[{"reps":NUMBER,"weight":NUMBER,"unit":"STRING","ai_tips":"STRING (optional)"}]}],"ai_tips":"STRING (optional)"}` +
    `\nFor each exercise, and for each set within an exercise, set the 'reps' and 'weight' fields to 0. Include the suggested weight and reps in the 'ai_tips' field for each set. Also, provide a sensible 'unit' (kg or lbs). For the overall workout, provide an 'ai_tips' field with general advice or focus. Ensure all fields are correctly populated and units are 'kg' or 'lbs'. If no exercises is suggested, provide an empty array for 'exercises'. DO NOT include any conversational text outside the JSON.\n` +
    `Past Workout Data:\n${JSON.stringify(allWorkoutDetails, null, 2)}\n`;
  if (additional_input) {
    prompt += `\nAdditional instructions from user: ${additional_input}`;
  }
  prompt += `\n\nSuggested workout for today (as JSON):`;
  return prompt;
};

const callGeminiAPI = async (prompt) => {
  let chatHistory = [];
  chatHistory.push({ role: "user", parts: [{ text: prompt }] });
  const payload = { contents: chatHistory };
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (result.candidates && result.candidates.length > 0 &&
      result.candidates[0].content && result.candidates[0].content.parts &&
      result.candidates[0].content.parts.length > 0) {
    return result;
  } else {
    throw new Error('Failed to get workout suggestions from AI, or unexpected response format.');
  }
};

const parseAndCleanGeminiResponse = (geminiResult) => {
  let suggestedWorkoutRawText = geminiResult.candidates[0].content.parts[0].text;
  suggestedWorkoutRawText = suggestedWorkoutRawText.replace(/^```json\n/, '').replace(/\n```$/, '').trim();
  return JSON.parse(suggestedWorkoutRawText);
};

module.exports = {
  formatWorkoutAsText,
  buildGeminiPrompt,
  callGeminiAPI,
  parseAndCleanGeminiResponse
};
