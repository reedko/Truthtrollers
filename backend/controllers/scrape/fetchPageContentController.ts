// 📁 backend/controllers/scrape/fetchPageContentController.ts
import { Request, Response } from "express";
import puppeteer from "puppeteer";
import axios from "axios";
import { DEFAULT_HEADERS } from "../../utils/defaultHeaders";

const buildArchiveUrl = (url: string) => `https://web.archive.org/web/${url}`;

const checkIfPdfViaHead = async (url: string): Promise<boolean> => {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const contentType = res.headers.get("Content-Type") || "";
    return contentType.includes("application/pdf");
  } catch (e) {
    console.warn("❌ PDF HEAD check failed:", e);
    return false;
  }
};

const tryAxios = async (url: string) => {
  try {
    console.log(`🌍 Axios fetching: ${url}`);
    const response = await axios.get(url, {
      headers: { ...DEFAULT_HEADERS, Referer: url },
      timeout: 10000,
    });
    console.log(`✅ Axios fetched ${response.data.length} chars`);
    return { success: true, html: response.data, source: "axios" };
  } catch (err: any) {
    console.warn(`⚠️ Axios failed for ${url}:`, err.message);
    return null;
  }
};

const tryPuppeteer = async (url: string, label: string) => {
  try {
    console.log(`🤖 Puppeteer fetching: ${url}`);
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setUserAgent(DEFAULT_HEADERS["User-Agent"]);
    await page.setExtraHTTPHeaders(DEFAULT_HEADERS);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    const html = await page.content();
    await browser.close();

    console.log(`✅ Puppeteer fetched ${html.length} chars`);
    return { success: true, html, source: label };
  } catch (err: any) {
    console.warn(`❌ Puppeteer failed for ${url}:`, err.message);
    return null;
  }
};

export const fetchPageContentHandler = async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Invalid or missing URL" });
  }

  const archiveUrl = buildArchiveUrl(url);

  let isPdf = url.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    isPdf = await checkIfPdfViaHead(url);
  }

  if (isPdf) {
    try {
      const pdfRes = await fetch(
        `${process.env.API_BASE_URL}/api/fetch-pdf-text`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        }
      );

      const pdfJson = await pdfRes.json();
      return res.json(pdfJson);
    } catch (err) {
      console.error("❌ Failed to delegate to fetch-pdf-text:", err);
      return res.status(500).json({ error: "PDF delegation failed" });
    }
  }

  const liveAxios = await tryAxios(url);
  if (liveAxios) return res.json(liveAxios);

  const livePuppeteer = await tryPuppeteer(url, "puppeteer");
  if (livePuppeteer) return res.json(livePuppeteer);

  const waybackPuppeteer = await tryPuppeteer(archiveUrl, "wayback-puppeteer");
  if (waybackPuppeteer) return res.json(waybackPuppeteer);

  return res.status(500).json({ error: "All methods failed to fetch page" });
};
