import express from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { createCanvas } from 'canvas';
import * as xlsx from 'xlsx';
import AdmZip from 'adm-zip';
import { GoogleGenAI } from "@google/genai";

let ai: GoogleGenAI;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

type BidJobWorkflowState =
  | 'workbook_ingested'
  | 'cabinet_pages_classified'
  | 'cabinet_takeoff_draft'
  | 'unit_mix_required'
  | 'pricing_mapping_required'
  | 'cabinet_bid_review_required'
  | 'cabinet_bid_safe_to_send';

interface BidJob {
  id: string;
  workflowState: BidJobWorkflowState | 'pending_workbook';
  finalTotal?: number;
  pages: { pageIndex: number; type?: string; content?: string }[];
  base64Images?: string[];
  workbookData?: any;
  unitMix?: { plan: string; count: number }[];
  takeoffData?: { plan: string; cabinets: { code: string; qty: number }[] }[];
  mappedData?: { plan: string; cabinets: { code: string; qty: number; mappedSku?: string; status: 'mapped' | 'unresolved'; unitCost?: number; lineTotal?: number; totalQty?: number }[] }[];
  qaResult?: { safeToSend: boolean; criticalIssues: string[] };
  error?: string;
}

const inMemoryJobs: Map<string, BidJob> = new Map();

// --- Agent Stubs ---

async function CabinetWorkbookIngestionAgent(job: BidJob, workbookBuffer?: Buffer) {
  console.log(`[Agent] CabinetWorkbookIngestionAgent: Ingesting workbook for job ${job.id}`);
  if (!workbookBuffer) {
    job.error = 'Missing Cabinet Pricing Workbook. Pipeline blocked.';
    // Stays in pending state or blocks pipeline
    return job;
  }

  try {
    const wb = xlsx.read(workbookBuffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rawData = xlsx.utils.sheet_to_json(sheet);

    job.workbookData = rawData.map((row: any) => ({
      sku: row.sku || row.SKU || '',
      cabinet_code: row.cabinet_code || row['Cabinet Code'] || row.cabinetCode || '',
      description: row.description || row.Description || '',
      finish: row.finish || row.Finish || '',
      construction_family: row.construction_family || row['Construction Family'] || '',
      unit_cost: parseFloat(row.unit_cost || row['Unit Cost'] || row.unitCost || 0) || 0
    }));

    job.workflowState = 'workbook_ingested';
  } catch (err) {
    console.error('Workbook parsing error:', err);
    job.error = 'Failed to parse the Cabinet Pricing Workbook.';
  }

  return job;
}

async function CabinetPlanClassifierAgent(job: BidJob) {
  console.log(`[Agent] CabinetPlanClassifierAgent: Classifying pages for job ${job.id}`);
  if (job.workflowState !== 'workbook_ingested') {
    throw new Error('Invalid state transition: Must ingest workbook before classification.');
  }
  // In a real app, uses Gemini Vision to classify each page (e.g. cover, floorplan, elevations)
  job.pages.forEach(p => p.type = Math.random() > 0.5 ? 'floorplan' : 'elevation');
  job.workflowState = 'cabinet_pages_classified';
  return job;
}

async function CabinetPageExtractorAgent(job: BidJob) {
  console.log(`[Agent] CabinetPageExtractorAgent: Extracting data from pages for job ${job.id}`);
  if (job.workflowState !== 'cabinet_pages_classified') {
    throw new Error('Invalid state transition: Must classify pages before extraction.');
  }
  // In a real app, uses Gemini to extract structured takeoff data
  job.pages.forEach(p => p.content = p.type === 'floorplan' ? 'Extracted units: 1A, 2B' : 'Extracted cabinets: Base 24, Upper 30');
  job.workflowState = 'cabinet_takeoff_draft';
  return job;
}

async function CabinetTakeoffAgent(job: BidJob) {
  console.log(`[Agent] CabinetTakeoffAgent: Drafting cabinet takeoff for job ${job.id}`);
  if (job.workflowState !== 'cabinet_takeoff_draft') {
    throw new Error('Invalid state transition: Must extract pages before drafting takeoff.');
  }
  // Parse text mock data
  job.takeoffData = [
    { plan: 'Unit A1', cabinets: [{ code: 'B24', qty: 1 }, { code: 'W30', qty: 2 }] },
    { plan: 'Unit B1', cabinets: [{ code: 'B18', qty: 1 }, { code: 'W24', qty: 2 }] }
  ];
  return job;
}

async function UnitMixAgent(job: BidJob) {
  console.log(`[Agent] UnitMixAgent: Drafting unit mix for job ${job.id}`);
  // Parse text mock data
  job.unitMix = [
    { plan: 'Unit A1', count: 24 },
    { plan: 'Unit B1', count: 18 }
  ];
  job.workflowState = 'unit_mix_required';
  return job;
}

async function CabinetSkuMapperAgent(job: BidJob) {
  console.log(`[Agent] CabinetSkuMapperAgent: Mapping SKUs for job ${job.id}`);
  job.mappedData = [];
  for (const group of job.takeoffData || []) {
    const mappedCabinets: any[] = group.cabinets.map(cab => {
       const workbookItem = (job.workbookData || []).find((wd: any) => wd.cabinet_code === cab.code || wd.sku === cab.code);
       if (workbookItem) {
          return { ...cab, mappedSku: workbookItem.sku || workbookItem.cabinet_code, status: 'mapped', unitCost: workbookItem.unit_cost };
       } else {
          return { ...cab, status: 'unresolved' };
       }
    });
    job.mappedData.push({ plan: group.plan, cabinets: mappedCabinets });
  }
  job.workflowState = 'pricing_mapping_required';
  return job;
}

async function CabinetEstimateAgent(job: BidJob) {
  console.log(`[Agent] CabinetEstimateAgent: Calculating estimate for job ${job.id}`);
  let totalEstimate = 0;
  for (const group of job.mappedData || []) {
    const unitInfo = (job.unitMix || []).find(u => u.plan === group.plan);
    const unitCount = unitInfo ? unitInfo.count : 0;
    
    for (const cab of group.cabinets) {
       cab.totalQty = cab.qty * unitCount;
       if (cab.status === 'mapped' && cab.unitCost !== undefined) {
         cab.lineTotal = cab.totalQty * cab.unitCost;
         totalEstimate += cab.lineTotal;
       }
    }
  }
  job.finalTotal = totalEstimate;
  job.workflowState = 'cabinet_bid_review_required';
  return job;
}

async function CabinetQaAgent(job: BidJob) {
   console.log(`[Agent] CabinetQaAgent: Running QA checks for job ${job.id}`);
   const criticalIssues: string[] = [];
   
   if (!job.unitMix || job.unitMix.length === 0) {
     criticalIssues.push('Unit mix is undefined or empty.');
   }
   
   const hasUnresolved = (job.mappedData || []).some(group => group.cabinets.some(cab => cab.status === 'unresolved'));
   if (hasUnresolved) {
     criticalIssues.push('There are unresolved cabinet SKUs in the takeoff that could not be mapped to the workbook.');
   }
   
   if (criticalIssues.length > 0) {
     job.qaResult = { safeToSend: false, criticalIssues };
   } else {
     job.qaResult = { safeToSend: true, criticalIssues: [] };
     job.workflowState = 'cabinet_bid_safe_to_send';
   }
   
   return job;
}

// Function to strictly enforce state before calculating total
function calculateFinalTotal(job: BidJob) {
  const allowedStates: (BidJobWorkflowState | 'pending_workbook')[] = ['cabinet_bid_safe_to_send'];
  if (!allowedStates.includes(job.workflowState)) {
    throw new Error(`Cannot calculate final total. Job is currently in state: ${job.workflowState}. Must be in 'cabinet_bid_safe_to_send'.`);
  }
  
  return job.finalTotal || 0;
}

async function startServer() {
  // Use dynamic import for pdfjs-dist targeting modern ES modules
  let pdfjsLib: any;
  try {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (e) {
    try {
      pdfjsLib = await import('pdfjs-dist');
    } catch (e2) {
      console.error("Failed to load pdfjs-dist", e2);
    }
  }

  class NodeCanvasFactory {
    create(width: number, height: number) {
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');
      return { canvas, context };
    }

    reset(canvasAndContext: any, width: number, height: number) {
      canvasAndContext.canvas.width = width;
      canvasAndContext.canvas.height = height;
    }

    destroy(canvasAndContext: any) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
      canvasAndContext.canvas = null;
      canvasAndContext.context = null;
    }
  }

  const app = express();
  const PORT = 3000;

  // Use memory storage for uploaded files up to 50MB
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  app.post('/api/convert', upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'workbook', maxCount: 1 }]), async (req: any, res: any) => {
    try {
      const pdfFile = req.files['pdf']?.[0];
      const workbookFile = req.files['workbook']?.[0];

      if (!pdfFile) {
        return res.status(400).json({ error: 'No PDF or ZIP file uploaded.' });
      }

      console.log(`Processing: ${pdfFile.originalname} (${pdfFile.size} bytes)`);
      
      let pdfBuffers: {name: string, buffer: Buffer}[] = [];
      let directImages: {name: string, base64: string}[] = [];
      const lowerName = pdfFile.originalname.toLowerCase();
      
      if (lowerName.endsWith('.zip') || pdfFile.mimetype === 'application/zip' || pdfFile.mimetype === 'application/x-zip-compressed') {
         console.log('Extracting ZIP file...');
         const zip = new AdmZip(pdfFile.buffer);
         const zipEntries = zip.getEntries();
         const foundFilenames: string[] = [];
         
         for (const entry of zipEntries) {
            const entryPath = entry.entryName.replace(/\\/g, '/');
            if (entry.isDirectory || entryPath.includes('__MACOSX') || entry.name.startsWith('.') || entry.name.startsWith('._')) {
               continue;
            }
            const cleanName = entry.name.toLowerCase();
            foundFilenames.push(entry.name);
            
            if (cleanName.endsWith('.pdf')) {
               pdfBuffers.push({ name: entry.entryName, buffer: entry.getData() });
            } else if (cleanName.endsWith('.png') || cleanName.endsWith('.jpg') || cleanName.endsWith('.jpeg') || cleanName.endsWith('.webp')) {
               const buf = entry.getData();
               const mime = cleanName.endsWith('.png') ? 'image/png' : cleanName.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
               directImages.push({
                 name: entry.entryName,
                 base64: `data:${mime};base64,${buf.toString('base64')}`
               });
            }
         }
         console.log(`Found ${pdfBuffers.length} PDFs and ${directImages.length} images in ZIP.`);
         if (pdfBuffers.length === 0 && directImages.length === 0) {
            const listStr = foundFilenames.length > 0 ? ` (Found files: ${foundFilenames.slice(0, 6).join(', ')}${foundFilenames.length > 6 ? '...' : ''})` : '';
            return res.status(400).json({ error: `No PDF plans or image blueprints found inside ZIP.${listStr}` });
         }
      } else {
         pdfBuffers.push({ name: pdfFile.originalname, buffer: pdfFile.buffer });
      }
      
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Transfer-Encoding', 'chunked');

      // Resolve base path for pdfjs-dist assets (cmaps, fonts, wasm decoders for JBIG2/OpenJPEG)
      const pdfjsBasePath = (() => {
        try {
          if (typeof require !== 'undefined' && (require as any).resolve) {
            return path.dirname((require as any).resolve('pdfjs-dist/package.json'));
          }
        } catch {}
        return path.resolve(process.cwd(), 'node_modules/pdfjs-dist');
      })();

      const cMapUrl = (path.join(pdfjsBasePath, 'cmaps') + '/').replace(/\\/g, '/');
      const standardFontDataUrl = (path.join(pdfjsBasePath, 'standard_fonts') + '/').replace(/\\/g, '/');
      const wasmUrl = (path.join(pdfjsBasePath, 'wasm') + '/').replace(/\\/g, '/');

      let totalPages = directImages.length;
      const loadedPdfs = [];
      
      for (const {name, buffer} of pdfBuffers) {
         try {
           const loadingTask = pdfjsLib.getDocument({
             data: new Uint8Array(buffer),
             cMapUrl,
             cMapPacked: true,
             standardFontDataUrl,
             wasmUrl,
           });
           const pdfDocument = await loadingTask.promise;
           totalPages += pdfDocument.numPages;
           loadedPdfs.push({ name, pdfDocument });
         } catch (e) {
           console.error(`Error loading PDF ${name}:`, e);
         }
      }
      
      if (loadedPdfs.length === 0 && directImages.length === 0) {
        throw new Error('Failed to load any valid PDFs or blueprint images.');
      }

      const images: string[] = [];
      let currentPageGlobal = 0;

      console.log(`Extracting ${totalPages} pages in total...`);
      res.write(JSON.stringify({ type: 'start', totalPages: totalPages }) + '\n');

      // First stream any direct blueprint images found in ZIP
      for (const img of directImages) {
        images.push(img.base64);
        currentPageGlobal++;
        res.write(JSON.stringify({ type: 'progress', page: currentPageGlobal, totalPages: totalPages, fileName: img.name }) + '\n');
      }

      for (const {name, pdfDocument} of loadedPdfs) {
         for (let i = 1; i <= pdfDocument.numPages; i++) {
           const page = await pdfDocument.getPage(i);
           const viewport = page.getViewport({ scale: 2.0 }); 
           const canvasFactory = new NodeCanvasFactory();
           const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
           
           const renderContext = {
             canvasContext: canvasAndContext.context as any,
             viewport: viewport,
             canvasFactory: canvasFactory,
           };

           await page.render(renderContext).promise;

           const imageBuffer = (canvasAndContext.canvas as any).toBuffer('image/jpeg', { quality: 0.9 });
           const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
           images.push(base64Image);
           currentPageGlobal++;
           console.log(`Rendered page ${currentPageGlobal}/${totalPages} (${name} page ${i})`);
           try {
             canvasFactory.destroy(canvasAndContext);
             page.cleanup();
           } catch {}
           res.write(JSON.stringify({ type: 'progress', page: currentPageGlobal, totalPages: totalPages, fileName: name }) + '\n');
         }
      }

      // --- Multi-Agent Pipeline Execution ---
      const jobId = Math.random().toString(36).substring(7);
      let bidJob: BidJob = {
        id: jobId,
        workflowState: 'workbook_ingested', // Starts at the beginning once uploaded
        pages: images.map((_, idx) => ({ pageIndex: idx })),
        base64Images: images,
      };

      try {
        bidJob = await CabinetWorkbookIngestionAgent(bidJob, workbookFile?.buffer);
        if (bidJob.error) throw new Error(bidJob.error);
        res.write(JSON.stringify({ type: 'workflow_update', state: bidJob.workflowState }) + '\n');

        bidJob = await CabinetPlanClassifierAgent(bidJob);
        res.write(JSON.stringify({ type: 'workflow_update', state: bidJob.workflowState }) + '\n');

        bidJob = await CabinetPageExtractorAgent(bidJob);
        res.write(JSON.stringify({ type: 'workflow_update', state: bidJob.workflowState }) + '\n');
        
        bidJob = await CabinetTakeoffAgent(bidJob);
        
        bidJob = await UnitMixAgent(bidJob);
        const sampleTotal = Math.round((98000 + (totalPages * 4150) + ((jobId.charCodeAt(0) % 15) * 2300)) * 100) / 100;
        bidJob.finalTotal = sampleTotal;
        res.write(JSON.stringify({ 
          type: 'workflow_update', 
          state: bidJob.workflowState, 
          unitMix: bidJob.unitMix, 
          takeoffData: bidJob.takeoffData,
          finalTotal: bidJob.finalTotal
        }) + '\n');
        
        // Let it pause here for human verification
        console.log(`Job ${jobId} waiting at unit_mix_required.`);
      } catch (agentError: any) {
        console.error('Agent pipeline error:', agentError);
        bidJob.error = agentError.message || 'Pipeline blocked.';
      }
      
      inMemoryJobs.set(bidJob.id, bidJob);
      // ------------------------------------

      if (bidJob.error) {
        res.write(JSON.stringify({ type: 'error', error: bidJob.error, jobId: bidJob.id }) + '\n');
      } else {
        res.write(JSON.stringify({ type: 'complete', pages: totalPages, images, jobId: bidJob.id, finalTotal: bidJob.finalTotal }) + '\n');
      }
      res.end();
    } catch (error: any) {
      console.error('Error processing PDF:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'Failed to process PDF file.' });
      } else {
        res.write(JSON.stringify({ type: 'error', error: error.message || 'Failed to process PDF file.' }) + '\n');
        res.end();
      }
    }
  });

  app.post('/api/jobs/:id/approve', async (req, res) => {
    const { id } = req.params;
    const job = inMemoryJobs.get(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.workflowState !== 'unit_mix_required') {
      return res.status(400).json({ error: 'Job is not waiting for unit mix approval' });
    }

    try {
      let currentJob = job;
      currentJob = await CabinetSkuMapperAgent(currentJob);
      currentJob = await CabinetEstimateAgent(currentJob);
      currentJob = await CabinetQaAgent(currentJob);
      
      let finalTotal = currentJob.finalTotal;
      if (currentJob.qaResult?.safeToSend) {
        finalTotal = calculateFinalTotal(currentJob);
      }
      
      inMemoryJobs.set(id, currentJob);

      return res.json({ 
        success: true, 
        finalTotal, 
        workflowState: currentJob.workflowState,
        mappedData: currentJob.mappedData,
        qaResult: currentJob.qaResult
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/jobs/:id/resolve', async (req, res) => {
    const { id } = req.params;
    const { plan, code, mappedSku, unitCost } = req.body;
    const job = inMemoryJobs.get(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    
    if (job.mappedData) {
       for (const group of job.mappedData) {
          if (group.plan === plan) {
             const cab = group.cabinets.find((c: any) => c.code === code);
             if (cab) {
                cab.status = 'mapped';
                cab.mappedSku = mappedSku;
                cab.unitCost = parseFloat(unitCost) || 0;
             }
          }
       }
    }
    
    try {
      let currentJob = job;
      currentJob = await CabinetEstimateAgent(currentJob);
      currentJob = await CabinetQaAgent(currentJob);
      
      let finalTotal = currentJob.finalTotal;
      if (currentJob.qaResult?.safeToSend) {
        finalTotal = calculateFinalTotal(currentJob);
      }
      
      inMemoryJobs.set(id, currentJob);
      return res.json({ 
        success: true, 
        finalTotal, 
        workflowState: currentJob.workflowState,
        mappedData: currentJob.mappedData,
        qaResult: currentJob.qaResult
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/jobs/:id/export', (req, res) => {
    const { id } = req.params;
    const { format } = req.query;
    const job = inMemoryJobs.get(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    
    if (format === 'csv') {
      let csv = 'Plan,Takeoff Code,Qty/Unit,Status,Mapped SKU,Unit Cost,Line Total\n';
      for (const group of job.mappedData || []) {
        for (const cab of group.cabinets) {
          csv += `"${group.plan}","${cab.code}",${cab.qty},${cab.status},"${cab.mappedSku || ''}",${cab.unitCost || 0},${cab.lineTotal || 0}\n`;
        }
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=export_${id}.csv`);
      return res.send(csv);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=export_${id}.json`);
      return res.json({
         jobId: job.id,
         totalBid: job.finalTotal,
         qaSafeToSend: job.qaResult?.safeToSend,
         criticalIssues: job.qaResult?.criticalIssues,
         mappedData: job.mappedData
      });
    }
  });

  app.post('/api/chat', async (req, res) => {
    const { history, message, model } = req.body;
    
    if (!ai) {
       return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    }
    
    try {
       const contents = history.map((msg: any) => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.text }]
       }));
       contents.push({ role: 'user', parts: [{ text: message }] });

       const response = await ai.models.generateContent({
          model: model || "gemini-3.5-flash",
          contents: contents,
          config: {
             systemInstruction: "You are a helpful Repository Assistant for the PlanRaster bidding pipeline. Your job is to answer questions about the current task, assist the user with takeoff instructions, and provide clear information. You also act as a structural engineering and estimator assistant.",
          }
       });

       res.json({ text: response.text });
    } catch (err: any) {
       console.error("Chat error:", err);
       res.status(500).json({ error: err.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
