// backend/scripts/headed-demo.mjs
// Run this script for screen recording the headed Playwright browser demo!
// Command: node scripts/headed-demo.mjs

import { config } from "dotenv";
config();
import { scrapeProductPrice } from "../dist/scraper/browser.js";

console.log("==========================================================");
console.log("🎬 INE PRICE TRACKER — HEADED SCRAPER DEMO");
console.log("Starting Playwright Chromium browser in HEADED MODE...");
console.log("==========================================================\n");

const demoProducts = [
  { id: "301", name: "Cobalt Sleeve Max" },
  { id: "154", name: "Summit Approach Shoe Mini" },
  { id: "450", name: "Vantablack Smart Bulb Plus" },
];

for (let i = 0; i < demoProducts.length; i++) {
  const p = demoProducts[i];
  console.log(`\n📌 [${i + 1}/${demoProducts.length}] Scraping Product ID ${p.id} (${p.name})...`);
  
  // Scrape with headless=false and slowMo=300 for clear screen recording visualization
  const outcome = await scrapeProductPrice(
    p.id,
    p.id,
    null,
    false, // headless = false (visible browser)
    300,   // slowMo = 300ms delay per action for video readability
  );

  if (outcome.ok) {
    console.log(`✅ SCRAPE SUCCESS!`);
    console.log(`   Price: ₹${outcome.data.price}`);
    console.log(`   Stock: ${outcome.data.stock}`);
    console.log(`   Raw Price Text: "${outcome.data.rawPrice}"`);
  } else {
    console.log(`⚠️ SCRAPE FAILED / RETRIED:`);
    console.log(`   Error Type: ${outcome.errorType}`);
    console.log(`   Error Message: ${outcome.errorMessage}`);
  }

  // Small delay between products for video recording
  await new Promise((r) => setTimeout(r, 2500));
}

console.log("\n==========================================================");
console.log("🎉 HEADED DEMO COMPLETED SUCCESSFULLY!");
console.log("==========================================================");
