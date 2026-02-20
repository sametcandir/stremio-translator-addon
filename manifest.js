module.exports = function (config) {
    return {
        id: "com.stremio.geminitranslator",
        version: "1.0.0",
        name: "Gemini AI Subtitle Translator",
        description: "Translates English OpenSubtitles to Turkish seamlessly using your Google Gemini API key.",
        types: ["movie", "series"],
        catalogs: [],
        resources: [
            { "name": "subtitles", "types": ["movie", "series"], "idPrefixes": ["tt", "kitsu"] }
        ],
        config: [
            {
                key: "geminiApiKey",
                type: "text",
                title: "Google Gemini API Key",
                required: true
            }
        ],
        behaviorHints: {
            configurable: true,
            configurationRequired: true
        }
    };
};
