module.exports=[59639,(e,t,r)=>{t.exports=e.x("node:process",()=>require("node:process"))},12057,(e,t,r)=>{t.exports=e.x("node:util",()=>require("node:util"))},93695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},18622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},56704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},32319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},24725,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},24361,(e,t,r)=>{t.exports=e.x("util",()=>require("util"))},14747,(e,t,r)=>{t.exports=e.x("path",()=>require("path"))},22734,(e,t,r)=>{t.exports=e.x("fs",()=>require("fs"))},54799,(e,t,r)=>{t.exports=e.x("crypto",()=>require("crypto"))},874,(e,t,r)=>{t.exports=e.x("buffer",()=>require("buffer"))},92509,(e,t,r)=>{t.exports=e.x("url",()=>require("url"))},24836,(e,t,r)=>{t.exports=e.x("https",()=>require("https"))},46786,(e,t,r)=>{t.exports=e.x("os",()=>require("os"))},21517,(e,t,r)=>{t.exports=e.x("http",()=>require("http"))},55004,(e,t,r)=>{t.exports=e.x("tls",()=>require("tls"))},4446,(e,t,r)=>{t.exports=e.x("net",()=>require("net"))},49719,(e,t,r)=>{t.exports=e.x("assert",()=>require("assert"))},29946,48916,27651,29966,e=>{"use strict";var t=e.i(54799);let r=new Uint8Array(256),a=r.length;function n(){return a>r.length-16&&(t.default.randomFillSync(r),a=0),r.slice(a,a+=16)}e.s(["default",()=>n],48916);let o=/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i,s=function(e){return"string"==typeof e&&o.test(e)};e.s(["default",0,s],27651);let i=[];for(let e=0;e<256;++e)i.push((e+256).toString(16).substr(1));let l=function(e,t=0){let r=(i[e[t+0]]+i[e[t+1]]+i[e[t+2]]+i[e[t+3]]+"-"+i[e[t+4]]+i[e[t+5]]+"-"+i[e[t+6]]+i[e[t+7]]+"-"+i[e[t+8]]+i[e[t+9]]+"-"+i[e[t+10]]+i[e[t+11]]+i[e[t+12]]+i[e[t+13]]+i[e[t+14]]+i[e[t+15]]).toLowerCase();if(!s(r))throw TypeError("Stringified UUID is invalid");return r};e.s(["default",0,l],29966),e.s(["default",0,function(e,t,r){let a=(e=e||{}).random||(e.rng||n)();if(a[6]=15&a[6]|64,a[8]=63&a[8]|128,t){r=r||0;for(let e=0;e<16;++e)t[r+e]=a[e];return t}return l(a)}],29946)},83728,e=>{"use strict";let t=`CRITICAL REALISM RULES — the model must look like a REAL person, NOT AI-generated:
- HEAD SIZE: Proportionally SMALL relative to body (1/7.5 to 1/8 of total height). Fight AI's tendency for large heads.
- SKIN: Natural texture — visible pores, slight unevenness, natural shine. NOT airbrushed.
- HAIR: Natural texture with movement, flyaways, varying strand thickness. NOT helmet-like.
- EXPRESSION: Confident, calm, alive. NOT depressed, NOT bored. "Fashion editorial between shots."
- BODY: Correct proportions for ethnicity. Visible collarbones, natural shoulder width.
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
- Keep it natural and subtle — not exaggerated, not vulgar. Real body in well-constructed denim.`,jackets:`CRITICAL — BODY SHAPE & FIT:
- The model should have natural body proportions visible under the jacket.
- Shoulders should match the jacket's structure.
- The jacket should show natural body movement and drape, not hang stiffly.
- Keep it natural and editorial — real body in well-constructed outerwear.
- For zip jackets: the zip goes ALL THE WAY from hem to collar — this is design-critical (Learning #33).`,default:`CRITICAL — BODY SHAPE:
- Natural body proportions visible under the garment.
- Clothing should drape naturally, not stiffly.
- Keep it natural and editorial.`},n=`CRITICAL — FLOOR-LENGTH HEM OVERRIDE (Learning #31):
- IGNORE the mannequin's hem height — the mannequin has a RAISED STAND
- The denim hem sits ON TOP OF the shoe, resting on it
- You should only see the sole of the shoe and maybe 5mm of the toe cap
- The shoe is 90% hidden by denim
- Like wearing jeans that are intentionally too long — the hem breaks heavily on the shoe
- Floor-length means: hems nearly scraping the ground, shoes almost invisible under denim
- NOT ankle-length, NOT 1cm above floor. ON the floor.`,o=`CRITICAL — ANKLE-LENGTH HEM PRECISION (Learning #35):
- ANKLE-LENGTH — the hem ends AT the ankle, showing the FULL SHOE
- This is NOT floor-length — there should be clear space between hem and floor
- The shoe is FULLY VISIBLE below the hem
- Do NOT make these floor-length — that is the WRONG look`;function s(e){let{modelDescription:s,garmentDescription:i,shotDescription:l,garmentCategory:d,metadata:u,modifications:h,productCritical:c}=e,p=a[d]||a.default,g="";u.waistHeight&&(g+=`
Waist height: ${u.waistHeight}.`),u.fitDescription&&(g+=`
Fit: ${u.fitDescription}.`);let m="",f=u.floorDistance;"0"===f||"0 - touching"===f?(m=`
${n}`,g+=`
Hem: FLOOR-LENGTH — hems touch/nearly touch the ground.`):f&&(m=`
${o}`,g+=`
Hem distance to floor: ${f}.`);let b="";h?.length&&(b=`

ADDITIONAL MODIFICATIONS (apply these adjustments):
${h.map((e,t)=>`${t+1}. ${e}`).join("\n")}`);let E="";return c&&(E=`

PRODUCT-SPECIFIC CRITICAL RULES:
${c}`),["Generate a fashion editorial photograph for G-Star RAW e-commerce.",`
IMPORTANT: The garment reference images provided above show the EXACT garment to be worn. The model must wear THIS SPECIFIC GARMENT — match every detail: fabric, color, fit, seams, pockets, closures, stitching. Do NOT substitute with any other garment.`,`
IMAGE-DRIVEN GENERATION (Learning #1 — THE #1 LESSON):`,"The reference images ARE the specification. Minimize reliance on text description.",`Copy EXACTLY what you see in the images. DO NOT describe garment hardware in text — let the images specify buttons, zips, rivets, labels.`,`
MODEL: ${s}`,`
GARMENT (text supplements reference images): ${i}${g}`,`
POSE & FRAMING: ${l}`,"Full body visible from top of head to shoes/feet.","Clean white/very light grey (#F5F5F5) studio background.",`
${t}`,`
${p}`,m,`
${r}`,`
HARDWARE COLOR (Learning #37): If the garment has snap buttons, render them in the SAME COLOR as the mannequin reference. Dark snaps = DARK. NOT white, NOT pearl, NOT silver.`,E,b].filter(Boolean).join("\n")}function i(e){let{shotType:t,garmentCategory:r,garmentDescription:a,metadata:n}=e,o=n.floorDistance||"";return`You are a Quality Control expert for G-Star RAW e-commerce photography.
Compare the AI-generated model photo against the original garment reference images.

GARMENT: ${a}
CATEGORY: ${r}
SHOT TYPE: ${t}

Score each dimension 1-10 with brief justification:

1. SILHOUETTE (weight: 2x) — Match to MANNEQUIN proportions (NOT flat image — flat always looks wider).
   Score 7-9 if proportions match mannequin. Score 1-4 only for wrong fit category.
   ${"0"===o||"0 - touching"===o||"floor"===o?"CRITICAL: FLOOR-LENGTH. Hems MUST touch ground. Shoes 90% hidden.":""}

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
Set pass = true if weighted_score >= 6.0`}function l(){return`You are a label/branding QC expert for G-Star RAW.
Compare AI image against ALL mannequin reference images.

1. Inventory EVERY label/patch/tab on the REAL garment (from mannequin photos)
2. Inventory EVERY label/patch/tab in the AI image
3. Flag any in AI that doesn't exist on the real garment

COMMON HALLUCINATIONS: leather back patches, paper waistband labels, wrong patch styles, invented front tabs.

RESPOND IN JSON (no markdown):
{"real_labels":[],"ai_labels":[],"invented_labels":[],"label_score":0,"pass":true}
Score: 10=clean, 4-6=one invented, 1-3=multiple invented. pass=true if score>=7`}e.s(["REF_LABELS",0,{modelCard:"MODEL IDENTITY REFERENCE. The person in the generated image MUST be this exact same person — same face, same features, same body type, same skin tone.",flatImage:"GARMENT FLAT IMAGE — #1 reference for width and proportions. This shows the TRUE garment width without mannequin distortion. Reproduce this width/fit EXACTLY.",mannequinFront:"GARMENT ON MANNEQUIN (front view). Copy every visible detail: seams, pockets, hardware, stitching.",mannequinSide:"GARMENT ON MANNEQUIN (side view). Shows 3D construction and sculptured seat shape.",mannequinBack:"GARMENT ON MANNEQUIN (back view). The BACK PANEL is PLAIN unless shown otherwise here.",zoneGrid:(e,t,r)=>`CONSTRUCTION DETAIL GRID ${t}/${r}: ${e} zone from multiple angles. Copy seam patterns, hardware, and trim EXACTLY as shown.`},"ZONE_DEFS",0,{pants:{hip:{y1:.38,y2:.55,x1:.15,x2:.85,angles:[0,1,2,4],name:"Hip Zone — waistband, pockets, rivets, topstitching"},knee:{y1:.5,y2:.7,x1:.15,x2:.85,angles:[0,1,2,4],name:"Knee Zone — thigh to knee, seam construction"},ankle:{y1:.68,y2:.85,x1:.15,x2:.85,angles:[0,1,2,4],name:"Ankle Zone — hem, cuffs, leg opening"},back:{y1:.38,y2:.55,x1:.15,x2:.85,angles:[3,4,5],name:"Back Hip Zone — back pockets, yoke, labels"}},jackets:{collar:{y1:0,y2:.2,x1:.15,x2:.85,angles:[0,1,6],name:"Collar Zone"},chest:{y1:.15,y2:.5,x1:.15,x2:.85,angles:[0,1,6,9],name:"Chest Zone"},sleeve:{y1:.2,y2:.6,x1:0,x2:.4,angles:[3,9],name:"Sleeve Zone"},back:{y1:0,y2:.5,x1:.15,x2:.85,angles:[5,6,7],name:"Back Zone"}},default:{upper:{y1:0,y2:.4,x1:.15,x2:.85,angles:[0,1,6],name:"Upper Zone"},lower:{y1:.4,y2:1,x1:.15,x2:.85,angles:[0,1,6],name:"Lower Zone"}}},"buildGenerationPrompt",()=>s,"buildLabelQCPrompt",()=>l,"buildQCPrompt",()=>i])},5693,e=>{"use strict";var t=e.i(22509),r=e.i(18139),a=e.i(25362),n=e.i(22206),o=e.i(82686),s=e.i(13500),i=e.i(65790),l=e.i(5762),d=e.i(23332),u=e.i(21501),h=e.i(46632),c=e.i(16375),p=e.i(21490),g=e.i(1765),m=e.i(61943),f=e.i(93695);e.i(31679);var b=e.i(61339),E=e.i(30373),N=e.i(10004),T=e.i(83728);let R={M01:"Front-facing, straight posture, arms at sides. Direct eye contact with camera.",M02:"Front 3/4 angle, slight body turn to the left. Natural arm position.","M03-A":"Side/profile pose. Equal weight on both feet, balanced stance.","M03-B":"Side/profile pose. Weight shifted to one leg, hip slightly pushed out, relaxed editorial stance.",M04:"Back view, head turned slightly looking over shoulder. Natural confident expression.",M05:"Walking pose, mid-stride. Natural movement, one foot slightly ahead.",M06:"Lifestyle/editorial pose. Relaxed lean or seated, casual confident energy."};var x=e.i(65963);async function O(e){try{let e=await (0,N.listJobs)();return E.NextResponse.json({jobs:e})}catch(e){return console.error("Error listing jobs:",e),E.NextResponse.json({error:"Failed to list jobs"},{status:500})}}async function y(e){try{let{designNumber:t,creatorEmail:r,garmentCategory:a,description:n,metadata:o,modelIds:s,modelDescriptions:i,flatImageBase64:l,flatImageMimeType:d,images360Base64:u,wardrobeItemIds:h}=await e.json();if(!t||!a||!n||!s?.length)return E.NextResponse.json({error:"Missing required fields"},{status:400});let c="";if(l){let e=Buffer.from(l,"base64"),r=d||"image/jpeg",a=r.includes("png")?"png":"jpg";c=await (0,x.uploadGarmentImage)(t,"flat",`flat.${a}`,e,r),console.log(`[Job] Flat image uploaded: ${c}`)}let p=[];if(u?.length){let e=Math.min(u.length,4);for(let r=0;r<e;r++){let e=Buffer.from(u[r],"base64"),a=await (0,x.uploadGarmentImage)(t,"360",`360_${String(r).padStart(2,"0")}.jpg`,e);p.push(a)}console.log(`[Job] ${p.length} 360\xb0 images uploaded`)}let g=await (0,N.createJob)({designNumber:t,creatorEmail:r,garmentCategory:a,description:n,metadata:o||{},modelIds:s}),m={};c&&(m.flatImageUrl=c),p.length&&(m.image360Urls=p),h&&Object.keys(h).length>0&&(m.wardrobeItemIds=h),Object.keys(m).length>0&&await N.jobsCol.doc(g).update(m);let f=[];for(let e of s){let t=i?.[e]||"";for(let[r,s]of Object.entries(R)){let i=r.replace("-A","").replace("-B",""),l=r.includes("-B")?"B":"A",d=(0,T.buildGenerationPrompt)({modelDescription:t,garmentDescription:n,shotDescription:s,garmentCategory:a,metadata:o||{}}),u=await (0,N.createShot)({jobId:g,modelId:e,shotType:i,variant:l,prompt:d});f.push(u)}}return await (0,N.updateJobStatus)(g,"generating"),console.log(`[Job] Created ${f.length} shots for job ${g}. Generation will be triggered by the results page.`),E.NextResponse.json({success:!0,jobId:g,shotsCreated:f.length})}catch(e){return console.error("Error creating job:",e),E.NextResponse.json({error:"Failed to create job"},{status:500})}}e.s(["GET",()=>O,"POST",()=>y],8717);var v=e.i(8717);let w=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/jobs/route",pathname:"/api/jobs",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/mnt/gstar/gstar-studio/src/app/api/jobs/route.ts",nextConfigOutput:"standalone",userland:v}),{workAsyncStorage:A,workUnitAsyncStorage:C,serverHooks:I}=w;function S(){return(0,a.patchFetch)({workAsyncStorage:A,workUnitAsyncStorage:C})}async function L(e,t,a){w.isDev&&(0,n.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let E="/api/jobs/route";E=E.replace(/\/index$/,"")||"/";let N=await w.prepare(e,t,{srcPage:E,multiZoneDraftMode:!1});if(!N)return t.statusCode=400,t.end("Bad Request"),null==a.waitUntil||a.waitUntil.call(a,Promise.resolve()),null;let{buildId:T,params:R,nextConfig:x,parsedUrl:O,isDraftMode:y,prerenderManifest:v,routerServerContext:A,isOnDemandRevalidate:C,revalidateOnlyGenerated:I,resolvedPathname:S,clientReferenceManifest:L,serverActionsManifest:k}=N,D=(0,i.normalizeAppPath)(E),M=!!(v.dynamicRoutes[D]||v.routes[S]),j=async()=>((null==A?void 0:A.render404)?await A.render404(e,t,O,!1):t.end("This page could not be found"),null);if(M&&!y){let e=!!v.routes[S],t=v.dynamicRoutes[D];if(t&&!1===t.fallback&&!e){if(x.experimental.adapterPath)return await j();throw new f.NoFallbackError}}let P=null;!M||w.isDev||y||(P="/index"===(P=S)?"/":P);let q=!0===w.isDev||!M,F=M&&!q;k&&L&&(0,s.setManifestsSingleton)({page:E,clientReferenceManifest:L,serverActionsManifest:k});let U=e.method||"GET",H=(0,o.getTracer)(),_=H.getActiveScopeSpan(),G={params:R,prerenderManifest:v,renderOpts:{experimental:{authInterrupts:!!x.experimental.authInterrupts},cacheComponents:!!x.cacheComponents,supportsDynamicResponse:q,incrementalCache:(0,n.getRequestMeta)(e,"incrementalCache"),cacheLifeProfiles:x.cacheLife,waitUntil:a.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,a,n)=>w.onRequestError(e,t,a,n,A)},sharedContext:{buildId:T}},$=new l.NodeNextRequest(e),B=new l.NodeNextResponse(t),Y=d.NextRequestAdapter.fromNodeNextRequest($,(0,d.signalFromNodeResponse)(t));try{let s=async e=>w.handle(Y,G).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let r=H.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==u.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let a=r.get("next.route");if(a){let t=`${U} ${a}`;e.setAttributes({"next.route":a,"http.route":a,"next.span_name":t}),e.updateName(t)}else e.updateName(`${U} ${E}`)}),i=!!(0,n.getRequestMeta)(e,"minimalMode"),l=async n=>{var o,l;let d=async({previousCacheEntry:r})=>{try{if(!i&&C&&I&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let o=await s(n);e.fetchMetrics=G.renderOpts.fetchMetrics;let l=G.renderOpts.pendingWaitUntil;l&&a.waitUntil&&(a.waitUntil(l),l=void 0);let d=G.renderOpts.collectedTags;if(!M)return await (0,c.sendResponse)($,B,o,G.renderOpts.pendingWaitUntil),null;{let e=await o.blob(),t=(0,p.toNodeOutgoingHttpHeaders)(o.headers);d&&(t[m.NEXT_CACHE_TAGS_HEADER]=d),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==G.renderOpts.collectedRevalidate&&!(G.renderOpts.collectedRevalidate>=m.INFINITE_CACHE)&&G.renderOpts.collectedRevalidate,a=void 0===G.renderOpts.collectedExpire||G.renderOpts.collectedExpire>=m.INFINITE_CACHE?void 0:G.renderOpts.collectedExpire;return{value:{kind:b.CachedRouteKind.APP_ROUTE,status:o.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:a}}}}catch(t){throw(null==r?void 0:r.isStale)&&await w.onRequestError(e,t,{routerKind:"App Router",routePath:E,routeType:"route",revalidateReason:(0,h.getRevalidateReason)({isStaticGeneration:F,isOnDemandRevalidate:C})},!1,A),t}},u=await w.handleResponse({req:e,nextConfig:x,cacheKey:P,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:v,isRoutePPREnabled:!1,isOnDemandRevalidate:C,revalidateOnlyGenerated:I,responseGenerator:d,waitUntil:a.waitUntil,isMinimalMode:i});if(!M)return null;if((null==u||null==(o=u.value)?void 0:o.kind)!==b.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==u||null==(l=u.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});i||t.setHeader("x-nextjs-cache",C?"REVALIDATED":u.isMiss?"MISS":u.isStale?"STALE":"HIT"),y&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let f=(0,p.fromNodeOutgoingHttpHeaders)(u.value.headers);return i&&M||f.delete(m.NEXT_CACHE_TAGS_HEADER),!u.cacheControl||t.getHeader("Cache-Control")||f.get("Cache-Control")||f.set("Cache-Control",(0,g.getCacheControlHeader)(u.cacheControl)),await (0,c.sendResponse)($,B,new Response(u.value.body,{headers:f,status:u.value.status||200})),null};_?await l(_):await H.withPropagatedContext(e.headers,()=>H.trace(u.BaseServerSpan.handleRequest,{spanName:`${U} ${E}`,kind:o.SpanKind.SERVER,attributes:{"http.method":U,"http.target":e.url}},l))}catch(t){if(t instanceof f.NoFallbackError||await w.onRequestError(e,t,{routerKind:"App Router",routePath:D,routeType:"route",revalidateReason:(0,h.getRevalidateReason)({isStaticGeneration:F,isOnDemandRevalidate:C})},!1,A),M)throw t;return await (0,c.sendResponse)($,B,new Response(null,{status:500})),null}}e.s(["handler",()=>L,"patchFetch",()=>S,"routeModule",()=>w,"serverHooks",()=>I,"workAsyncStorage",()=>A,"workUnitAsyncStorage",()=>C],5693)},85685,e=>{e.v(e=>Promise.resolve().then(()=>e(54799)))},21955,e=>{e.v(e=>Promise.resolve().then(()=>e(69382)))},46665,e=>{e.v(t=>Promise.all(["server/chunks/95419_node-fetch_src_utils_multipart-parser_6941f344.js","server/chunks/[root-of-the-server]__f454263b._.js","server/chunks/[root-of-the-server]__7773ed47._.js"].map(t=>e.l(t))).then(()=>t(21245)))}];

//# sourceMappingURL=%5Broot-of-the-server%5D__a6e75c64._.js.map