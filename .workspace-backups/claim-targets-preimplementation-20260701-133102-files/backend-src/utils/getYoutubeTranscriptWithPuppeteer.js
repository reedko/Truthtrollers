import puppeteer from "puppeteer";

export const getYoutubeTranscriptWithPuppeteer = async (videoId) => {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

  let transcriptText = "";

  try {
    // ✅ 1. Try to click the "...more" button in description
    try {
      await page.waitForSelector("tp-yt-paper-button#expand", {
        timeout: 10000,
      });
      const expand = await page.$("tp-yt-paper-button#expand");
      if (expand) {
        await expand.evaluate((el) =>
          el.scrollIntoView({ behavior: "smooth", block: "center" })
        );
        await expand.click();
        await page.waitForTimeout(1000);
        console.log("✅ Clicked '...more' button");
      }
    } catch (err) {
      console.warn("ℹ️ '...more' button not found or not clickable");
    }

    // ✅ 2. Click the "Show transcript" button
    const clickedTranscript = await page.$$eval(
      "ytd-button-renderer button",
      (buttons) => {
        const match = buttons.find((btn) =>
          btn.innerText?.toLowerCase().includes("transcript")
        );
        if (match) {
          match.scrollIntoView({ behavior: "smooth", block: "center" });
          match.click();
          return true;
        }
        return false;
      }
    );

    if (!clickedTranscript) {
      throw new Error(
        "❌ 'Show transcript' button not found or couldn't click it."
      );
    }

    // ✅ 3. Wait for transcript to appear and scrape it
    await page.waitForSelector("ytd-transcript-segment-renderer", {
      timeout: 15000,
    });

    transcriptText = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll("ytd-transcript-segment-renderer")
      )
        .map((el) => el.innerText)
        .join(" ");
    });

    if (!transcriptText || transcriptText.length < 10) {
      throw new Error("Transcript content was empty or not rendered.");
    }

    console.log("✅ Transcript successfully scraped");
  } catch (err) {
    console.error("🧨 Puppeteer transcript error:", err.message || err);
  } finally {
    await browser.close();
  }

  return transcriptText;
};
