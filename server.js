require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let isScrapingActive = false;

async function scrapeProductData(url) {
    let browser;
    try {
        console.log("\n[INFO] Starting scrape cycle using Playwright 'Visual Mouse' engine.");
        
        if (!url.startsWith("http")) url = "https://" + url;

        browser = await chromium.launch({ headless: false });
        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            viewport: { width: 1280, height: 720 }
        });
        const page = await context.newPage();

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(2000);

        // =================================================================
        // THE "LAL BINDI" (VISUAL MOUSE) INJECTION
        // =================================================================
        console.log("[INFO] Injecting Visual Mouse (Red Dot) onto the screen...");
        await page.evaluate(() => {
            const cursor = document.createElement('div');
            cursor.id = 'robot-cursor';
            cursor.style.width = '20px';
            cursor.style.height = '20px';
            cursor.style.borderRadius = '50%';
            cursor.style.backgroundColor = 'rgba(255, 0, 0, 0.7)'; 
            cursor.style.position = 'fixed';
            cursor.style.zIndex = '9999999';
            cursor.style.pointerEvents = 'none'; 
            cursor.style.transition = 'top 0.1s, left 0.1s'; 
            cursor.style.border = '2px solid white';
            document.body.appendChild(cursor);

            document.addEventListener('mousemove', (e) => {
                cursor.style.left = (e.clientX - 10) + 'px';
                cursor.style.top = (e.clientY - 10) + 'px';
            });
        });

        console.log("[INFO] Capturing initial state screenshot...");
        await page.screenshot({ path: "debug_1_start.png" });

        // -------------------------------------------------------------
        // FIX 1: THE "RADAR LOOP" FOR ALLOW MODAL
        // -------------------------------------------------------------
        console.log("[INFO] Scanning for ALLOW modal (10-second active radar loop)...");
        let modalClicked = false;
        
        for (let i = 0; i < 10; i++) {
            try {
                // We use multiple text variations just in case the website randomly changes it
                const allowBtn = page.locator('button', { hasText: /ALLOW|ACCEPT|AGREE/i }).first();
                
                if (await allowBtn.isVisible()) {
                    console.log(`[INFO] ALLOW modal spotted on attempt ${i + 1}! Executing click...`);
                    // Slide mouse to allow button just to be extra human
                    const btnBox = await allowBtn.boundingBox();
                    if(btnBox) {
                        await page.mouse.move(btnBox.x + 10, btnBox.y + 10, { steps: 5 });
                    }
                    
                    await allowBtn.click({ force: true });
                    modalClicked = true;
                    console.log("[INFO] ALLOW clicked. Waiting 2.5 seconds for overlay to vanish...");
                    await page.waitForTimeout(2500); 
                    break; // Mission accomplished, break the loop
                }
            } catch (e) {
                // Ignore silent errors during scanning
            }
            // Wait 1 second before scanning the screen again
            await page.waitForTimeout(1000); 
        }

        if (!modalClicked) {
            console.log("[INFO] No ALLOW modal detected after 10 seconds. Moving forward safely.");
        }

        console.log("[INFO] Capturing post-modal state screenshot...");
        await page.screenshot({ path: "debug_2_after_modal.png" });

        // -------------------------------------------------------------
        // FIX 2 & 3: PURE PHYSICAL MOUSE GLIDING (The Red Dot)
        // -------------------------------------------------------------
        try {
            console.log("[INFO] Locating the gray offer panel...");
            const panel = page.locator(".offer-panel").first();
            await panel.scrollIntoViewIfNeeded();
            await page.waitForTimeout(1000); 

            const panelBox = await panel.boundingBox();
            if (panelBox) {
                console.log("[INFO] Sliding Red Dot into the gray area...");
                const targetX = panelBox.x + (panelBox.width / 2);
                const targetY = panelBox.y + (panelBox.height / 2);
                
                await page.mouse.move(targetX, targetY, { steps: 25 });
                console.log("[INFO] Red Dot is resting on the gray area. Waiting 3 seconds...");
                await page.waitForTimeout(3000);

                console.log("[INFO] Locating the black 'CHECK TODAY'S PRICE' button...");
                const priceBtn = page.locator("button.ctl-main").first();
                const btnBox = await priceBtn.boundingBox();

                if (btnBox) {
                    console.log("[INFO] Gliding Red Dot directly to the black button...");
                    const btnTargetX = btnBox.x + (btnBox.width / 2);
                    const btnTargetY = btnBox.y + (btnBox.height / 2);
                    
                    await page.mouse.move(btnTargetX, btnTargetY, { steps: 20 });
                    await page.waitForTimeout(1000); 

                    console.log("[INFO] Executing true physical click...");
                    await page.mouse.down();
                    await page.waitForTimeout(150); 
                    await page.mouse.up();
                    
                    console.log("[INFO] Button clicked via hardware event.");
                } else {
                    console.log("[WARN] Black button bounding box not found!");
                }
            } else {
                console.log("[WARN] Gray panel bounding box not found!");
            }
        } catch (e) {
            console.warn("[WARN] Hover/Click sequence error: " + e.message);
        }

        // -------------------------------------------------------------
        // WAIT & EXTRACT
        // -------------------------------------------------------------
        console.log("[INFO] Waiting for currency symbol (₹) to appear...");
        try {
            await page.waitForFunction(() => document.body.innerText.includes("₹"), { timeout: 15000 });
            console.log("[INFO] Target currency symbol identified in DOM.");
        } catch (waitError) {
            console.warn("[WARN] Currency symbol timeout.");
        }

        console.log("[INFO] Capturing final state screenshot...");
        await page.screenshot({ path: "debug_3_final.png" });

        const data = await page.evaluate(() => {
            let extractedPrice = null;
            let extractedStock = "Unknown";

            const panel = document.querySelector(".offer-panel");

            if (panel) {
                const spans = Array.from(panel.querySelectorAll(".offer-row span"));
                for (const span of spans) {
                    const style = window.getComputedStyle(span);
                    const text = span.innerText;
                    
                    if (text && text.includes("₹") && style.display !== "none" && style.textDecorationLine !== "line-through") {
                        const match = text.match(/₹\s*[0-9][\d,]+/);
                        if (match) {
                            extractedPrice = match[0].replace(/\s/g, "");
                            break;
                        }
                    }
                }
            }

            if (!extractedPrice) {
                const rawText = document.body.innerText + " " + document.body.textContent;
                const matches = rawText.match(/₹\s*[0-9][\d,]+/g);
                if (matches && matches.length > 0) {
                    extractedPrice = matches[matches.length - 1].replace(/\s/g, "");
                }
            }

            const fullText = document.body.innerText + " " + document.body.textContent;
            
            if (fullText.includes("SOLD OUT") || fullText.includes("Out of stock")) {
                extractedStock = "Out of Stock";
            } else if (fullText.includes("delivery") || fullText.includes("saving")) {
                extractedStock = "In Stock";
            }

            return { extractedPrice, extractedStock };
        });

        await browser.close();

        if (!data.extractedPrice) {
            throw new Error("Target price pattern completely absent from DOM text.");
        }

        return { price: data.extractedPrice, stock: data.extractedStock, outcome: "success" };
    } catch (error) {
        console.error("[ERROR] Scrape execution failed: " + error.message);
        if (browser) await browser.close();
        return { price: null, stock: null, outcome: "failed" };
    }
}

app.get("/api/run-scraper", async (req, res) => {
    if (isScrapingActive) {
        console.warn("[WARN] Scraper process is currently active.");
        return res.status(429).json({ message: "Scraper is currently processing a request." });
    }

    isScrapingActive = true;
    console.log("\n[INFO] Scraper service endpoint invoked.");

    try {
        const { data: products, error: fetchError } = await supabase.from("tracked_products").select("*");
        if (fetchError) throw fetchError;
        
        if (!products || products.length === 0) {
            console.log("[INFO] Database query returned no active products.");
            isScrapingActive = false;
            return res.status(200).json({ message: "No active products registered for tracking." });
        }

        for (const product of products) {
            const scrapeResult = await scrapeProductData(product.product_url);
            await supabase.from("scrape_logs").insert([{
                product_name: product.product_name,
                price: scrapeResult.price,
                stock: scrapeResult.stock,
                outcome: scrapeResult.outcome
            }]);
        }
        
        console.log("[INFO] Scraping cycle concluded successfully.\n");
        isScrapingActive = false;
        return res.status(200).json({ message: "Scraping cycle concluded successfully." });

    } catch (err) {
        console.error("[ERROR] Critical failure encountered: " + err.message);
        isScrapingActive = false;
        return res.status(500).json({ error: "Internal server error." });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log("[INFO] Scraper service initialized on port " + PORT);
});