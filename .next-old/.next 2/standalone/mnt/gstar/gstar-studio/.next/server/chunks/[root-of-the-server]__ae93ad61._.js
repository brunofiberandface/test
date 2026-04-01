module.exports=[59639,(e,t,r)=>{t.exports=e.x("node:process",()=>require("node:process"))},12057,(e,t,r)=>{t.exports=e.x("node:util",()=>require("node:util"))},93695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},18622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},56704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},24725,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},24361,(e,t,r)=>{t.exports=e.x("util",()=>require("util"))},14747,(e,t,r)=>{t.exports=e.x("path",()=>require("path"))},22734,(e,t,r)=>{t.exports=e.x("fs",()=>require("fs"))},54799,(e,t,r)=>{t.exports=e.x("crypto",()=>require("crypto"))},874,(e,t,r)=>{t.exports=e.x("buffer",()=>require("buffer"))},92509,(e,t,r)=>{t.exports=e.x("url",()=>require("url"))},24836,(e,t,r)=>{t.exports=e.x("https",()=>require("https"))},46786,(e,t,r)=>{t.exports=e.x("os",()=>require("os"))},21517,(e,t,r)=>{t.exports=e.x("http",()=>require("http"))},55004,(e,t,r)=>{t.exports=e.x("tls",()=>require("tls"))},4446,(e,t,r)=>{t.exports=e.x("net",()=>require("net"))},49719,(e,t,r)=>{t.exports=e.x("assert",()=>require("assert"))},29946,48916,27651,29966,e=>{"use strict";var t=e.i(54799);let r=new Uint8Array(256),a=r.length;function o(){return a>r.length-16&&(t.default.randomFillSync(r),a=0),r.slice(a,a+=16)}e.s(["default",()=>o],48916);let n=/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i,s=function(e){return"string"==typeof e&&n.test(e)};e.s(["default",0,s],27651);let i=[];for(let e=0;e<256;++e)i.push((e+256).toString(16).substr(1));let l=function(e,t=0){let r=(i[e[t+0]]+i[e[t+1]]+i[e[t+2]]+i[e[t+3]]+"-"+i[e[t+4]]+i[e[t+5]]+"-"+i[e[t+6]]+i[e[t+7]]+"-"+i[e[t+8]]+i[e[t+9]]+"-"+i[e[t+10]]+i[e[t+11]]+i[e[t+12]]+i[e[t+13]]+i[e[t+14]]+i[e[t+15]]).toLowerCase();if(!s(r))throw TypeError("Stringified UUID is invalid");return r};e.s(["default",0,l],29966),e.s(["default",0,function(e,t,r){let a=(e=e||{}).random||(e.rng||o)();if(a[6]=15&a[6]|64,a[8]=63&a[8]|128,t){r=r||0;for(let e=0;e<16;++e)t[r+e]=a[e];return t}return l(a)}],29946)},83728,e=>{"use strict";let t=`CRITICAL REALISM RULES — the model must look like a REAL person, NOT AI-generated:

ANATOMICAL PROPORTIONS — 8-head-unit system (classical standard, verified against anatomy chart):
The body is divided into 8 equal head-heights. All measurements below are % of total body height.

- HEAD: 12.5% of total height (1/8). Small. Crown to chin only. AI makes heads too large — shrink it.

- ARMS (most common AI failure — arms always too long):
  • Shoulder: 16.7% from top
  • Elbow: 37.5% from top — aligns with NATURAL WAIST (not the trouser/underwear waistband)
  • WRIST: 56.25% from top — at UPPER THIGH, halfway between crotch and mid-thigh
    → Wrist hangs ~1.5 head-heights below the underwear waistband
    → Wrist hangs ~0.5 head-heights below the crotch line
    → Wrist does NOT reach the knee (75%). If wrists are near the knee = arms too long by 2+ head-heights
  • Fingertips: 62.5% from top — MID-THIGH ONLY. Not knee, not below knee.
  • Total arm length (shoulder to fingertip) = 49% of total body height

- BODY MIDPOINT: The crotch (pubic area) falls at exactly 50% of total height — the exact center.
- WAIST (natural): 37.5% from top. The trouser/underwear waistband typically sits at ~43-44% (between waist and crotch).
- KNEES: 75% from top. Wrists must never reach this level.
- SHOULDERS: 2 head-widths wide (female), 2.5 (male). Natural, not football-player wide.
- LEGS: 50% of total height (crotch to heels).

IDENTITY — match the model card EXACTLY across ALL shots:
- HAIR: Same color, same length, same style as the model card. Do NOT change hair between shots.
- FACE: Same facial features, skin tone, face shape as the model card. One person, consistent.
- BODY TYPE: Same build, same proportions as shown in the model card.

REALISM:
- SKIN: Natural texture — visible pores, slight unevenness, natural shine. NOT airbrushed.
- EXPRESSION: Confident, calm, alive. NOT depressed, NOT bored. "Fashion editorial between shots."
- LIGHTING: Even, soft studio lighting showing real skin texture.`,r=`ABSOLUTE RULES — "If you don't know, don't show" (Learning #33):
- Reproduce the garment EXACTLY as shown in the reference images
- DO NOT invent ANY detail not visible in the references
- DO NOT add logos, text, labels, patches, or features NOT in the references
- DO NOT add any belt, bag, or accessories unless specified
- The pocket openings, shape, and placement are UNIQUE — copy EXACTLY from references
- IF YOU DON'T KNOW, DON'T SHOW — if a detail is not clearly visible, leave it out
- The BACK PANEL is PLAIN unless the reference shows otherwise — NO logos, NO prints, NO embroidery, NO branded patterns (Learning #34)
- For zip closures: show ONLY what's visible from the OUTSIDE. If closed, NO zip teeth/interior visible (Learning #33)
- DO NOT add leather patches, paper labels, or any branding to the back hem of jackets/tops unless CLEARLY visible in references (Learning #36)
- DO NOT hallucinate labels — if a label is not visible in the mannequin reference, it does NOT exist (Learning #42)

CRITICAL — DO NOT ADD GARMENTS NOT IN REFERENCES:
- DO NOT add any jacket, overshirt, cardigan, blazer, coat, or outer layer UNLESS it appears in the wardrobe reference images
- DO NOT add any top, shirt, or layer UNLESS it appears in the wardrobe reference images
- The model wears ONLY what is shown in the provided reference images — nothing more
- Inventing extra clothing layers is a critical failure

MANNEQUIN ARTIFACTS — DO NOT REPRODUCE (Learning #24):
- Elastic bands, mounting straps, clips, pins, or support structures
- Black bands/straps holding garment to mannequin torso
- These are mannequin artifacts, NOT part of the garment
- The mannequin sits on a raised wheeled stand — IGNORE the stand and the hem height it creates`,a={pants:`CRITICAL — BODY SHAPE & 3D DENIM FIT (Learning #30 — "Denim starts from the back"):
- G-Star's brand DNA: "Denim starts from the back." The rear/bum MUST be visible and shape the denim.
- The 3D construction SCULPTS the seat area — fabric curves around the bum before dropping into the legs.
- Model should NOT look like a flat tube from hip to leg. Visible bum shape required.
- From the side: clear curve at the rear, then fabric drops into legs.
- From the back: 3D seams follow body contour around the seat.
- From the front: slight 3/4 angle so body shape is visible (not dead flat).
- Keep it natural and subtle — not exaggerated, not vulgar. Real body in well-constructed denim.

CRITICAL — PANTS ALWAYS OVER SHOES (non-negotiable, every shot):
- The pant leg falls ON TOP of the shoe/boot. The fabric drapes over and rests on the shoe.
- NEVER show pants tucked INTO boots. NEVER show the boot shaft penetrating through the pant hem.
- NEVER show the pants ending mid-boot with the boot visible above the hem.
- The shoe is partially or mostly hidden under the wide leg opening — only the toe and sole visible.
- Wide-leg denim with boots: the entire boot shaft is hidden. Only the very toe of the boot shows.`,jackets:`CRITICAL — BODY SHAPE & FIT:
- The model should have natural body proportions visible under the jacket.
- Shoulders should match the jacket's structure.
- The jacket should show natural body movement and drape, not hang stiffly.
- Keep it natural and editorial — real body in well-constructed outerwear.
- For zip jackets: the zip goes ALL THE WAY from hem to collar — this is design-critical (Learning #33).`,default:`CRITICAL — BODY SHAPE:
- Natural body proportions visible under the garment.
- Clothing should drape naturally, not stiffly.
- Keep it natural and editorial.`},o=`CRITICAL — FLOOR-LENGTH HEM OVERRIDE (Learning #31):
- IGNORE the mannequin's hem height — the mannequin has a RAISED STAND
- The denim hem sits ON TOP OF the shoe, resting on it
- You should only see the sole of the shoe and maybe 5mm of the toe cap
- The shoe is 90% hidden by denim
- Like wearing jeans that are intentionally too long — the hem breaks heavily on the shoe
- Floor-length means: hems nearly scraping the ground, shoes almost invisible under denim
- NOT ankle-length, NOT 1cm above floor. ON the floor.`,n=`CRITICAL — ANKLE-LENGTH HEM PRECISION (Learning #35):
- ANKLE-LENGTH — the hem ends AT the ankle, showing the FULL SHOE
- This is NOT floor-length — there should be clear space between hem and floor
- The shoe is FULLY VISIBLE below the hem
- Do NOT make these floor-length — that is the WRONG look`,s=new Set(["M01","M02"]);function i(e){let{modelDescription:i,garmentDescription:l,shotDescription:h,garmentCategory:d,metadata:c,modifications:m,productCritical:p,shotType:u}=e,f=a[d]||a.default,g="";c.waistHeight&&(g+=`
Waist height: ${c.waistHeight}.`),c.fitDescription&&(g+=`
Fit: ${c.fitDescription}.`);let T="",b=c.floorDistance;"0"===b||"0 - touching"===b?(T=`
${o}`,g+=`
Hem: FLOOR-LENGTH — hems touch/nearly touch the ground.`):b&&(T=`
${n}`,g+=`
Hem distance to floor: ${b}.`);let w="";m?.length&&(w=`

ADDITIONAL MODIFICATIONS (apply these adjustments):
${m.map((e,t)=>`${t+1}. ${e}`).join("\n")}`);let E="";return p&&(E=`

PRODUCT-SPECIFIC CRITICAL RULES:
${p}`),["Generate a fashion editorial photograph for G-Star RAW e-commerce.",`
IMPORTANT: The garment reference images provided above show the EXACT garment to be worn. The model must wear THIS SPECIFIC GARMENT — match every detail: fabric, color, fit, seams, pockets, closures, stitching. Do NOT substitute with any other garment.`,`
FABRIC COLOR — CRITICAL (Learning #44): The color/wash of the garment is defined by the mannequin reference images ONLY. Do NOT shift, lighten, darken, or reinterpret the color. If the mannequin shows dark indigo denim, render dark indigo. If it shows light grey, render light grey. Match the exact shade and wash as photographed. The text description is secondary — the images are the truth.`,`
IMAGE-DRIVEN GENERATION (Learning #1 — THE #1 LESSON):`,"The reference images ARE the specification. Minimize reliance on text description.",`Copy EXACTLY what you see in the images. DO NOT describe garment hardware in text — let the images specify buttons, zips, rivets, labels.`,`
MODEL: ${i}`,`
GARMENT (text supplements reference images): ${l}${g}`,`
POSE & FRAMING: ${h}`,s.has(u||"")?`CRITICAL FRAMING — THIS IS A CROPPED PRODUCT SHOT, NOT A PORTRAIT:
The camera is positioned at WAIST HEIGHT and frames ONLY the lower half of the body.
WHAT IS VISIBLE: waistband → legs → feet/shoes. That is ALL.
WHAT IS NOT VISIBLE: head, face, shoulders, chest, arms — they are ABOVE the camera frame and do not appear.
Imagine a photographer kneeling and photographing only from the waist down. The head is cut off by the top of the frame.
The garment (jeans/pants) fills the full height of the image from waistband to ankle.
If a head appears in this image it is a critical failure.`:"Full body visible from top of head to shoes/feet.",`BACKGROUND — PURE WHITE (#FFFFFF) studio seamless background. This is NON-NEGOTIABLE. NO grey, NO colored, NO tinted, NO warm/cool cast backgrounds. The background MUST be pure white (#FFFFFF). Any non-white background is a critical failure.`,s.has(u||"")?`
CROPPED SHOT — HEAD/FACE RULES SUPPRESSED: This is a waist-to-ankle product shot. No head, face, or expression rules apply. Focus only on: leg proportions, fabric drape, garment fit, and shoe style.`:`
${t}`,`
${f}`,T,`
${r}`,`
HARDWARE COLOR (Learning #37): If the garment has snap buttons, render them in the SAME COLOR as the mannequin reference. Dark snaps = DARK. NOT white, NOT pearl, NOT silver.`,E,w].filter(Boolean).join("\n")}function l(e){let{shotType:t,garmentCategory:r,garmentDescription:a,metadata:o}=e,n=o.floorDistance||"";return`You are a Quality Control expert for G-Star RAW e-commerce photography.
Compare the AI-generated model photo against the original garment reference images.

GARMENT: ${a}
CATEGORY: ${r}
SHOT TYPE: ${t}

Score each dimension 1-10 with brief justification:

1. SILHOUETTE (weight: 2x) — Match to MANNEQUIN proportions (NOT flat image — flat always looks wider).
   Score 7-9 if proportions match mannequin. Score 1-4 only for wrong fit category.
   ${"0"===n||"0 - touching"===n||"floor"===n?"CRITICAL: FLOOR-LENGTH. Hems MUST touch ground. Shoes 90% hidden.":""}
   ${"M01"===t||"M02"===t?"CRITICAL: CROPPED SHOT — waist to ankle only. Head/upper torso must NOT be visible. Score 1-4 if full body is shown.":""}

2. CONSTRUCTION — Seams, panels, pockets correct?

3. HARDWARE — Buttons, zips, rivets correct type, placement, and COLOR?
   Dark hardware must be dark, not white/pearl/silver.

4. COLOR — Fabric color/wash matches reference?

5. NO_INVENTED — ANY invented details? Labels, patches, logos, patterns not in references?
   Score 1 if ANY invented labels found.

6. ECOMMERCE — Suitable for G-Star product page? Clean bg, editorial quality, human proportions?

RESPOND IN EXACT JSON (no markdown, no backticks):
{"silhouette":{"score":0,"note":""},"construction":{"score":0,"note":""},"hardware":{"score":0,"note":""},"color":{"score":0,"note":""},"no_invented":{"score":0,"note":""},"ecommerce":{"score":0,"note":""},"weighted_score":0,"pass":false,"critical_issues":[],"summary":""}

Calculate weighted_score = (silhouette*2 + construction + hardware + color + no_invented + ecommerce) / 7
Set pass = true if weighted_score >= 6.0`}function h(){return`You are a label/branding QC expert for G-Star RAW.
Compare AI image against ALL mannequin reference images.

1. Inventory EVERY label/patch/tab on the REAL garment (from mannequin photos)
2. Inventory EVERY label/patch/tab in the AI image
3. Flag any in AI that doesn't exist on the real garment

COMMON HALLUCINATIONS: leather back patches, paper waistband labels, wrong patch styles, invented front tabs.

RESPOND IN JSON (no markdown):
{"real_labels":[],"ai_labels":[],"invented_labels":[],"label_score":0,"pass":true}
Score: 10=clean, 4-6=one invented, 1-3=multiple invented. pass=true if score>=7`}e.s(["REF_LABELS",0,{modelCard:"MODEL IDENTITY REFERENCE. The person in the generated image MUST be this exact same person — same face, same features, same body type, same skin tone.",flatImage:"GARMENT FLAT IMAGE — #1 reference for width and proportions. This shows the TRUE garment width without mannequin distortion. Reproduce this width/fit EXACTLY.",mannequinFront:"GARMENT ON MANNEQUIN (front view). Copy every visible detail: seams, pockets, hardware, stitching.",mannequinSide:"GARMENT ON MANNEQUIN (side view). Shows 3D construction and sculptured seat shape.",mannequinBack:"GARMENT ON MANNEQUIN (back view). The BACK PANEL is PLAIN unless shown otherwise here.",zoneGrid:(e,t,r)=>`CONSTRUCTION DETAIL GRID ${t}/${r}: ${e} zone from multiple angles. Copy seam patterns, hardware, and trim EXACTLY as shown.`},"ZONE_DEFS",0,{pants:{hip:{y1:.38,y2:.55,x1:.15,x2:.85,angles:[0,1,2,4],name:"Hip Zone — waistband, pockets, rivets, topstitching"},knee:{y1:.5,y2:.7,x1:.15,x2:.85,angles:[0,1,2,4],name:"Knee Zone — thigh to knee, seam construction"},ankle:{y1:.68,y2:.85,x1:.15,x2:.85,angles:[0,1,2,4],name:"Ankle Zone — hem, cuffs, leg opening"},back:{y1:.38,y2:.55,x1:.15,x2:.85,angles:[3,4,5],name:"Back Hip Zone — back pockets, yoke, labels"}},jackets:{collar:{y1:0,y2:.2,x1:.15,x2:.85,angles:[0,1,6],name:"Collar Zone"},chest:{y1:.15,y2:.5,x1:.15,x2:.85,angles:[0,1,6,9],name:"Chest Zone"},sleeve:{y1:.2,y2:.6,x1:0,x2:.4,angles:[3,9],name:"Sleeve Zone"},back:{y1:0,y2:.5,x1:.15,x2:.85,angles:[5,6,7],name:"Back Zone"}},default:{upper:{y1:0,y2:.4,x1:.15,x2:.85,angles:[0,1,6],name:"Upper Zone"},lower:{y1:.4,y2:1,x1:.15,x2:.85,angles:[0,1,6],name:"Lower Zone"}}},"buildGenerationPrompt",()=>i,"buildLabelQCPrompt",()=>h,"buildQCPrompt",()=>l])},63901,e=>{"use strict";let t=[25e3,35e3,45e3],r=[5e3,1e4,2e4];async function a(e){let{prompt:a,referenceImages:o,referenceImage:n,aspectRatio:s="3:4",imageSize:i="2K"}=e,l=process.env.GEMINI_API_KEY;if(!l)throw Error("GEMINI_API_KEY env var not set");let h=[];if(o?.length)for(let e of o)h.push({inlineData:{mimeType:e.mimeType,data:e.buffer.toString("base64")}}),h.push({text:e.label+"\n\n"});else n&&(h.push({inlineData:{mimeType:"image/png",data:n.toString("base64")}}),h.push({text:"This is the model identity reference photo. The person in the generated image MUST be this exact same person — same face, same features, same body type.\n\n"}));h.push({text:a});let d=`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${l}`;for(let e=0;e<=3;e++)try{let r=await fetch(d,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts:h}],generationConfig:{responseModalities:["IMAGE"],imageConfig:{aspectRatio:s,imageSize:i}}})});if(429===r.status){if(e<3){let r=t[e];console.warn(`[Vertex] Rate limited (429), retrying in ${r/1e3}s (attempt ${e+1}/3)`),await new Promise(e=>setTimeout(e,r));continue}throw Error("Vertex AI rate limited (429) after 3 retries")}if(!r.ok){let e=await r.text();throw Error(`Vertex AI error ${r.status}: ${e}`)}let a=await r.json(),o=a.candidates?.[0];if(!o?.content?.parts){if(e<3){console.warn(`[Vertex] Empty response (safety filter?), retrying (attempt ${e+1}/3)`),await new Promise(r=>setTimeout(r,t[e]));continue}throw Error("No image generated — empty response after retries")}for(let e of o.content.parts)if(e.inlineData)return{imageData:Buffer.from(e.inlineData.data,"base64"),mimeType:e.inlineData.mimeType||"image/png"};throw Error("No image data in response")}catch(s){let a=s.message||"",o=a.includes("429"),n=a.includes("ECONNRESET")||a.includes("ETIMEDOUT")||a.includes("ENOTFOUND")||a.includes("fetch failed");if(e<3&&(o||n)){let s=o?t[e]:r[e];console.warn(`[Vertex] ${n?"Network error":"Rate limit"}, retrying in ${s/1e3}s (attempt ${e+1}/3): ${a.substring(0,120)}`),await new Promise(e=>setTimeout(e,s));continue}throw s}throw Error("Generation failed after all retries")}async function o(e,t){let r=e.replace(/^["']/,"").trim(),o="male"===t?'MANDATORY OUTFIT: G-Star RAW white boxer briefs with wide BLACK elastic waistband featuring bold WHITE "G-STAR" text. Paired with white G-RAW slim t-shirt (small G-RAW logo on left chest, black woven label at neck collar).':`MANDATORY OUTFIT: G-Star RAW white hipster briefs with WHITE elastic waistband featuring repeating BLACK "G-STAR" text. Paired with a plain white tank top — NO logos, NO branding, NO text, NO labels. Simple clean white cotton tank top with thin shoulder straps.`,n=Math.random().toString(36).substring(2,8),s=`Full-body sizing reference photograph — ${n}

Subject: ${r}

${o}

PROPORTIONS — 8-head-unit anatomical system. Total body = 8 \xd7 head-height. All % = from crown of head:
• Crown: 0% — Chin: 12.5% — Shoulders: 16.7%
• Elbow: 37.5% (at natural waist) — Navel: 39.6%
• CROTCH: 50% exactly (body midpoint)
• WRIST: 56.25% — halfway between crotch and mid-thigh. Wrist is 1.5 head-heights below the underwear waistband. This is anatomically correct — the wrist IS below the waistband.
• Fingertips: 62.5% (mid-thigh). Fingers do NOT reach the knee (75%).
• Knee bottom: 75% — Ankle: 87.5% — Heel: 100%

FRAME — what the camera sees, top to bottom:
  [top margin — 3% white space]
  [HEAD — crown to chin = 12.5% of frame height]
  [NECK + SHOULDERS — 16.7%]
  [CHEST + TORSO with G-Star underwear]
  [WAISTBAND with G-STAR text — at 43% of frame]
  [HIPS — widest point at ~44%]
  [UPPER THIGHS — wrists visible here at 56%]
  [KNEES — at 75%]
  [LOWER LEGS + CALVES]
  [BARE FEET flat on white studio floor]
  [bottom margin — white floor surface below feet]

Camera: 35mm, 5 meters from subject. Complete body crown-to-heel in frame. NOT a portrait crop.
Studio: White seamless backdrop, white floor visible.
Pose: Upright, frontal. Arms relaxed at sides. Feet hip-width apart.
Photorealistic. G-STAR waistband text legible.`;try{return(await a({prompt:s,aspectRatio:"9:16",imageSize:"2K"})).imageData.toString("base64")}catch(e){return console.error("Error generating model card:",e),null}}e.s(["generateImage",()=>a,"generateModelCard",()=>o])},77255,(e,t,r)=>{t.exports=e.x("sharp-34890f87f108a0d4",()=>require("sharp-34890f87f108a0d4"))},85685,e=>{e.v(e=>Promise.resolve().then(()=>e(54799)))},21955,e=>{e.v(e=>Promise.resolve().then(()=>e(69382)))},46665,e=>{e.v(t=>Promise.all(["server/chunks/95419_node-fetch_src_utils_multipart-parser_e9ecf510.js","server/chunks/[root-of-the-server]__f454263b._.js","server/chunks/[root-of-the-server]__7773ed47._.js"].map(t=>e.l(t))).then(()=>t(21245)))},23970,e=>{e.v(e=>Promise.resolve().then(()=>e(22734)))},53007,e=>{e.v(e=>Promise.resolve().then(()=>e(77255)))}];

//# sourceMappingURL=%5Broot-of-the-server%5D__ae93ad61._.js.map