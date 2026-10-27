"use strict";
// Rasterize the existing Dashboard mascot; no separate brand artwork to maintain.
const fs=require("node:fs");
const path=require("node:path");
const {chromium}=require("playwright");
const root=path.resolve(__dirname,"..");
(async()=>{
  const html=fs.readFileSync(path.join(root,"extension/dashboard.html"),"utf8");
  const gradient=html.match(/<linearGradient id="bag-fill"[\s\S]*?<\/linearGradient>/)?.[0];
  const mascot=html.match(/<symbol id="mascot"[^>]*>([\s\S]*?)<\/symbol>/)?.[1];
  if(!gradient || !mascot)throw new Error("Dashboard mascot not found");
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({deviceScaleFactor:1});
    await page.route("**/*",route=>route.abort());
    for(const size of [16,32,48,128]){
      await page.setViewportSize({width:size,height:size});
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${gradient}</defs>${mascot}</svg>`);
      await page.screenshot({path:path.join(root,`extension/icon-${size}.png`),omitBackground:true});
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
