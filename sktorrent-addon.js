const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const { decode } = require("entities");
const axios = require("axios");
const cheerio = require("cheerio");
const bencode = require("bncode");
const crypto = require("crypto");

const SKT_UID = process.env.SKT_UID || "";
const SKT_PASS = process.env.SKT_PASS || "";
const BASE_URL = "https://sktorrent.eu";
const SEARCH_URL = `${BASE_URL}/torrent/torrents_v2.php`;

const builder = new addonBuilder({
    id: "org.stremio.sktorrent",
    version: "1.0.0",
    name: "SKTorrent",
    description: "Streamuj z SKTorrent.eu",
    types: ["movie", "series"],
    resources: ["stream"],
    idPrefixes: ["tt"]
});

async function searchTorrents(query) {
    try {
        const session = axios.create({ 
            headers: { 
                'Cookie': `uid=${SKT_UID}; pass=${SKT_PASS}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36'
            } 
        });
        const res = await session.get(SEARCH_URL, { params: { search: query, category: 0 } });
        const $ = cheerio.load(res.data);
        const results = [];
        $('a[href^="details.php"]').each((i, el) => {
            const torrentId = $(el).attr("href").split("id=").pop();
            results.push({
                name: $(el).attr("title") || "Torrent",
                downloadUrl: `${BASE_URL}/torrent/download.php?id=${torrentId}`
            });
        });
        return results;
    } catch (err) { return []; }
}

builder.defineStreamHandler(async ({ type, id }) => {
    const [imdbId] = id.split(":");
    // Skúsime hľadať priamo podľa IMDb ID, SKTorrent to niekedy berie
    const torrents = await searchTorrents(imdbId);
    
    const streams = await Promise.all(torrents.map(async (t) => {
        try {
            const res = await axios.get(t.downloadUrl, { 
                responseType: "arraybuffer", 
                headers: { Cookie: `uid=${SKT_UID}; pass=${SKT_PASS}`, Referer: BASE_URL } 
            });
            const torrent = bencode.decode(res.data);
            const infoHash = crypto.createHash("sha1").update(bencode.encode(torrent.info)).digest("hex");
            return { title: t.name, infoHash };
        } catch (e) { return null; }
    }));

    return { streams: streams.filter(Boolean) };
});

// EXPORT PRE VERCEL (TOTO JE KĽÚČOVÉ)
module.exports = (req, res) => {
    const { getRouter } = require("stremio-addon-sdk");
    const router = getRouter(builder.getInterface());
    router(req, res, () => {
        res.statusCode = 404;
        res.end();
    });
};

// Spustenie pre Render/lokálne
if (process.env.PORT) {
    builder.getInterface().serve(process.env.PORT);
}
