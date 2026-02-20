# Stremio Gemini AI Subtitle Translator 🎬🚀

Hey there! This is a hobby project I built for **my own personal use**. It's a bit "amateur-ish" and experimental, but it works like a charm. It uses the power of Google's Gemini AI to translate English subtitles into natural-sounding Turkish in seconds.

## 🛠 Why I Built This
Some movies or series on Stremio don't have Turkish subtitles, or the available ones are just terrible. I thought, "I can fix this myself," and built this bridge using the free Gemini API.

## 🚀 Features (Amateur but Effective)
- **High-Speed Parallel Translation:** Splits subtitles into chunks and translates them simultaneously (Entire movie finished in ~15-20 seconds).
- **Hallucination Protection:** Includes special instructions to prevent the AI from falling into repetitive loops.
- **Live Progress:** You can see the completion percentage directly on your Stremio screen while it's translating.
- **Multiple Variants:** Supports all English versions from OpenSubtitles; you can choose the one that fits your video best.

## 💡 How to Use
You can use the live version or run it locally:

### Option A: Use the Live Version
1. **API Key Al:** Get a free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
2. **Go to Setup Page:** Open [https://stremio-translator-addon-jtj4.onrender.com/](https://stremio-translator-addon-jtj4.onrender.com/) in your browser.
3. **Install:** Paste your API key and click "Install on Stremio."

### Option B: Run Locally
1. **Clone the repo:** `git clone https://github.com/sametcandir/stremio-translator-addon.git`
2. **Install & Start:** Run `npm install` and then `npm start`.
3. **Setup:** Go to `http://localhost:7000`.

## 🎬 How to Use in Stremio
1. **Select Subtitle:** Start a movie, go to the subtitles list, and pick one of the `[Gemini AI] TR` options.
2. **Wait & Refresh:** At first, you'll see a "Translation Status" message. Wait about 15-20 seconds.
3. **Re-select:** Click on the same `[Gemini AI] TR` subtitle again to see the translated text!

## 🌍 Customizing Target Language (Multi-Language Support)
While I built this for **Turkish (TR)**, I've made it super easy for you to change it to any language you want! You don't need to hunt through the code anymore.

Just open `index.js` and look for the **`LANG_CONFIG`** object at the very top (lines 9-23). 

### What YOU MUST change for a new language:
- **`code`**: The ISO code (e.g., `spa` for Spanish, `fra` for French).
- **`label`**: The tag shown in Stremio (e.g., `ES`, `FR`).
- **`aiInstruction`**: Tell Gemini which language to translate into.
- **`promptPrefix`**: Update the prompt to the AI.

### Optional (You don't *have* to change these):
- You can also translate the status messages (`translatingMsg`, `completedMsg`, etc.) if you want the text on the screen to be in your language too, but the translation will work even if you leave them as they are!

## ⚠️ Notes
- Since I'm using the Render Free plan, the addon might take about 30 seconds to "wake up" if it hasn't been used in a while.
- This is purely experimental. If Gemini refuses to translate a specific file, just try selecting a different variant.

Enjoy your movies! 🍿
