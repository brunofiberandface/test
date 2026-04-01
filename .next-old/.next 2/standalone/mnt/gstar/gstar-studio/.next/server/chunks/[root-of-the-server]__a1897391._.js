module.exports=[59639,(e,t,a)=>{t.exports=e.x("node:process",()=>require("node:process"))},12057,(e,t,a)=>{t.exports=e.x("node:util",()=>require("node:util"))},93695,(e,t,a)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},18622,(e,t,a)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},56704,(e,t,a)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,t,a)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},24725,(e,t,a)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},24361,(e,t,a)=>{t.exports=e.x("util",()=>require("util"))},14747,(e,t,a)=>{t.exports=e.x("path",()=>require("path"))},54799,(e,t,a)=>{t.exports=e.x("crypto",()=>require("crypto"))},22734,(e,t,a)=>{t.exports=e.x("fs",()=>require("fs"))},874,(e,t,a)=>{t.exports=e.x("buffer",()=>require("buffer"))},46786,(e,t,a)=>{t.exports=e.x("os",()=>require("os"))},4446,(e,t,a)=>{t.exports=e.x("net",()=>require("net"))},55004,(e,t,a)=>{t.exports=e.x("tls",()=>require("tls"))},49719,(e,t,a)=>{t.exports=e.x("assert",()=>require("assert"))},21517,(e,t,a)=>{t.exports=e.x("http",()=>require("http"))},24836,(e,t,a)=>{t.exports=e.x("https",()=>require("https"))},92509,(e,t,a)=>{t.exports=e.x("url",()=>require("url"))},29946,48916,27651,29966,e=>{"use strict";var t=e.i(54799);let a=new Uint8Array(256),r=a.length;function o(){return r>a.length-16&&(t.default.randomFillSync(a),r=0),a.slice(r,r+=16)}e.s(["default",()=>o],48916);let n=/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i,s=function(e){return"string"==typeof e&&n.test(e)};e.s(["default",0,s],27651);let i=[];for(let e=0;e<256;++e)i.push((e+256).toString(16).substr(1));let l=function(e,t=0){let a=(i[e[t+0]]+i[e[t+1]]+i[e[t+2]]+i[e[t+3]]+"-"+i[e[t+4]]+i[e[t+5]]+"-"+i[e[t+6]]+i[e[t+7]]+"-"+i[e[t+8]]+i[e[t+9]]+"-"+i[e[t+10]]+i[e[t+11]]+i[e[t+12]]+i[e[t+13]]+i[e[t+14]]+i[e[t+15]]).toLowerCase();if(!s(a))throw TypeError("Stringified UUID is invalid");return a};e.s(["default",0,l],29966),e.s(["default",0,function(e,t,a){let r=(e=e||{}).random||(e.rng||o)();if(r[6]=15&r[6]|64,r[8]=63&r[8]|128,t){a=a||0;for(let e=0;e<16;++e)t[a+e]=r[e];return t}return l(r)}],29946)},83728,e=>{"use strict";let t=`CRITICAL REALISM RULES — the model must look like a REAL person, NOT AI-generated:

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
- Do NOT make these floor-length — that is the WRONG look`,s=new Set(["M01","M02"]);function i(e){let{modelDescription:i,garmentDescription:l,shotDescription:h,garmentCategory:d,metadata:c,modifications:p,productCritical:u,shotType:m}=e,g=r[d]||r.default,f="";c.waistHeight&&(f+=`
Waist height: ${c.waistHeight}.`),c.fitDescription&&(f+=`
Fit: ${c.fitDescription}.`);let T="",E=c.floorDistance;"0"===E||"0 - touching"===E?(T=`
${o}`,f+=`
Hem: FLOOR-LENGTH — hems touch/nearly touch the ground.`):E&&(T=`
${n}`,f+=`
Hem distance to floor: ${E}.`);let b="";p?.length&&(b=`

ADDITIONAL MODIFICATIONS (apply these adjustments):
${p.map((e,t)=>`${t+1}. ${e}`).join("\n")}`);let w="";return u&&(w=`

PRODUCT-SPECIFIC CRITICAL RULES:
${u}`),["Generate a fashion editorial photograph for G-Star RAW e-commerce.",`
IMPORTANT: The garment reference images provided above show the EXACT garment to be worn. The model must wear THIS SPECIFIC GARMENT — match every detail: fabric, color, fit, seams, pockets, closures, stitching. Do NOT substitute with any other garment.`,`
FABRIC COLOR — CRITICAL (Learning #44): The color/wash of the garment is defined by the mannequin reference images ONLY. Do NOT shift, lighten, darken, or reinterpret the color. If the mannequin shows dark indigo denim, render dark indigo. If it shows light grey, render light grey. Match the exact shade and wash as photographed. The text description is secondary — the images are the truth.`,`
IMAGE-DRIVEN GENERATION (Learning #1 — THE #1 LESSON):`,"The reference images ARE the specification. Minimize reliance on text description.",`Copy EXACTLY what you see in the images. DO NOT describe garment hardware in text — let the images specify buttons, zips, rivets, labels.`,`
MODEL: ${i}`,`
GARMENT (text supplements reference images): ${l}${f}`,`
POSE & FRAMING: ${h}`,s.has(m||"")?`CRITICAL FRAMING — THIS IS A CROPPED PRODUCT SHOT, NOT A PORTRAIT:
The camera is positioned at WAIST HEIGHT and frames ONLY the lower half of the body.
WHAT IS VISIBLE: waistband → legs → feet/shoes. That is ALL.
WHAT IS NOT VISIBLE: head, face, shoulders, chest, arms — they are ABOVE the camera frame and do not appear.
Imagine a photographer kneeling and photographing only from the waist down. The head is cut off by the top of the frame.
The garment (jeans/pants) fills the full height of the image from waistband to ankle.
If a head appears in this image it is a critical failure.`:"Full body visible from top of head to shoes/feet.",`BACKGROUND — PURE WHITE (#FFFFFF) studio seamless background. This is NON-NEGOTIABLE. NO grey, NO colored, NO tinted, NO warm/cool cast backgrounds. The background MUST be pure white (#FFFFFF). Any non-white background is a critical failure.`,s.has(m||"")?`
CROPPED SHOT — HEAD/FACE RULES SUPPRESSED: This is a waist-to-ankle product shot. No head, face, or expression rules apply. Focus only on: leg proportions, fabric drape, garment fit, and shoe style.`:`
${t}`,`
${g}`,T,`
${a}`,`
HARDWARE COLOR (Learning #37): If the garment has snap buttons, render them in the SAME COLOR as the mannequin reference. Dark snaps = DARK. NOT white, NOT pearl, NOT silver.`,w,b].filter(Boolean).join("\n")}function l(e){let{shotType:t,garmentCategory:a,garmentDescription:r,metadata:o}=e,n=o.floorDistance||"";return`You are a Quality Control expert for G-Star RAW e-commerce photography.
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
Score: 10=clean, 4-6=one invented, 1-3=multiple invented. pass=true if score>=7`}e.s(["REF_LABELS",0,{modelCard:"MODEL IDENTITY REFERENCE. The person in the generated image MUST be this exact same person — same face, same features, same body type, same skin tone.",flatImage:"GARMENT FLAT IMAGE — #1 reference for width and proportions. This shows the TRUE garment width without mannequin distortion. Reproduce this width/fit EXACTLY.",mannequinFront:"GARMENT ON MANNEQUIN (front view). Copy every visible detail: seams, pockets, hardware, stitching.",mannequinSide:"GARMENT ON MANNEQUIN (side view). Shows 3D construction and sculptured seat shape.",mannequinBack:"GARMENT ON MANNEQUIN (back view). The BACK PANEL is PLAIN unless shown otherwise here.",zoneGrid:(e,t,a)=>`CONSTRUCTION DETAIL GRID ${t}/${a}: ${e} zone from multiple angles. Copy seam patterns, hardware, and trim EXACTLY as shown.`},"ZONE_DEFS",0,{pants:{hip:{y1:.38,y2:.55,x1:.15,x2:.85,angles:[0,1,2,4],name:"Hip Zone — waistband, pockets, rivets, topstitching"},knee:{y1:.5,y2:.7,x1:.15,x2:.85,angles:[0,1,2,4],name:"Knee Zone — thigh to knee, seam construction"},ankle:{y1:.68,y2:.85,x1:.15,x2:.85,angles:[0,1,2,4],name:"Ankle Zone — hem, cuffs, leg opening"},back:{y1:.38,y2:.55,x1:.15,x2:.85,angles:[3,4,5],name:"Back Hip Zone — back pockets, yoke, labels"}},jackets:{collar:{y1:0,y2:.2,x1:.15,x2:.85,angles:[0,1,6],name:"Collar Zone"},chest:{y1:.15,y2:.5,x1:.15,x2:.85,angles:[0,1,6,9],name:"Chest Zone"},sleeve:{y1:.2,y2:.6,x1:0,x2:.4,angles:[3,9],name:"Sleeve Zone"},back:{y1:0,y2:.5,x1:.15,x2:.85,angles:[5,6,7],name:"Back Zone"}},default:{upper:{y1:0,y2:.4,x1:.15,x2:.85,angles:[0,1,6],name:"Upper Zone"},lower:{y1:.4,y2:1,x1:.15,x2:.85,angles:[0,1,6],name:"Lower Zone"}}},"buildGenerationPrompt",()=>i,"buildLabelQCPrompt",()=>h,"buildQCPrompt",()=>l])},66012,e=>{"use strict";var t=e.i(22509),a=e.i(18139),r=e.i(25362),o=e.i(22206),n=e.i(82686),s=e.i(13500),i=e.i(65790),l=e.i(5762),h=e.i(23332),d=e.i(21501),c=e.i(46632),p=e.i(16375),u=e.i(21490),m=e.i(1765),g=e.i(61943),f=e.i(93695);e.i(31679);var T=e.i(61339),E=e.i(30373),b=e.i(83728),w=e.i(65963),N=e.i(10004);let O="global";async function R(e){try{let{shotId:t,labelQC:a}=await e.json(),r=await N.shotsCol.doc(t).get();if(!r.exists)return E.NextResponse.json({error:"Shot not found"},{status:404});let o=r.data(),n=(await N.jobsCol.doc(o.jobId).get()).data(),s=[];if(n.flatImageUrl)try{let e=await (0,w.downloadGarmentImage)(n.flatImageUrl);s.push({inlineData:{mimeType:"image/jpeg",data:e.toString("base64")}}),s.push({text:"REFERENCE: Flat garment image (true proportions)\n\n"})}catch(e){console.error("[QC] Failed to load flat image:",e)}if(n.image360Urls?.length)for(let e=0;e<Math.min(n.image360Urls.length,3);e++)try{let t=await (0,w.downloadGarmentImage)(n.image360Urls[e]);s.push({inlineData:{mimeType:"image/jpeg",data:t.toString("base64")}}),s.push({text:`REFERENCE: Mannequin 360\xb0 view ${e+1}

`})}catch(t){console.error(`[QC] Failed to load 360\xb0 image ${e}:`,t)}if(o.driveFileId)try{let e=process.env.NEXTAUTH_URL||"http://localhost:3000",t=await fetch(`${e}/api/images/${o.driveFileId}`);if(t.ok){let e=Buffer.from(await t.arrayBuffer());s.push({inlineData:{mimeType:"image/png",data:e.toString("base64")}}),s.push({text:"AI-GENERATED IMAGE TO EVALUATE:\n\n"})}}catch(e){console.error("[QC] Failed to load generated image:",e)}let i=a?(0,b.buildLabelQCPrompt)():(0,b.buildQCPrompt)({shotType:o.shotType,garmentCategory:n.garmentCategory,garmentDescription:n.description,metadata:n.metadata||{}});s.push({text:i});let l=process.env.GCP_PROJECT_ID,h=`https://${O}-aiplatform.googleapis.com/v1/projects/${l}/locations/${O}/publishers/google/models/gemini-2.5-pro-preview-06-05:generateContent`,d=await y(),c=await fetch(h,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${d}`},body:JSON.stringify({contents:[{parts:s}],generationConfig:{temperature:.2,responseMimeType:"application/json"}})});if(!c.ok){let e=await c.text();throw Error(`QC API error ${c.status}: ${e}`)}let p=await c.json(),u=p.candidates?.[0],m=u?.content?.parts?.find(e=>e.text);if(!m?.text)throw Error("No QC response from Gemini");let g=m.text.trim();g.startsWith("```")&&(g=g.replace(/^```json?\n?/,"").replace(/\n?```$/,""));let f=JSON.parse(g);if(!a&&f.silhouette){let e=(2*f.silhouette.score+f.construction.score+f.hardware.score+f.color.score+f.no_invented.score+f.ecommerce.score)/7;f.weighted_score=Math.round(10*e)/10,f.pass=e>=6}return await N.shotsCol.doc(t).update({qcScores:a?void 0:f,labelQC:a?f:void 0,qcRunAt:new Date,qcPass:f.pass}),console.log(`[QC] Shot ${t}: weighted=${f.weighted_score}, pass=${f.pass}`),E.NextResponse.json({success:!0,shotId:t,qcScores:f})}catch(e){return console.error("QC error:",e),E.NextResponse.json({error:"QC failed",details:String(e)},{status:500})}}async function y(){try{let e=await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",{headers:{"Metadata-Flavor":"Google"}});if(e.ok)return(await e.json()).access_token}catch{}let t=process.env.GOOGLE_APPLICATION_CREDENTIALS;if(!t)throw Error("No credentials for QC");let a=await e.A(23970),r=await e.A(85685),o=JSON.parse(a.readFileSync(t,"utf8")),n=Math.floor(Date.now()/1e3),s={iss:o.client_email,scope:"https://www.googleapis.com/auth/cloud-platform",aud:"https://oauth2.googleapis.com/token",iat:n,exp:n+3600},i=e=>Buffer.from(JSON.stringify(e)).toString("base64url"),l=`${i({alg:"RS256",typ:"JWT"})}.${i(s)}`,h=r.createSign("RSA-SHA256");h.update(l);let d=h.sign(o.private_key,"base64url"),c=`${l}.${d}`,p=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${c}`});return(await p.json()).access_token}e.s(["POST",()=>R],2130);var A=e.i(2130);let I=new t.AppRouteRouteModule({definition:{kind:a.RouteKind.APP_ROUTE,page:"/api/qc/route",pathname:"/api/qc",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/mnt/gstar/gstar-studio/src/app/api/qc/route.ts",nextConfigOutput:"standalone",userland:A}),{workAsyncStorage:C,workUnitAsyncStorage:v,serverHooks:S}=I;function x(){return(0,r.patchFetch)({workAsyncStorage:C,workUnitAsyncStorage:v})}async function L(e,t,r){I.isDev&&(0,o.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let E="/api/qc/route";E=E.replace(/\/index$/,"")||"/";let b=await I.prepare(e,t,{srcPage:E,multiZoneDraftMode:!1});if(!b)return t.statusCode=400,t.end("Bad Request"),null==r.waitUntil||r.waitUntil.call(r,Promise.resolve()),null;let{buildId:w,params:N,nextConfig:O,parsedUrl:R,isDraftMode:y,prerenderManifest:A,routerServerContext:C,isOnDemandRevalidate:v,revalidateOnlyGenerated:S,resolvedPathname:x,clientReferenceManifest:L,serverActionsManifest:k}=b,D=(0,i.normalizeAppPath)(E),P=!!(A.dynamicRoutes[D]||A.routes[x]),F=async()=>((null==C?void 0:C.render404)?await C.render404(e,t,R,!1):t.end("This page could not be found"),null);if(P&&!y){let e=!!A.routes[x],t=A.dynamicRoutes[D];if(t&&!1===t.fallback&&!e){if(O.experimental.adapterPath)return await F();throw new f.NoFallbackError}}let M=null;!P||I.isDev||y||(M="/index"===(M=x)?"/":M);let H=!0===I.isDev||!P,U=P&&!H;k&&L&&(0,s.setManifestsSingleton)({page:E,clientReferenceManifest:L,serverActionsManifest:k});let q=e.method||"GET",_=(0,n.getTracer)(),$=_.getActiveScopeSpan(),G={params:N,prerenderManifest:A,renderOpts:{experimental:{authInterrupts:!!O.experimental.authInterrupts},cacheComponents:!!O.cacheComponents,supportsDynamicResponse:H,incrementalCache:(0,o.getRequestMeta)(e,"incrementalCache"),cacheLifeProfiles:O.cacheLife,waitUntil:r.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,a,r,o)=>I.onRequestError(e,t,r,o,C)},sharedContext:{buildId:w}},j=new l.NodeNextRequest(e),Y=new l.NodeNextResponse(t),B=h.NextRequestAdapter.fromNodeNextRequest(j,(0,h.signalFromNodeResponse)(t));try{let s=async e=>I.handle(B,G).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let a=_.getRootSpanAttributes();if(!a)return;if(a.get("next.span_type")!==d.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${a.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let r=a.get("next.route");if(r){let t=`${q} ${r}`;e.setAttributes({"next.route":r,"http.route":r,"next.span_name":t}),e.updateName(t)}else e.updateName(`${q} ${E}`)}),i=!!(0,o.getRequestMeta)(e,"minimalMode"),l=async o=>{var n,l;let h=async({previousCacheEntry:a})=>{try{if(!i&&v&&S&&!a)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let n=await s(o);e.fetchMetrics=G.renderOpts.fetchMetrics;let l=G.renderOpts.pendingWaitUntil;l&&r.waitUntil&&(r.waitUntil(l),l=void 0);let h=G.renderOpts.collectedTags;if(!P)return await (0,p.sendResponse)(j,Y,n,G.renderOpts.pendingWaitUntil),null;{let e=await n.blob(),t=(0,u.toNodeOutgoingHttpHeaders)(n.headers);h&&(t[g.NEXT_CACHE_TAGS_HEADER]=h),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let a=void 0!==G.renderOpts.collectedRevalidate&&!(G.renderOpts.collectedRevalidate>=g.INFINITE_CACHE)&&G.renderOpts.collectedRevalidate,r=void 0===G.renderOpts.collectedExpire||G.renderOpts.collectedExpire>=g.INFINITE_CACHE?void 0:G.renderOpts.collectedExpire;return{value:{kind:T.CachedRouteKind.APP_ROUTE,status:n.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:a,expire:r}}}}catch(t){throw(null==a?void 0:a.isStale)&&await I.onRequestError(e,t,{routerKind:"App Router",routePath:E,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:U,isOnDemandRevalidate:v})},!1,C),t}},d=await I.handleResponse({req:e,nextConfig:O,cacheKey:M,routeKind:a.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:A,isRoutePPREnabled:!1,isOnDemandRevalidate:v,revalidateOnlyGenerated:S,responseGenerator:h,waitUntil:r.waitUntil,isMinimalMode:i});if(!P)return null;if((null==d||null==(n=d.value)?void 0:n.kind)!==T.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==d||null==(l=d.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});i||t.setHeader("x-nextjs-cache",v?"REVALIDATED":d.isMiss?"MISS":d.isStale?"STALE":"HIT"),y&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let f=(0,u.fromNodeOutgoingHttpHeaders)(d.value.headers);return i&&P||f.delete(g.NEXT_CACHE_TAGS_HEADER),!d.cacheControl||t.getHeader("Cache-Control")||f.get("Cache-Control")||f.set("Cache-Control",(0,m.getCacheControlHeader)(d.cacheControl)),await (0,p.sendResponse)(j,Y,new Response(d.value.body,{headers:f,status:d.value.status||200})),null};$?await l($):await _.withPropagatedContext(e.headers,()=>_.trace(d.BaseServerSpan.handleRequest,{spanName:`${q} ${E}`,kind:n.SpanKind.SERVER,attributes:{"http.method":q,"http.target":e.url}},l))}catch(t){if(t instanceof f.NoFallbackError||await I.onRequestError(e,t,{routerKind:"App Router",routePath:D,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:U,isOnDemandRevalidate:v})},!1,C),P)throw t;return await (0,p.sendResponse)(j,Y,new Response(null,{status:500})),null}}e.s(["handler",()=>L,"patchFetch",()=>x,"routeModule",()=>I,"serverHooks",()=>S,"workAsyncStorage",()=>C,"workUnitAsyncStorage",()=>v],66012)},85685,e=>{e.v(e=>Promise.resolve().then(()=>e(54799)))},21955,e=>{e.v(e=>Promise.resolve().then(()=>e(69382)))},46665,e=>{e.v(t=>Promise.all(["server/chunks/95419_node-fetch_src_utils_multipart-parser_7a829476.js","server/chunks/[root-of-the-server]__f454263b._.js","server/chunks/[root-of-the-server]__7773ed47._.js"].map(t=>e.l(t))).then(()=>t(21245)))},23970,e=>{e.v(e=>Promise.resolve().then(()=>e(22734)))}];

//# sourceMappingURL=%5Broot-of-the-server%5D__a1897391._.js.map