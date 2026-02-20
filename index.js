const { addonBuilder, serveHTTP, getRouter } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Parser = require("srt-parser-2").default;
const manifest = require("./manifest");

// Target Language Configuration - Change this to support other languages!
const LANG_CONFIG = {
    code: 'tur',              // Stremio language code (ISO 639-2)
    label: 'TR',             // Short tag shown in the Stremio subtitle list
    name: 'Turkish',         // Full name of the language (Eng)
    localName: 'Türkçe',     // Full name of the language (Native)
    aiInstruction: 'doğal Türkçeye çevirmeli', // Part of system instruction for AI phrasing
    promptPrefix: 'Aşağıdaki altyazı bloğunu eksiksiz Türkçeye çevir:', // AI prompt prefix
    translatingMsg: 'Gemini AI şu an çeviriyor', // Status message during translation
    completedMsg: 'Çeviri Tamamlandı! Lütfen altyazıyı şimdi tekrar seçin.', // Success message
    refreshMsg: 'Güncel durumu görmek için altyazıyı tekrar seçin!', // Hint to re-select
    statusHeader: 'Çeviri Durumu', // The header for the progress subtitle
    infoMsg: '(İlerleme durduysa veya bittiyse: Stremio altyazı listesinden bu altyazıyı tekrar seçmen yeterlidir!)', // Help text
    errorHeader: 'KRİTİK HATA', // Error title
    errorInstruction: 'Lütfen başka bir altyazı varyantını seçin veya videoyu yeniden başlatın.' // Error help text
};

// Global In-Memory Cache for Background Translations
const translationCache = new Map();


const builder = new addonBuilder(manifest({}));

// Intercept subtitle requests
builder.defineSubtitlesHandler(async function (args) {
    if (args.type !== 'movie' && args.type !== 'series') {
        return Promise.resolve({ subtitles: [] });
    }

    const config = args.config || {};
    const geminiApiKey = config.geminiApiKey;

    if (!geminiApiKey) {
        return Promise.resolve({ subtitles: [] });
    }

    try {
        // Fetch English subtitles from the official OpenSubtitles v3 addon
        const osUrl = `https://opensubtitles-v3.strem.io/subtitles/${args.type}/${args.id}.json`;
        const osResp = await axios.get(osUrl);
        const osSubs = osResp.data.subtitles || [];

        // Filter out only English subtitles
        const engSubs = osSubs.filter(sub => sub.lang === 'eng' || sub.lang === 'en');

        if (engSubs.length === 0) {
            return { subtitles: [] };
        }

        let host = 'http://127.0.0.1:7000';
        if (process.env.PUBLIC_URL) {
            host = process.env.PUBLIC_URL;
        } else if (process.env.VERCEL_URL) {
            host = `https://${process.env.VERCEL_URL}`;
        }

        const subtitles = engSubs.slice(0, 10).map((sub, index) => {
            // Her varyant için kendi ana URL'sini ve benzersiz bir version ID (vid) ekliyoruz
            // Bu sayede Stremio her linki tamamen farklı bir seçenek olarak algılar.
            const fallbackUrls = [sub.url, ...engSubs.filter(s => s.url !== sub.url).slice(0, 2).map(s => s.url)];
            const translateUrl = `${host}/translate.srt?urls=${encodeURIComponent(JSON.stringify(fallbackUrls))}&key=${encodeURIComponent(geminiApiKey)}&vid=${sub.id || index}`;

            return {
                id: `gemini-${LANG_CONFIG.code}-${sub.id || index}`,
                url: translateUrl,
                lang: LANG_CONFIG.code,
                name: `[Gemini AI] ${LANG_CONFIG.label}: ${sub.id || 'Versiyon ' + (index + 1)}`
            };
        });

        return { subtitles };
    } catch (e) {
        console.error("Error fetching subtitles from OS", e);
        return { subtitles: [] };
    }
});

const addonInterface = builder.getInterface();

const app = express();
const port = process.env.PORT || 7000;

// Configuration Page
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="tr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Gemini Translator - Stremio Addon</title>
            <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
            <style>
                :root {
                    --primary: #6366f1;
                    --secondary: #e94560;
                    --bg: #0f172a;
                    --card: rgba(30, 41, 59, 0.7);
                    --glass: rgba(255, 255, 255, 0.03);
                }

                * { margin: 0; padding: 0; box-sizing: border-box; }
                
                body { 
                    font-family: 'Outfit', sans-serif; 
                    background: radial-gradient(circle at top right, #1e1b4b, #0f172a);
                    color: #f8fafc;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    overflow-x: hidden;
                }

                .bg-blobs {
                    position: fixed;
                    top: 0; left: 0; width: 100%; height: 100%;
                    z-index: -1;
                    overflow: hidden;
                }

                .blob {
                    position: absolute;
                    width: 400px; height: 400px;
                    background: var(--primary);
                    filter: blur(100px);
                    border-radius: 50%;
                    opacity: 0.15;
                    animation: float 20s infinite alternate;
                }

                @keyframes float {
                    from { transform: translate(0, 0); }
                    to { transform: translate(100px, 100px); }
                }

                .container { 
                    max-width: 500px; 
                    width: 100%;
                    background: var(--card);
                    backdrop-filter: blur(20px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    padding: 40px; 
                    border-radius: 24px; 
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                    text-align: center;
                    animation: fadeIn 0.8s ease-out;
                }

                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .logo {
                    font-size: 3rem;
                    background: linear-gradient(to right, #818cf8, #c084fc);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    font-weight: 800;
                    margin-bottom: 10px;
                    letter-spacing: -1px;
                }

                h1 { font-size: 1.5rem; margin-bottom: 15px; font-weight: 600; color: #fff; }
                p { color: #94a3b8; line-height: 1.6; margin-bottom: 30px; font-size: 0.95rem; }

                .input-group {
                    position: relative;
                    margin-bottom: 25px;
                }

                input { 
                    width: 100%;
                    padding: 16px 20px; 
                    background: rgba(15, 23, 42, 0.6);
                    border: 2px solid rgba(255, 255, 255, 0.05);
                    border-radius: 12px; 
                    color: #fff;
                    font-size: 1rem;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    font-family: inherit;
                }

                input:focus {
                    outline: none;
                    border-color: var(--primary);
                    background: rgba(15, 23, 42, 0.8);
                    box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1);
                }

                .btn-group {
                    display: grid;
                    grid-template-columns: 1fr;
                    gap: 12px;
                }

                button { 
                    position: relative;
                    padding: 16px; 
                    background: var(--primary);
                    color: #fff; 
                    border: none; 
                    border-radius: 12px; 
                    cursor: pointer; 
                    font-size: 1rem; 
                    font-weight: 600;
                    transition: all 0.3s;
                    overflow: hidden;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                }

                button:hover {
                    box-shadow: 0 10px 15px -3px rgba(99, 102, 241, 0.4);
                    transform: translateY(-2px);
                }

                button:active { transform: translateY(0); }

                .btn-secondary {
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }

                .btn-secondary:hover {
                    background: rgba(255, 255, 255, 0.1);
                    box-shadow: none;
                }

                .footer {
                    margin-top: 30px;
                    padding-top: 20px;
                    border-top: 1px solid rgba(255, 255, 255, 0.05);
                }

                .footer p { margin-bottom: 0; font-size: 0.8rem; }
                
                .footer a {
                    color: var(--primary);
                    text-decoration: none;
                    transition: color 0.3s;
                }

                .footer a:hover { color: #818cf8; }

                .badge {
                    display: inline-block;
                    padding: 4px 12px;
                    background: rgba(99, 102, 241, 0.1);
                    color: var(--primary);
                    border-radius: 20px;
                    font-size: 0.75rem;
                    font-weight: 600;
                    margin-bottom: 10px;
                }
            </style>
        </head>
        <body>
            <div class="bg-blobs">
                <div class="blob" style="top: -10%; right: -10%;"></div>
                <div class="blob" style="bottom: -10%; left: -10%; background: var(--secondary)"></div>
            </div>

            <div class="container">
                <div class="badge">Gemini AI v2.5 Flash</div>
                <div class="logo">Translate</div>
                <h1>Stremio AI Çevirmen</h1>
                <p>Google'ın en gelişmiş yapay zekasını kullanarak Stremio altyazılarını anlık olarak doğal Türkçeye çevirin.</p>
                
                <div class="input-group">
                    <input id="apiKey" type="text" placeholder="Google Gemini API Key">
                </div>

                <div class="btn-group">
                    <button onclick="install()">
                        <span>📥</span> Stremio'da Otomatik Kur
                    </button>
                    <button class="btn-secondary" onclick="copyLink()">
                        <span>🔗</span> URL'yi Manuel Kopyala
                    </button>
                </div>

                <div class="footer">
                    <p>API Anahtarınız yok mu? <a href="https://aistudio.google.com/app/apikey" target="_blank">Google AI Studio'dan Ücretsiz Alın</a></p>
                </div>
            </div>

            <script>
                function generateUrl() {
                    const key = document.getElementById('apiKey').value.trim();
                    if(!key) {
                        alert("Lütfen geçerli bir API Anahtarı girin!");
                        return null;
                    }
                    const host = window.location.host;
                    const configObj = { geminiApiKey: key };
                    const configPath = encodeURIComponent(JSON.stringify(configObj));
                    return host + '/' + configPath + '/manifest.json';
                }

                function install() {
                    const path = generateUrl();
                    if(path) {
                        window.location.href = 'stremio://' + path;
                    }
                }

                function copyLink() {
                    const path = generateUrl();
                    if(path) {
                        const protocol = window.location.protocol;
                        const fullUrl = protocol + '//' + path;
                        navigator.clipboard.writeText(fullUrl).then(() => {
                            alert("👉 Bağlantı Kopyalandı!\\n\\nStremio'da Eklentiler sayfasına gidin ve arama çubuğuna yapıştırıp Kur deyin.");
                        });
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// Background Translation Function
async function processBackgroundTranslation(urlArrayStr, uniqueKey, key) {
    if (translationCache.has(uniqueKey)) return; // Zaten işleniyor veya tamamlandı

    translationCache.set(uniqueKey, { status: 'translating', data: null, error: null, progress: 0, total: 0 });

    try {
        console.log(`[Arkaplan] İndirilecek URL dizisi çözümleniyor...`);
        let urlArray = [];
        try {
            urlArray = JSON.parse(urlArrayStr);
        } catch (e) {
            urlArray = [urlArrayStr]; // fallback in case it's a single string
        }

        let originalSrt = null;

        // Fetch them all in parallel to bypass dead/timeout OpenSubtitles links
        const fetchPromises = urlArray.map(async u => {
            const response = await axios.get(u, { responseType: 'text', timeout: 15000 });
            if (!response.data || !response.data.includes("-->")) {
                throw new Error("Geçersiz altyazı formatı.");
            }
            return response.data;
        });

        try {
            originalSrt = await Promise.any(fetchPromises);
            console.log(`[Arkaplan] En hızlı sağlıklı içerik indirildi. Gemini 2.5 Flash çevirisine başlanıyor...`);
        } catch (aggErr) {
            throw new Error("Tüm kaynak bağlantıları koptu veya zaman aşımına uğradı (ETIMEDOUT)!");
        }

        const genAI = new GoogleGenerativeAI(key);
        // Modelin halüsinasyon (repetition loop) yaşamasını tamamen engelleyen Karakter Talimatı
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            systemInstruction: `Sen çok profesyonel ve resmi bir dublaj & altyazı çevirmenisin. Kullanıcı sana İngilizce bir SRT film altyazı dosyası gönderecektir. KESİNLİKLE tüm satırları EKSİKSİZ, ${LANG_CONFIG.aiInstruction}, hiçbir cümleyi atlamamalı ve asla aynı çeviriyi tekrar etmemelisin (her zaman orijinal metne sadık kal). Yalnızca SRT formatında dön.`
        });

        // SRT ayrıştırma ve süper-hızlı (Paralel) Chunklama sistemi kuruluyor:
        const Parser = require("srt-parser-2").default;
        const parser = new Parser();
        const subArray = parser.fromSrt(originalSrt);

        // Flash modellerinin kafasının karışıp "dikkatli ol", "sağlayacaktır" gibi tek cümleyi kopyalamaması için YÜKÜ AZALTIYORUZ:
        const CHUNK_SIZE = 250;
        const totalChunks = Math.ceil(subArray.length / CHUNK_SIZE);

        // İlerleme takibi için cache'i güncelle
        const currentCache = translationCache.get(uniqueKey);
        translationCache.set(uniqueKey, { ...currentCache, total: totalChunks });

        console.log(`[Arkaplan] [${uniqueKey}] Film ${subArray.length} satır. Halüsinasyon (Saçmalama) olmaması için ${totalChunks} adede bölünerek EŞZAMANLI yollanıyor...`);

        // Hata durumunda (503 / 429) bir parçanın boş dönmesini engelleyen yardımcı Retry (Yeniden Deneme) Fonksiyonu
        async function fetchWithRetry(prompt, retries = 3, delay = 2000) {
            for (let attempt = 1; attempt <= retries; attempt++) {
                try {
                    const result = await model.generateContent(prompt);
                    let text = result.response.text();
                    return text.replace(/```srt/gi, '').replace(/```/g, '').trim();
                } catch (err) {
                    if (attempt === retries) throw err;
                    console.log(`[Ağ Hatası] Parça çevirisinde anlık sıkıntı oldu (${err.message}). ${attempt}. kez tekrar deneniyor...`);
                    await new Promise(r => setTimeout(r, delay * attempt));
                }
            }
        }

        const chunkPromises = [];

        for (let i = 0; i < subArray.length; i += CHUNK_SIZE) {
            const chunkIndex = Math.floor(i / CHUNK_SIZE);
            const chunk = subArray.slice(i, i + CHUNK_SIZE);
            const chunkSrt = parser.toSrt(chunk);

            const prompt = `${LANG_CONFIG.promptPrefix}\n\n` + chunkSrt;

            // Korumalı (Pro) hesap olduğu halde 503 engeline (Google Server Çökmesi) takılmamak için aralarına 800ms koyuyoruz
            const p = new Promise(resolve => setTimeout(resolve, chunkIndex * 800))
                .then(() => fetchWithRetry(prompt))
                .then(text => {
                    const cache = translationCache.get(uniqueKey);
                    if (cache && cache.status === 'translating') {
                        cache.progress += 1;
                    }
                    console.log(`[Arkaplan] [${uniqueKey}] İlerleme: Parça ${chunkIndex + 1} / ${totalChunks} Çevrildi!`);
                    return text;
                })
                .catch(err => {
                    console.log(`[Kritik Hata] Parça ${chunkIndex + 1} ASLA ÇEVRİLEMEDİ: ${err.message}. Bu parça maalesef atlanıyor.`);
                    return ""; // Sonsuz çökmeyi önlemek için
                });

            chunkPromises.push(p);
        }

        // BÜTÜN parçalar eşzamanlı olarak aynı saniyelerde üretilir ve aşağıda birikimi beklenir (Maksimum 20-25 sn sürer)
        const resolvedChunksTemp = await Promise.all(chunkPromises);

        // Birleşen dev metni Stremio'nun Çökmesini önlemek için Validasyondan (Geçerli format testinden) geçiriyoruz:
        let finalSrt = resolvedChunksTemp.join("\r\n\r\n");
        try {
            const parsedArray = parser.fromSrt(finalSrt);
            finalSrt = parser.toSrt(parsedArray); // %100 kusursuz, hatasız formatta diker
        } catch (parserErr) {
            console.log(`[Uyarı] SRT temizleme/dikme işlemi hatalı, ham birleşim kullanılıyor...`);
            finalSrt = finalSrt + "\r\n\r\n";
        }

        translationCache.set(uniqueKey, { status: 'ready', data: finalSrt, error: null });
        console.log(`[Arkaplan] [${uniqueKey}] Çeviri %100 Tamamlandı ve Önbelleğe (Cache) eklendi!`);
    } catch (e) {
        console.error(`[Arkaplan] [${uniqueKey}] Hata:`, e.message);
        translationCache.set(uniqueKey, { status: 'error', data: null, error: e.message });
    }
}

// Translation Endpoint
app.get('/translate.srt', (req, res) => {
    const { urls, key, vid } = req.query;
    if (!urls || !key) {
        return res.status(400).send('Eksik Parametreler');
    }

    // Her varyant için benzersiz bir cache anahtarı oluşturuyoruz
    const uniqueKey = vid ? `${urls}_${vid}` : urls;

    res.setHeader('Content-Type', 'text/srt; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="translated.srt"');

    // Stremio'nun geçici Cevabı veya Hatalı Cevabı önbelleğe (Cache) almaması için:
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');

    // Önbellek kontrolü (Cache Check)
    const cacheHit = translationCache.get(uniqueKey);

    if (cacheHit && cacheHit.status === 'ready') {
        console.log(`[Cache] [${uniqueKey}] Altyazı hazır, anında teslim ediliyor!`);
        res.setHeader('Content-Length', Buffer.byteLength(cacheHit.data, 'utf8'));
        return res.send(cacheHit.data);
    }

    if (cacheHit && cacheHit.status === 'error') {
        const errorSrt = `1\r\n00:00:00,000 --> 01:00:00,000\r\n[Gemini AI] ${LANG_CONFIG.errorHeader}:\r\n${cacheHit.error}\r\n\r\n2\r\n00:00:00,000 --> 01:00:00,000\r\n${LANG_CONFIG.errorInstruction}\r\n\r\n`;
        res.setHeader('Content-Length', Buffer.byteLength(errorSrt, 'utf8'));
        return res.send(errorSrt);
    }

    // Arkaplan işlemini başlat (Eğer daha önce başlamadıysa)
    if (!cacheHit) {
        processBackgroundTranslation(urls, uniqueKey, key);
    }

    // Dinamik İlerleme Durumu (Dynamic Progress Status)
    const progress = cacheHit ? cacheHit.progress : 0;
    const total = cacheHit ? cacheHit.total : 0;
    const percent = total > 0 ? Math.round((progress / total) * 100) : 0;

    let statusMsg = `${LANG_CONFIG.translatingMsg}: %${percent} tamamlandı (${progress}/${total})`;
    if (percent === 100) {
        statusMsg = LANG_CONFIG.completedMsg;
    } else {
        statusMsg += `\r\n${LANG_CONFIG.refreshMsg}`;
    }

    const tempSrt = `1\r\n00:00:00,000 --> 01:01:00,000\r\n[Gemini AI] ${LANG_CONFIG.statusHeader}:\r\n${statusMsg}\r\n\r\n2\r\n00:00:00,000 --> 01:01:00,000\r\n${LANG_CONFIG.infoMsg}\r\n\r\n`;

    res.setHeader('Content-Length', Buffer.byteLength(tempSrt, 'utf8'));
    res.send(tempSrt);
});

// Mount the Stremio Addon SDK on express
app.use(getRouter(addonInterface));

app.listen(port, () => {
    console.log("Stremio Translator Addon başlatıldı: http://localhost:" + port);
});
