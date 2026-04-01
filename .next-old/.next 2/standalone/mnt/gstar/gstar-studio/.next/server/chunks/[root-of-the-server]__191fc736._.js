module.exports=[59639,(e,t,a)=>{t.exports=e.x("node:process",()=>require("node:process"))},12057,(e,t,a)=>{t.exports=e.x("node:util",()=>require("node:util"))},93695,(e,t,a)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},18622,(e,t,a)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},56704,(e,t,a)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,t,a)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},24725,(e,t,a)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},24361,(e,t,a)=>{t.exports=e.x("util",()=>require("util"))},14747,(e,t,a)=>{t.exports=e.x("path",()=>require("path"))},22734,(e,t,a)=>{t.exports=e.x("fs",()=>require("fs"))},54799,(e,t,a)=>{t.exports=e.x("crypto",()=>require("crypto"))},874,(e,t,a)=>{t.exports=e.x("buffer",()=>require("buffer"))},92509,(e,t,a)=>{t.exports=e.x("url",()=>require("url"))},24836,(e,t,a)=>{t.exports=e.x("https",()=>require("https"))},46786,(e,t,a)=>{t.exports=e.x("os",()=>require("os"))},21517,(e,t,a)=>{t.exports=e.x("http",()=>require("http"))},55004,(e,t,a)=>{t.exports=e.x("tls",()=>require("tls"))},4446,(e,t,a)=>{t.exports=e.x("net",()=>require("net"))},49719,(e,t,a)=>{t.exports=e.x("assert",()=>require("assert"))},29946,48916,27651,29966,e=>{"use strict";var t=e.i(54799);let a=new Uint8Array(256),r=a.length;function o(){return r>a.length-16&&(t.default.randomFillSync(a),r=0),a.slice(r,r+=16)}e.s(["default",()=>o],48916);let n=/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i,s=function(e){return"string"==typeof e&&n.test(e)};e.s(["default",0,s],27651);let i=[];for(let e=0;e<256;++e)i.push((e+256).toString(16).substr(1));let l=function(e,t=0){let a=(i[e[t+0]]+i[e[t+1]]+i[e[t+2]]+i[e[t+3]]+"-"+i[e[t+4]]+i[e[t+5]]+"-"+i[e[t+6]]+i[e[t+7]]+"-"+i[e[t+8]]+i[e[t+9]]+"-"+i[e[t+10]]+i[e[t+11]]+i[e[t+12]]+i[e[t+13]]+i[e[t+14]]+i[e[t+15]]).toLowerCase();if(!s(a))throw TypeError("Stringified UUID is invalid");return a};e.s(["default",0,l],29966),e.s(["default",0,function(e,t,a){let r=(e=e||{}).random||(e.rng||o)();if(r[6]=15&r[6]|64,r[8]=63&r[8]|128,t){a=a||0;for(let e=0;e<16;++e)t[a+e]=r[e];return t}return l(r)}],29946)},83728,e=>{"use strict";let t=`CRITICAL REALISM RULES — the model must look like a REAL person, NOT AI-generated:

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
- LIGHTING: Even, soft studio lighting showing real skin texture.`,a=`ABSOLUTE RULES — "If you don't know, don't show" (Learning #33):
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
- The mannequin sits on a raised wheeled stand — IGNORE the stand and the hem height it creates`,r={pants:`CRITICAL — BODY SHAPE & 3D DENIM FIT (Learning #30 — "Denim starts from the back"):
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
- Do NOT make these floor-length — that is the WRONG look`,s=new Set(["M01","M02"]);function i(e){let{modelDescription:i,garmentDescription:l,shotDescription:h,garmentCategory:d,metadata:c,modifications:u,productCritical:p,shotType:g}=e,m=r[d]||r.default,f="";c.waistHeight&&(f+=`
Waist height: ${c.waistHeight}.`),c.fitDescription&&(f+=`
Fit: ${c.fitDescription}.`);let b="",T=c.floorDistance;"0"===T||"0 - touching"===T?(b=`
${o}`,f+=`
Hem: FLOOR-LENGTH — hems touch/nearly touch the ground.`):T&&(b=`
${n}`,f+=`
Hem distance to floor: ${T}.`);let E="";u?.length&&(E=`

ADDITIONAL MODIFICATIONS (apply these adjustments):
${u.map((e,t)=>`${t+1}. ${e}`).join("\n")}`);let O="";return p&&(O=`

PRODUCT-SPECIFIC CRITICAL RULES:
${p}`),["Generate a fashion editorial photograph for G-Star RAW e-commerce.",`
IMPORTANT: The garment reference images provided above show the EXACT garment to be worn. The model must wear THIS SPECIFIC GARMENT — match every detail: fabric, color, fit, seams, pockets, closures, stitching. Do NOT substitute with any other garment.`,`
FABRIC COLOR — CRITICAL (Learning #44): The color/wash of the garment is defined by the mannequin reference images ONLY. Do NOT shift, lighten, darken, or reinterpret the color. If the mannequin shows dark indigo denim, render dark indigo. If it shows light grey, render light grey. Match the exact shade and wash as photographed. The text description is secondary — the images are the truth.`,`
IMAGE-DRIVEN GENERATION (Learning #1 — THE #1 LESSON):`,"The reference images ARE the specification. Minimize reliance on text description.",`Copy EXACTLY what you see in the images. DO NOT describe garment hardware in text — let the images specify buttons, zips, rivets, labels.`,`
MODEL: ${i}`,`
GARMENT (text supplements reference images): ${l}${f}`,`
POSE & FRAMING: ${h}`,s.has(g||"")?`CRITICAL FRAMING — THIS IS A CROPPED PRODUCT SHOT, NOT A PORTRAIT:
The camera is positioned at WAIST HEIGHT and frames ONLY the lower half of the body.
WHAT IS VISIBLE: waistband → legs → feet/shoes. That is ALL.
WHAT IS NOT VISIBLE: head, face, shoulders, chest, arms — they are ABOVE the camera frame and do not appear.
Imagine a photographer kneeling and photographing only from the waist down. The head is cut off by the top of the frame.
The garment (jeans/pants) fills the full height of the image from waistband to ankle.
If a head appears in this image it is a critical failure.`:"Full body visible from top of head to shoes/feet.",`BACKGROUND — PURE WHITE (#FFFFFF) studio seamless background. This is NON-NEGOTIABLE. NO grey, NO colored, NO tinted, NO warm/cool cast backgrounds. The background MUST be pure white (#FFFFFF). Any non-white background is a critical failure.`,s.has(g||"")?`
CROPPED SHOT — HEAD/FACE RULES SUPPRESSED: This is a waist-to-ankle product shot. No head, face, or expression rules apply. Focus only on: leg proportions, fabric drape, garment fit, and shoe style.`:`
${t}`,`
${m}`,b,`
${a}`,`
HARDWARE COLOR (Learning #37): If the garment has snap buttons, render them in the SAME COLOR as the mannequin reference. Dark snaps = DARK. NOT white, NOT pearl, NOT silver.`,O,E].filter(Boolean).join("\n")}function l(e){let{shotType:t,garmentCategory:a,garmentDescription:r,metadata:o}=e,n=o.floorDistance||"";return`You are a Quality Control expert for G-Star RAW e-commerce photography.
Compare the AI-generated model photo against the original garment reference images.

GARMENT: ${r}
CATEGORY: ${a}
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
Score: 10=clean, 4-6=one invented, 1-3=multiple invented. pass=true if score>=7`}e.s(["REF_LABELS",0,{modelCard:"MODEL IDENTITY REFERENCE. The person in the generated image MUST be this exact same person — same face, same features, same body type, same skin tone.",flatImage:"GARMENT FLAT IMAGE — #1 reference for width and proportions. This shows the TRUE garment width without mannequin distortion. Reproduce this width/fit EXACTLY.",mannequinFront:"GARMENT ON MANNEQUIN (front view). Copy every visible detail: seams, pockets, hardware, stitching.",mannequinSide:"GARMENT ON MANNEQUIN (side view). Shows 3D construction and sculptured seat shape.",mannequinBack:"GARMENT ON MANNEQUIN (back view). The BACK PANEL is PLAIN unless shown otherwise here.",zoneGrid:(e,t,a)=>`CONSTRUCTION DETAIL GRID ${t}/${a}: ${e} zone from multiple angles. Copy seam patterns, hardware, and trim EXACTLY as shown.`},"ZONE_DEFS",0,{pants:{hip:{y1:.38,y2:.55,x1:.15,x2:.85,angles:[0,1,2,4],name:"Hip Zone — waistband, pockets, rivets, topstitching"},knee:{y1:.5,y2:.7,x1:.15,x2:.85,angles:[0,1,2,4],name:"Knee Zone — thigh to knee, seam construction"},ankle:{y1:.68,y2:.85,x1:.15,x2:.85,angles:[0,1,2,4],name:"Ankle Zone — hem, cuffs, leg opening"},back:{y1:.38,y2:.55,x1:.15,x2:.85,angles:[3,4,5],name:"Back Hip Zone — back pockets, yoke, labels"}},jackets:{collar:{y1:0,y2:.2,x1:.15,x2:.85,angles:[0,1,6],name:"Collar Zone"},chest:{y1:.15,y2:.5,x1:.15,x2:.85,angles:[0,1,6,9],name:"Chest Zone"},sleeve:{y1:.2,y2:.6,x1:0,x2:.4,angles:[3,9],name:"Sleeve Zone"},back:{y1:0,y2:.5,x1:.15,x2:.85,angles:[5,6,7],name:"Back Zone"}},default:{upper:{y1:0,y2:.4,x1:.15,x2:.85,angles:[0,1,6],name:"Upper Zone"},lower:{y1:.4,y2:1,x1:.15,x2:.85,angles:[0,1,6],name:"Lower Zone"}}},"buildGenerationPrompt",()=>i,"buildLabelQCPrompt",()=>h,"buildQCPrompt",()=>l])},35139,e=>{"use strict";e.s(["SHOT_DESCRIPTIONS",0,{M01:"CROPPED FRONT — camera positioned at WAIST/HIP LEVEL pointing straight at the garment. The image frame starts at the waistband and ends just below the ankle. The HEAD, FACE, and UPPER TORSO are COMPLETELY OUTSIDE the frame — they do NOT appear in the image at all. Only legs, garment, and feet visible. Front-facing stance, arms at sides. PANTS OVER SHOES: the pant leg drapes OVER the shoe — never tucked in, never ending above the shoe shaft.",M02:"CROPPED BACK — camera positioned at WAIST/HIP LEVEL, BACK VIEW. The image frame starts at the waistband and ends just below the ankle. The HEAD, FACE, and UPPER TORSO are COMPLETELY OUTSIDE the frame — they do NOT appear in the image at all. Only legs, garment back, and feet visible. Natural back-facing stance showing rear construction. PANTS OVER SHOES: the pant leg drapes OVER the shoe — never tucked in.","M03-A":"FULL BODY — head to toe visible. FRONT-FACING pose. Model looks directly into camera. Arms relaxed at sides. Feet hip-width apart, equal weight, confident neutral stance. PANTS OVER SHOES: pant leg falls ON TOP of the shoe.","M03-B":"FULL BODY — head to toe visible. FRONT-FACING pose, weight shifted to ONE LEG. Model faces the camera directly (NOT a 3/4 turn, NOT a side view). One leg bears the full weight, opposite hip slightly raised. Arms relaxed. Same camera angle as M03-A but with a natural weight-shift — standing on one leg, relaxed posture. Do NOT rotate the body. PANTS OVER SHOES: pant leg falls ON TOP of the shoe.",M04:"FULL BODY — head to toe visible. Back view, head turned slightly looking over shoulder. Natural confident expression. PANTS OVER SHOES: pant leg falls ON TOP of the shoe.",M05:"EXTREME CLOSE-UP DETAIL SHOT — NOT a full body shot. Camera zoomed in tight on the most interesting construction detail of the garment: waistband area, pocket construction, hardware (buttons/rivets/zippers), seam work, or hem detail. The garment fabric fills the ENTIRE frame. No full body visible. No face. No person. This is a macro/close-up product detail photograph showing texture and construction at high magnification. LANDSCAPE orientation (4:3). Fill the frame with fabric and detail.",M06:"FULL BODY — head to toe visible. Casual lifestyle pose: model is SEATED on a stool or leaning casually against a wall — NOT standing upright. Natural relaxed attitude, one hand in pocket or resting on knee. The model wears ONLY the garment and wardrobe items provided — DO NOT add any jacket, overshirt, cardigan, or outer layer that was not in the reference images. PANTS OVER SHOES: pant leg falls ON TOP of the shoe."}])},5693,e=>{"use strict";var t=e.i(22509),a=e.i(18139),r=e.i(25362),o=e.i(22206),n=e.i(82686),s=e.i(13500),i=e.i(65790),l=e.i(5762),h=e.i(23332),d=e.i(21501),c=e.i(46632),u=e.i(16375),p=e.i(21490),g=e.i(1765),m=e.i(61943),f=e.i(93695);e.i(31679);var b=e.i(61339),T=e.i(30373),E=e.i(10004),O=e.i(83728),N=e.i(35139),w=e.i(65963);let R={pants:"pants",jackets:"jacket",tops:"shirt",knitwear:"shirt"};async function A(t){try{let t=await (0,E.listJobs)(),a=t.filter(e=>"generating"===e.status||"uploading"===e.status);if(a.length>0){let{listShots:t,updateJobStatus:r}=await e.A(5209);await Promise.all(a.map(async e=>{try{let a=e.jobId||e.id,o=await t(a);if(0===o.length)return;let n=o.every(e=>"approved"===e.status),s=o.every(e=>"done"===e.status||"approved"===e.status);n?(await r(a,"complete"),e.status="complete"):s&&(await r(a,"review"),e.status="review")}catch{}}))}return T.NextResponse.json({jobs:t})}catch(e){return console.error("Error listing jobs:",e),T.NextResponse.json({error:"Failed to list jobs"},{status:500})}}async function y(e){try{let{designNumber:t,jobName:a,creatorEmail:r,garmentCategory:o,description:n,metadata:s,modelIds:i,modelDescriptions:l,flatImageBase64:h,flatImageMimeType:d,images360Base64:c,wardrobeItemIds:u,flatImageUrl:p,image360Urls:g}=await e.json();if(!t||!o||!n||!i?.length)return T.NextResponse.json({error:"Missing required fields"},{status:400});let m=p||"";if(!m&&h){let e=Buffer.from(h,"base64"),a=d||"image/jpeg",r=a.includes("png")?"png":"jpg";m=await (0,w.uploadGarmentImage)(t,"flat",`flat.${r}`,e,a),console.log(`[Job] Flat image uploaded: ${m}`)}let f=g?.length?g:[];if(!f.length&&c?.length){let e=Math.min(c.length,4);for(let a=0;a<e;a++){let e=Buffer.from(c[a],"base64"),r=await (0,w.uploadGarmentImage)(t,"360",`360_${String(a).padStart(2,"0")}.jpg`,e);f.push(r)}console.log(`[Job] ${f.length} 360\xb0 images uploaded`)}else g?.length&&console.log(`[Job] Using ${f.length} pre-existing 360\xb0 GCS URLs`);let b=await (0,E.createJob)({designNumber:t,creatorEmail:r,garmentCategory:o,description:n,metadata:s||{},modelIds:i}),A={};a&&(A.jobName=a),m&&(A.flatImageUrl=m),f.length&&(A.image360Urls=f),u&&Object.keys(u).length>0&&(A.wardrobeItemIds=u),Object.keys(A).length>0&&await E.jobsCol.doc(b).update(A);let y=R[o];if(y&&(m||f.length>0))try{let e=await E.wardrobeCol.where("name","==",t).limit(1).get();if(e.empty){let e=await (0,E.createWardrobeItem)({name:t,category:y,description:n.slice(0,400),imageUrls:f,flatImageUrl:m||void 0,thumbnailUrl:f[0]||m||""});await E.jobsCol.doc(b).update({garmentWardrobeId:e}),console.log(`[Job] Auto-created wardrobe item ${e} for ${t}`)}else{let a=e.docs[0].id,r={updatedAt:new Date};f.length&&(r.imageUrls=f,r.thumbnailUrl=f[0]),m&&(r.flatImageUrl=m),await E.wardrobeCol.doc(a).update(r),await E.jobsCol.doc(b).update({garmentWardrobeId:a}),console.log(`[Job] Updated wardrobe item ${a} for ${t}`)}}catch(e){console.error("[Job] Auto-wardrobe save failed (non-blocking):",e)}let I=[];for(let e of i){let t=l?.[e]||"";for(let[a,r]of Object.entries(N.SHOT_DESCRIPTIONS)){let i=a.replace("-A","").replace("-B",""),l=a.includes("-B")?"B":"A",h=(0,O.buildGenerationPrompt)({modelDescription:t,garmentDescription:n,shotDescription:r,garmentCategory:o,metadata:s||{},shotType:i}),d=await (0,E.createShot)({jobId:b,modelId:e,shotType:i,variant:l,prompt:h});I.push(d)}}return await (0,E.updateJobStatus)(b,"generating"),console.log(`[Job] Created ${I.length} shots for job ${b}. Generation will be triggered by the results page.`),T.NextResponse.json({success:!0,jobId:b,shotsCreated:I.length})}catch(e){return console.error("Error creating job:",e),T.NextResponse.json({error:"Failed to create job"},{status:500})}}e.s(["GET",()=>A,"POST",()=>y],8717);var I=e.i(8717);let S=new t.AppRouteRouteModule({definition:{kind:a.RouteKind.APP_ROUTE,page:"/api/jobs/route",pathname:"/api/jobs",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/mnt/gstar/gstar-studio/src/app/api/jobs/route.ts",nextConfigOutput:"standalone",userland:I}),{workAsyncStorage:v,workUnitAsyncStorage:C,serverHooks:x}=S;function L(){return(0,r.patchFetch)({workAsyncStorage:v,workUnitAsyncStorage:C})}async function k(e,t,r){S.isDev&&(0,o.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let T="/api/jobs/route";T=T.replace(/\/index$/,"")||"/";let E=await S.prepare(e,t,{srcPage:T,multiZoneDraftMode:!1});if(!E)return t.statusCode=400,t.end("Bad Request"),null==r.waitUntil||r.waitUntil.call(r,Promise.resolve()),null;let{buildId:O,params:N,nextConfig:w,parsedUrl:R,isDraftMode:A,prerenderManifest:y,routerServerContext:I,isOnDemandRevalidate:v,revalidateOnlyGenerated:C,resolvedPathname:x,clientReferenceManifest:L,serverActionsManifest:k}=E,D=(0,i.normalizeAppPath)(T),P=!!(y.dynamicRoutes[D]||y.routes[x]),U=async()=>((null==I?void 0:I.render404)?await I.render404(e,t,R,!1):t.end("This page could not be found"),null);if(P&&!A){let e=!!y.routes[x],t=y.dynamicRoutes[D];if(t&&!1===t.fallback&&!e){if(w.experimental.adapterPath)return await U();throw new f.NoFallbackError}}let H=null;!P||S.isDev||A||(H="/index"===(H=x)?"/":H);let F=!0===S.isDev||!P,M=P&&!F;k&&L&&(0,s.setManifestsSingleton)({page:T,clientReferenceManifest:L,serverActionsManifest:k});let j=e.method||"GET",q=(0,n.getTracer)(),G=q.getActiveScopeSpan(),_={params:N,prerenderManifest:y,renderOpts:{experimental:{authInterrupts:!!w.experimental.authInterrupts},cacheComponents:!!w.cacheComponents,supportsDynamicResponse:F,incrementalCache:(0,o.getRequestMeta)(e,"incrementalCache"),cacheLifeProfiles:w.cacheLife,waitUntil:r.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,a,r,o)=>S.onRequestError(e,t,r,o,I)},sharedContext:{buildId:O}},$=new l.NodeNextRequest(e),Y=new l.NodeNextResponse(t),B=h.NextRequestAdapter.fromNodeNextRequest($,(0,h.signalFromNodeResponse)(t));try{let s=async e=>S.handle(B,_).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let a=q.getRootSpanAttributes();if(!a)return;if(a.get("next.span_type")!==d.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${a.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let r=a.get("next.route");if(r){let t=`${j} ${r}`;e.setAttributes({"next.route":r,"http.route":r,"next.span_name":t}),e.updateName(t)}else e.updateName(`${j} ${T}`)}),i=!!(0,o.getRequestMeta)(e,"minimalMode"),l=async o=>{var n,l;let h=async({previousCacheEntry:a})=>{try{if(!i&&v&&C&&!a)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let n=await s(o);e.fetchMetrics=_.renderOpts.fetchMetrics;let l=_.renderOpts.pendingWaitUntil;l&&r.waitUntil&&(r.waitUntil(l),l=void 0);let h=_.renderOpts.collectedTags;if(!P)return await (0,u.sendResponse)($,Y,n,_.renderOpts.pendingWaitUntil),null;{let e=await n.blob(),t=(0,p.toNodeOutgoingHttpHeaders)(n.headers);h&&(t[m.NEXT_CACHE_TAGS_HEADER]=h),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let a=void 0!==_.renderOpts.collectedRevalidate&&!(_.renderOpts.collectedRevalidate>=m.INFINITE_CACHE)&&_.renderOpts.collectedRevalidate,r=void 0===_.renderOpts.collectedExpire||_.renderOpts.collectedExpire>=m.INFINITE_CACHE?void 0:_.renderOpts.collectedExpire;return{value:{kind:b.CachedRouteKind.APP_ROUTE,status:n.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:a,expire:r}}}}catch(t){throw(null==a?void 0:a.isStale)&&await S.onRequestError(e,t,{routerKind:"App Router",routePath:T,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:M,isOnDemandRevalidate:v})},!1,I),t}},d=await S.handleResponse({req:e,nextConfig:w,cacheKey:H,routeKind:a.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:y,isRoutePPREnabled:!1,isOnDemandRevalidate:v,revalidateOnlyGenerated:C,responseGenerator:h,waitUntil:r.waitUntil,isMinimalMode:i});if(!P)return null;if((null==d||null==(n=d.value)?void 0:n.kind)!==b.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==d||null==(l=d.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});i||t.setHeader("x-nextjs-cache",v?"REVALIDATED":d.isMiss?"MISS":d.isStale?"STALE":"HIT"),A&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let f=(0,p.fromNodeOutgoingHttpHeaders)(d.value.headers);return i&&P||f.delete(m.NEXT_CACHE_TAGS_HEADER),!d.cacheControl||t.getHeader("Cache-Control")||f.get("Cache-Control")||f.set("Cache-Control",(0,g.getCacheControlHeader)(d.cacheControl)),await (0,u.sendResponse)($,Y,new Response(d.value.body,{headers:f,status:d.value.status||200})),null};G?await l(G):await q.withPropagatedContext(e.headers,()=>q.trace(d.BaseServerSpan.handleRequest,{spanName:`${j} ${T}`,kind:n.SpanKind.SERVER,attributes:{"http.method":j,"http.target":e.url}},l))}catch(t){if(t instanceof f.NoFallbackError||await S.onRequestError(e,t,{routerKind:"App Router",routePath:D,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:M,isOnDemandRevalidate:v})},!1,I),P)throw t;return await (0,u.sendResponse)($,Y,new Response(null,{status:500})),null}}e.s(["handler",()=>k,"patchFetch",()=>L,"routeModule",()=>S,"serverHooks",()=>x,"workAsyncStorage",()=>v,"workUnitAsyncStorage",()=>C],5693)},85685,e=>{e.v(e=>Promise.resolve().then(()=>e(54799)))},21955,e=>{e.v(e=>Promise.resolve().then(()=>e(69382)))},46665,e=>{e.v(t=>Promise.all(["server/chunks/95419_node-fetch_src_utils_multipart-parser_63112e24.js","server/chunks/[root-of-the-server]__f454263b._.js","server/chunks/[root-of-the-server]__7773ed47._.js"].map(t=>e.l(t))).then(()=>t(21245)))},5209,e=>{e.v(e=>Promise.resolve().then(()=>e(10004)))}];

//# sourceMappingURL=%5Broot-of-the-server%5D__191fc736._.js.map