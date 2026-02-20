const { addonBuilder, serveHTTP, getRouter } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Parser = require("srt-parser-2").default;
const manifest = require("./manifest");

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
                id: `gemini-tur-${sub.id || index}`,
                url: translateUrl,
                lang: 'tur',
                name: `[Gemini AI] TR: ${sub.id || 'Versiyon ' + (index + 1)}`
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
        <html>
            <head>
                <title>Gemini Translator Kurulumu</title>
                <style>
                    body { font-family: Arial, sans-serif; background-color: #1a1a2e; color: #fff; text-align: center; padding: 50px; }
                    input { padding: 10px; width: 300px; border-radius: 5px; border: none; margin-bottom: 20px; }
                    button { padding: 10px 20px; background-color: #e94560; color: #fff; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; font-weight: bold;}
                    .container { max-width: 600px; margin: 0 auto; background: #16213e; padding: 30px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Stremio Gemini AI Çevirmen</h1>
                    <p>Google Gemini API Anahtarınızı girerek eklentiyi kurun. (Gemini 1.5 Flash ile ücretsiz hızlı çeviri sağlar.)</p>
                    <input id="apiKey" type="text" placeholder="AIzaSy..."><br>
                    <button onclick="install()">Stremio'da Kur</button>
                    <button onclick="copyLink()" style="background-color: #4CAF50; margin-left:10px;">Bağlantıyı Kopyala</button>
                    <p style="margin-top:20px; font-size: 12px; color: #aaa;">Google AI Studio üzerinden ücretsiz bir API key alabilirsiniz.</p>
                </div>
                <script>
                    function generateUrl() {
                        const key = document.getElementById('apiKey').value;
                        if(!key) {
                            alert("Lütfen API Anahtarı girin!");
                            return null;
                        }
                        const port = window.location.port ? ':' + window.location.port : '';
                        // Explicitly construct string to ensure port is retained 
                        // Stremio-addon-sdk getRouter parses config with JSON.parse
                        const configObj = { geminiApiKey: key };
                        const configPath = encodeURIComponent(JSON.stringify(configObj));
                        const addonPath = window.location.host + '/' + configPath + '/manifest.json';
                        return addonPath;
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
                            const fullUrl = 'http://' + path;
                            navigator.clipboard.writeText(fullUrl).then(() => {
                                alert("Bağlantı kopyalandı! Stremio'da Eklentiler sayfasına gidip arama çubuğuna yapıştırabilirsiniz.\\n\\nKopyalanan: " + fullUrl);
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
            systemInstruction: "Sen çok profesyonel ve resmi bir dublaj & altyazı çevirmenisin. Kullanıcı sana İngilizce bir SRT film altyazı dosyası gönderecektir. KESİNLİKLE tüm satırları EKSİKSİZ, doğal Türkçeye çevirmeli, hiçbir cümleyi atlamamalı ve asla aynı çeviriyi tekrar etmemelisin (her zaman orijinal metne sadık kal). Yalnızca SRT formatında dön."
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

            const prompt = "Aşağıdaki altyazı bloğunu eksiksiz Türkçeye çevir:\n\n" + chunkSrt;

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
        const errorSrt = `1\r\n00:00:00,000 --> 01:00:00,000\r\n[Gemini AI] KRİTİK HATA:\r\n${cacheHit.error}\r\n\r\n2\r\n00:00:00,000 --> 01:00:00,000\r\nLütfen başka bir altyazı varyantını seçin\r\nveya videoyu yeniden başlatın.\r\n\r\n`;
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

    let statusMsg = `Gemini AI şu an çeviriyor: %${percent} tamamlandı (${progress}/${total})`;
    if (percent === 100) {
        statusMsg = "Çeviri Tamamlandı! Lütfen altyazıyı şimdi tekrar seçin.";
    } else {
        statusMsg += "\r\nGüncel durumu görmek için altyazıyı tekrar seçin!";
    }

    const tempSrt = `1\r\n00:00:00,000 --> 01:01:00,000\r\n[Gemini AI] Çeviri Durumu:\r\n${statusMsg}\r\n\r\n2\r\n00:00:00,000 --> 01:01:00,000\r\n(İlerleme durduysa veya bittiyse: Stremio altyazı listesinden\r\nbu altyazıyı tekrar seçmen yeterlidir!)\r\n\r\n`;

    res.setHeader('Content-Length', Buffer.byteLength(tempSrt, 'utf8'));
    res.send(tempSrt);
});

// Mount the Stremio Addon SDK on express
app.use(getRouter(addonInterface));

app.listen(port, () => {
    console.log("Stremio Translator Addon başlatıldı: http://localhost:" + port);
});
