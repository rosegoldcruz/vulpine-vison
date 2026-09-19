/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileType, CheckCircle, Loader2, Play, AlertCircle, X, ZoomIn, ZoomOut, Download, Clock, RotateCw, RotateCcw, RefreshCw, AlertTriangle, WifiOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ChatWidget } from './components/ChatWidget';
import { CompletedJobsChart } from './components/CompletedJobsChart';

type JobStatus = 'waiting' | 'processing' | 'retrying' | 'done' | 'error';

interface Job {
  id: string;
  file: File | { name: string };
  status: JobStatus;
  images: string[];
  workflowState?: string;
  unitMix?: { plan: string; count: number }[];
  takeoffData?: { plan: string; cabinets: { code: string; qty: number }[] }[];
  mappedData?: { plan: string; cabinets: { code: string; qty: number; mappedSku?: string; status: 'mapped' | 'unresolved'; unitCost?: number; lineTotal?: number; totalQty?: number }[] }[];
  qaResult?: { safeToSend: boolean; criticalIssues: string[] };
  progress?: number;
  finalTotal?: number;
  error?: string;
  currentPage?: number;
  totalPages?: number;
  startedAt?: number;
  lastProgressAt?: number;
  retryCount?: number;
  maxRetries?: number;
  retryDelaySeconds?: number;
  nextRetryTime?: number;
  retryReason?: string;
}

type ToastMessage = {
  id: string;
  type: 'success' | 'error';
  message: string;
};

function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'Almost done';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function getEstimatedTimeRemaining(job?: Job, now: number = Date.now()): string {
  if (!job) return '--';
  if (job.status === 'done') return 'Completed';
  if (job.status === 'error') return 'Stopped';
  if (job.status === 'waiting') return 'Queued';
  if (job.status === 'retrying') {
    const remainingSecs = Math.max(1, Math.ceil(((job.nextRetryTime || now) - now) / 1000));
    return `Auto-retrying in ${remainingSecs}s (${job.retryCount || 1}/${job.maxRetries || 3})`;
  }

  const totalPages = job.totalPages || 0;
  const processedPages = job.currentPage || 0;
  const startedAt = job.startedAt || now;

  if (totalPages === 0) {
    return 'Calculating...';
  }

  if (processedPages >= totalPages) {
    return 'Finalizing...';
  }

  // If a job has been stalled without progress for more than 25 seconds, display "Processing..."
  const lastProgress = job.lastProgressAt || startedAt;
  if (processedPages > 0 && (now - lastProgress > 25_000)) {
    return 'Processing...';
  }

  const elapsedSeconds = Math.max(0.1, (now - startedAt) / 1000);
  // Realistic per-page blueprint rendering takes between 0.8s and 5.0s
  const rawSecondsPerPage = processedPages > 0 ? elapsedSeconds / processedPages : 2.0;
  const clampedSecondsPerPage = Math.min(5.0, Math.max(0.8, rawSecondsPerPage));
  const remainingPages = Math.max(1, totalPages - processedPages);
  const estimatedSeconds = Math.round(clampedSecondsPerPage * remainingPages);

  return formatDuration(estimatedSeconds);
}

export default function App() {
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [selectedImage, setSelectedImage] = useState<{img: string, fileName: string, pageIndex: number} | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [currentTime, setCurrentTime] = useState<number>(() => Date.now());
  const [jobs, setJobs] = useState<Job[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('raster_jobs');
        if (saved) {
          const parsed = JSON.parse(saved);
          return parsed.map((j: any) => ({
            id: j.id,
            file: { name: j.fileName },
            status: (j.status === 'processing' || j.status === 'waiting') ? 'error' : j.status,
            images: j.images || [],
            workflowState: j.workflowState,
            unitMix: j.unitMix,
            takeoffData: j.takeoffData,
            mappedData: j.mappedData,
            qaResult: j.qaResult,
            progress: j.progress,
            currentPage: j.currentPage,
            totalPages: j.totalPages,
            finalTotal: j.finalTotal,
            error: (j.status === 'processing' || j.status === 'waiting') ? 'Interrupted during reload' : j.error,
          }));
        }
      } catch (e) {
        console.error('Failed to parse jobs from localStorage', e);
      }
    }
    return [];
  });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isHovering, setIsHovering] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'blueprints' | 'takeoff' | 'pricing' | 'qa'>('blueprints');

  // Live timer tick every 1s when any job is processing
  useEffect(() => {
    const isProcessing = jobs.some(j => j.status === 'processing');
    if (!isProcessing) return;

    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, [jobs]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const currentAbortControllerRef = useRef<AbortController | null>(null);

  const addToast = (type: 'success' | 'error', message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsHovering(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsHovering(false);
  };

  const addFilesToQueue = (files: FileList | File[]) => {
    setGlobalError(null);
    const fileArray = Array.from(files);
    
    const validFiles = fileArray.filter(f => f.type === 'application/pdf' || f.type === 'application/zip' || f.name.toLowerCase().endsWith('.zip') || f.name.toLowerCase().endsWith('.pdf'));
    if (validFiles.length !== fileArray.length) {
      setGlobalError('Some files were ignored because they are not valid PDFs or ZIP folders.');
    }

    if (validFiles.length > 0) {
      const newJobs: Job[] = validFiles.map(f => ({
        id: Math.random().toString(36).substring(2, 9),
        file: f,
        status: 'waiting',
        images: [],
      }));
      setJobs(prev => [...prev, ...newJobs]);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsHovering(false);
    
    if (e.dataTransfer.items) {
      const files: File[] = [];
      const traverseFileTree = async (item: any, path: string = '') => {
        if (item.isFile) {
          const file = await new Promise<File>((resolve) => item.file(resolve));
          files.push(file);
        } else if (item.isDirectory) {
          const dirReader = item.createReader();
          const entries = await new Promise<any[]>((resolve) => dirReader.readEntries(resolve));
          for (let i = 0; i < entries.length; i++) {
            await traverseFileTree(entries[i], path + item.name + '/');
          }
        }
      };

      const promises = [];
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i].webkitGetAsEntry();
        if (item) {
          promises.push(traverseFileTree(item));
        }
      }
      
      await Promise.all(promises);
      if (files.length > 0) {
        // @ts-ignore
        addFilesToQueue(files);
      }
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(e.target.files);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  useEffect(() => {
    try {
      const serialized = jobs.map(j => ({
        id: j.id,
        fileName: j.file.name,
        status: j.status,
        images: j.images,
        workflowState: j.workflowState,
        unitMix: j.unitMix,
        takeoffData: j.takeoffData,
        mappedData: j.mappedData,
        qaResult: j.qaResult,
        progress: j.progress,
        currentPage: j.currentPage,
        totalPages: j.totalPages,
        finalTotal: j.finalTotal,
        error: j.error,
      }));
      localStorage.setItem('raster_jobs', JSON.stringify(serialized));
    } catch (e) {
      console.warn('Failed to save jobs to localStorage (possibly quota exceeded)');
    }
  }, [jobs]);

  useEffect(() => {
    const processNextJob = async () => {
      if (processingRef.current) return;
      
      const nextJobIndex = jobs.findIndex(j => j.status === 'waiting');
      if (nextJobIndex === -1) return;
      
      const nextJob = jobs[nextJobIndex];
      processingRef.current = true;
      const jobStartTime = Date.now();
      const abortController = new AbortController();
      currentAbortControllerRef.current = abortController;
      
      setJobs(prev => prev.map(j => j.id === nextJob.id ? { 
        ...j, 
        status: 'processing',
        startedAt: jobStartTime,
        lastProgressAt: jobStartTime,
        currentPage: 0,
        totalPages: 0,
        progress: 0
      } : j));

      try {
        const formData = new FormData();
        formData.append('pdf', nextJob.file as File);
        
        if (workbookFile) {
          formData.append('workbook', workbookFile);
        }

        const response = await fetch('/api/convert', {
          method: 'POST',
          body: formData,
          signal: abortController.signal
        });

        if (!response.ok) {
          let errorMsg = `Server returned HTTP ${response.status}`;
          let isTransient = [502, 503, 504, 429, 500].includes(response.status);
          try {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              const errData = await response.json();
              errorMsg = errData.error || errorMsg;
            } else {
              const text = await response.text();
              if (text.includes('<html') || text.includes('<!DOCTYPE')) {
                errorMsg = `Server is restarting or temporarily unavailable (HTTP ${response.status})`;
                isTransient = true;
              } else if (text.trim()) {
                errorMsg = text.substring(0, 160);
              }
            }
          } catch {
            isTransient = true;
          }
          const err: any = new Error(errorMsg);
          err.isTransient = isTransient;
          throw err;
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        if (!reader) {
          throw new Error('Streaming not supported.');
        }

        let completedSuccessfully = false;
        let streamErrorOccurred: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (!line.trim()) continue;
            let data: any;
            try {
              data = JSON.parse(line);
            } catch (jsonErr) {
              console.error('Error parsing NDJSON line', jsonErr, line);
              continue;
            }

            if (data.type === 'start') {
              const total = data.totalPages || 0;
              setJobs(prev => prev.map(j => j.id === nextJob.id ? { 
                ...j, 
                totalPages: total,
                currentPage: 0,
                progress: 0,
                startedAt: j.startedAt || jobStartTime,
                lastProgressAt: Date.now()
              } : j));
            } else if (data.type === 'progress') {
              const current = data.page || 0;
              const total = data.totalPages || 0;
              const pct = total ? Math.round((current / total) * 100) : 0;
              setJobs(prev => prev.map(j => j.id === nextJob.id ? { 
                ...j, 
                progress: pct,
                currentPage: current,
                totalPages: total,
                startedAt: j.startedAt || jobStartTime,
                lastProgressAt: Date.now()
              } : j));
            } else if (data.type === 'workflow_update') {
              setJobs(prev => prev.map(j => j.id === nextJob.id ? { 
                ...j, 
                workflowState: data.state,
                unitMix: data.unitMix || j.unitMix,
                takeoffData: data.takeoffData || j.takeoffData,
                finalTotal: data.finalTotal !== undefined ? data.finalTotal : j.finalTotal,
                lastProgressAt: Date.now()
              } : j));
            } else if (data.type === 'complete') {
              completedSuccessfully = true;
              setJobs(prev => prev.map(j => j.id === nextJob.id ? { 
                ...j, 
                status: 'done', 
                images: data.images, 
                progress: 100, 
                currentPage: j.totalPages || data.images?.length || 0,
                totalPages: j.totalPages || data.images?.length || 0,
                finalTotal: data.finalTotal,
                error: undefined,
                retryReason: undefined
              } : j));
              addToast('success', `Completed: ${nextJob.file.name}`);
            } else if (data.type === 'error') {
              streamErrorOccurred = data.error || 'Pipeline error encountered';
              const err: any = new Error(streamErrorOccurred);
              err.isStreamError = true;
              throw err;
            }
          }
        }

        if (!completedSuccessfully && !streamErrorOccurred) {
          throw new Error('Connection closed before job finished.');
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || abortController.signal.aborted) {
          console.log(`Job ${nextJob.id} was intentionally canceled/aborted.`);
          return;
        }

        const currentRetry = nextJob.retryCount || 0;
        const maxRetries = nextJob.maxRetries || 3;
        
        const isTransient = (() => {
          if (err?.isTransient) return true;
          const msg = (err?.message || '').toLowerCase();
          return (
            msg.includes('failed to fetch') ||
            msg.includes('network') ||
            msg.includes('load failed') ||
            msg.includes('unexpected token <') ||
            msg.includes('is not valid json') ||
            msg.includes('restarting') ||
            msg.includes('unavailable') ||
            msg.includes('bad gateway') ||
            msg.includes('gateway timeout') ||
            msg.includes('econn') ||
            msg.includes('streaming not supported') ||
            msg.includes('connection closed before job finished')
          );
        })();

        if (isTransient && currentRetry < maxRetries) {
          const nextRetry = currentRetry + 1;
          const delaySec = nextRetry * 2; // 2s, 4s, 6s
          const nextRetryTime = Date.now() + delaySec * 1000;
          const cleanReason = err.message || 'Transient connection disruption';

          setJobs(prev => prev.map(j => j.id === nextJob.id ? { 
            ...j, 
            status: 'retrying', 
            retryCount: nextRetry,
            maxRetries: maxRetries,
            retryDelaySeconds: delaySec,
            nextRetryTime: nextRetryTime,
            retryReason: cleanReason,
            error: `Network interrupted. Retrying in ${delaySec}s (Attempt ${nextRetry}/${maxRetries})...` 
          } : j));

          addToast('error', `Connection interrupted for ${nextJob.file.name}. Retrying in ${delaySec}s (${nextRetry}/${maxRetries})...`);

          setTimeout(() => {
            setJobs(prev => prev.map(j => {
              if (j.id === nextJob.id && j.status === 'retrying') {
                return { ...j, status: 'waiting', error: undefined };
              }
              return j;
            }));
          }, delaySec * 1000);
        } else {
          setJobs(prev => prev.map(j => j.id === nextJob.id ? { 
            ...j, 
            status: 'error', 
            error: err.message,
            retryCount: currentRetry,
            maxRetries: maxRetries,
            retryReason: undefined
          } : j));
          addToast('error', `Failed: ${nextJob.file.name} - ${err.message}`);
        }
      } finally {
        currentAbortControllerRef.current = null;
        processingRef.current = false;
      }
    };

    processNextJob();
  }, [jobs]);

  const clearJobs = () => {
    if (currentAbortControllerRef.current) {
      currentAbortControllerRef.current.abort();
      currentAbortControllerRef.current = null;
    }
    processingRef.current = false;
    setJobs([]);
    try {
      localStorage.removeItem('raster_jobs');
    } catch {}
    addToast('success', 'Workspace cleared.');
  };

  const removeJob = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const target = jobs.find(j => j.id === id);
    if (target?.status === 'processing') {
      currentAbortControllerRef.current?.abort();
      currentAbortControllerRef.current = null;
      processingRef.current = false;
    }
    setJobs(prev => prev.filter(j => j.id !== id));
  };

  const retryJob = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const target = jobs.find(j => j.id === id);
    if (target?.status === 'processing') {
      currentAbortControllerRef.current?.abort();
      currentAbortControllerRef.current = null;
      processingRef.current = false;
    }
    setJobs(prev => prev.map(j => j.id === id ? {
      ...j,
      status: 'waiting',
      error: undefined,
      retryReason: undefined,
      progress: 0,
      startedAt: Date.now(),
      lastProgressAt: Date.now()
    } : j));
    addToast('success', 'Job re-queued for processing.');
  };

  const queueCount = jobs.filter(j => j.status === 'waiting' || j.status === 'processing' || j.status === 'retrying').length;
  const finishedJobs = jobs.filter(j => j.status === 'done' || j.status === 'processing'); // Wait, done jobs.

  const handleApproveUnitMix = async (jobId: string) => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/approve`, { method: 'POST' });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to approve');
      }
      const data = await res.json();
      setJobs(prev => prev.map(j => j.id === jobId ? { 
        ...j, 
        workflowState: data.workflowState, 
        finalTotal: data.finalTotal,
        mappedData: data.mappedData,
        qaResult: data.qaResult,
        status: data.qaResult?.safeToSend === false ? 'error' : 'done',
        error: data.qaResult?.safeToSend === false ? 'QA Failed: Safe to send is false' : undefined
      } : j));
      if (data.qaResult?.safeToSend === false) {
        addToast('error', 'QA Failed. Unsafe to send.');
      } else {
        addToast('success', 'Unit Mix Approved! Bid finalized.');
      }
    } catch (err: any) {
      addToast('error', err.message);
    }
  };

  const handleResolveItem = async (jobId: string, plan: string, code: string) => {
    const defaultSku = prompt(`Enter Sku to map for ${code}:`);
    if (!defaultSku) return;
    const defaultCost = prompt(`Enter Cost for ${defaultSku}:`);
    if (!defaultCost) return;

    try {
      const res = await fetch(`/api/jobs/${jobId}/resolve`, { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ plan, code, mappedSku: defaultSku, unitCost: defaultCost })
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to resolve');
      }
      const data = await res.json();
      setJobs(prev => prev.map(j => j.id === jobId ? { 
        ...j, 
        workflowState: data.workflowState, 
        finalTotal: data.finalTotal,
        mappedData: data.mappedData,
        qaResult: data.qaResult,
        status: data.qaResult?.safeToSend === false ? 'error' : 'done',
        error: data.qaResult?.safeToSend === false ? 'QA Failed: Safe to send is false' : undefined
      } : j));
      addToast('success', 'Line item resolved. Estimate updated.');
    } catch(err: any) {
       addToast('error', err.message);
    }
  };

  const handleExport = (format: 'csv' | 'json') => {
     // find last job
     const lastJob = jobs.slice().reverse().find(j => j.mappedData);
     if (!lastJob) {
        addToast('error', 'No bid data available to export.');
        return;
     }
     window.open(`/api/jobs/${lastJob.id}/export?format=${format}`, '_blank');
  };

  const allImages = jobs.flatMap(j => j.images.map((img, i) => ({ img, fileName: j.file.name, pageIndex: i })));

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans overflow-x-hidden">
      {/* Header Navigation */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-slate-800 bg-slate-900/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-cyan-500 rounded flex items-center justify-center">
            <UploadCloud className="w-5 h-5 text-slate-900" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">PLAN<span className="text-cyan-400">RASTER</span></h1>
        </div>
        <div className="hidden sm:flex items-center gap-6">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-slate-400">
            <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
            Server Cluster: Active
          </div>
          <div className="bg-slate-800 px-3 py-1 rounded-full text-xs font-mono">v2.4.0-stable</div>
        </div>
      </header>

      {/* Main Bento Grid */}
      <main className="flex-1 p-4 md:p-6 grid grid-cols-1 md:grid-cols-12 gap-6 max-w-7xl mx-auto w-full auto-rows-[minmax(100px,_auto)]">
        {/* Left Panel: Ingestion Hub */}
        <section className="col-span-1 md:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col overflow-hidden relative min-h-[400px]">
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#22d3ee 0.5px, transparent 0.5px)', backgroundSize: '20px 20px' }}></div>
          
          <div className="p-6 border-b border-slate-800 shrink-0">
            <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-2">
               <UploadCloud className="w-4 h-4" /> INGESTION HUB
            </h3>
            <p className="text-xs text-slate-500 mt-1">Upload Plan PDFs and Pricing Workbooks to begin the automated bidding pipeline.</p>
          </div>

          <div className="p-6 flex flex-col gap-6 flex-1 z-10 overflow-auto custom-scrollbar">
            {/* Workbook Upload */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 block">1. Pricing Workbook (CSV/XLSX)</label>
              <div className="flex items-center gap-4">
                 <input 
                   type="file" 
                   accept=".csv,.xlsx" 
                   onChange={(e) => {
                     const file = e.target.files?.[0];
                     if (file) setWorkbookFile(file);
                   }}
                   className="hidden"
                   id="workbook-upload"
                 />
                 <label htmlFor="workbook-upload" className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg transition-colors cursor-pointer text-sm border border-slate-700 flex items-center gap-2">
                   <FileType className="w-4 h-4 text-emerald-500" />
                   Choose File
                 </label>
                 <div className="flex-1 min-w-0">
                   {workbookFile ? (
                     <p className="text-sm text-emerald-400 truncate font-mono bg-emerald-950/30 px-3 py-1.5 rounded-md border border-emerald-900/50">
                       {workbookFile.name}
                     </p>
                   ) : (
                     <p className="text-xs text-slate-500 italic">No workbook attached. Pipeline may pause.</p>
                   )}
                 </div>
              </div>
            </div>

            {/* PDFs Upload */}
            <div className="flex-1 flex flex-col">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 block">2. Plan Blueprints (PDF / ZIP)</label>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex-1 flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl transition-colors cursor-pointer ${
                  isHovering ? 'border-cyan-500 bg-cyan-900/20' : 'border-slate-700 bg-slate-950 group-hover:border-cyan-500/50'
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".pdf,.zip"
                  multiple
                  onChange={handleFileChange}
                />
                <input
                  type="file"
                  id="folderInput"
                  className="hidden"
                  // @ts-ignore
                  webkitdirectory="true"
                  directory="true"
                  multiple
                  onChange={handleFileChange}
                />
                <UploadCloud className="w-12 h-12 text-slate-600 mb-3" />
                <h2 className="text-lg font-semibold mb-1 text-center text-slate-200">Drop PDF / ZIP Folders Here</h2>
                <p className="text-slate-500 text-xs text-center max-w-[250px] mb-4">
                  Multi-page PDFs or ZIP files containing blueprints.
                </p>
                <div className="flex gap-2">
                  <button type="button" className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg transition-colors border border-slate-700 text-sm" onClick={(e) => { e.stopPropagation(); document.getElementById('folderInput')?.click(); }}>
                    Select Folder
                  </button>
                  <button type="button" className="px-5 py-2 bg-cyan-900/40 border border-cyan-800 hover:bg-cyan-800 hover:text-white text-cyan-400 font-medium rounded-lg transition-all text-sm" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                    Browse Files
                  </button>
                </div>
              </motion.div>
            </div>
            {globalError && (
              <div className="px-4 py-3 bg-red-900/30 text-red-300 rounded-lg text-sm font-medium border border-red-900/50 text-center">
                {globalError}
              </div>
            )}
          </div>
        </section>

        {/* Right Panel: Workflow Control Center */}
        {(() => {
          const activeJob = jobs.find(j => j.status === 'processing') || jobs.find(j => j.status === 'retrying') || jobs.slice().reverse()[0];
          const estimatedTimeRemaining = getEstimatedTimeRemaining(activeJob, currentTime);

          return (
            <section className="col-span-1 md:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col overflow-hidden max-h-[720px]">
              <div className="p-6 border-b border-slate-800 shrink-0 bg-slate-950/50">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-100 uppercase tracking-widest flex items-center gap-2">
                    <Loader2 className={`w-4 h-4 ${processingRef.current ? 'animate-spin text-cyan-400' : activeJob?.status === 'retrying' ? 'animate-spin text-amber-400' : 'text-slate-500'}`} /> WORKFLOW CONTROL CENTER
                  </h3>
                  {activeJob?.status === 'processing' && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse">
                      ACTIVE
                    </span>
                  )}
                  {activeJob?.status === 'retrying' && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1.5 animate-pulse">
                      <RotateCw className="w-2.5 h-2.5 animate-spin" />
                      RETRYING ({activeJob.retryCount || 1}/{activeJob.maxRetries || 3})
                    </span>
                  )}
                </div>
              </div>
              
              <div className="flex-1 flex flex-col h-full overflow-y-auto custom-scrollbar">
                {/* Current Active Job Timeline */}
                <div className="p-6 border-b border-slate-800 bg-slate-900/50 shrink-0">
                   <div className="flex items-center justify-between mb-3">
                     <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active Pipeline Status</h4>
                     {activeJob && (
                       <span className="text-[10px] text-slate-400 font-mono truncate max-w-[150px]" title={activeJob.file.name}>
                         {activeJob.file.name}
                       </span>
                     )}
                   </div>

                   {/* Visual Indicator: Automatic Retry In Progress Banner */}
                   {activeJob?.status === 'retrying' && (
                     <div id="workflow-auto-retry-indicator" className="mb-4 p-3.5 bg-amber-950/40 border border-amber-500/50 rounded-xl flex flex-col gap-2.5 shadow-lg animate-pulse">
                       <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2 text-amber-300 font-semibold text-xs">
                           <RotateCw className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
                           <span>Automatic Background Retry in Progress</span>
                         </div>
                         <span className="text-[10px] font-mono bg-amber-900/80 border border-amber-600/60 text-amber-200 px-2 py-0.5 rounded-full font-bold">
                           Attempt {activeJob.retryCount || 1} of {activeJob.maxRetries || 3}
                         </span>
                       </div>
                       <p className="text-[11px] text-amber-200/90 leading-relaxed">
                         A transient network or server interruption occurred. The pipeline is automatically recovering and will resume in{' '}
                         <span className="font-mono font-bold text-amber-100">
                           {Math.max(1, Math.ceil(((activeJob.nextRetryTime || currentTime) - currentTime) / 1000))}s
                         </span>.
                       </p>
                       <div className="flex items-center justify-between pt-1 border-t border-amber-800/50 text-[10px]">
                         <span className="text-amber-400/80 truncate max-w-[200px]" title={activeJob.retryReason || activeJob.error}>
                           {activeJob.retryReason ? `Cause: ${activeJob.retryReason}` : 'Re-establishing stream...'}
                         </span>
                         <button
                           type="button"
                           onClick={(e) => retryJob(activeJob.id, e)}
                           className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded transition-colors text-[10px] font-medium flex items-center gap-1 shrink-0"
                         >
                           <RotateCw className="w-2.5 h-2.5" />
                           Retry Now
                         </button>
                       </div>
                     </div>
                   )}

                   {/* Active Job Stats Card: Pages Processed & Estimated Time Remaining */}
                   {activeJob && (
                     <div id="workflow-estimated-time-card" className="mb-4 p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl flex flex-col gap-2.5 shadow-inner">
                       <div className="flex items-center justify-between gap-2">
                         <div className="flex items-center gap-1.5 text-xs text-slate-300">
                           <Clock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                           <span className="font-semibold text-slate-200">Estimated Time Remaining:</span>
                         </div>
                         <span id="workflow-estimated-time-value" className={`font-mono text-xs font-bold ${activeJob.status === 'retrying' ? 'text-amber-400' : 'text-cyan-400'}`}>
                           {estimatedTimeRemaining}
                         </span>
                       </div>

                       <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1.5 border-t border-slate-800/80">
                         <span>Pages Processed:</span>
                         <span id="workflow-pages-processed-value" className="font-mono font-medium text-slate-200">
                           {activeJob.totalPages 
                             ? `${activeJob.currentPage ?? 0} / ${activeJob.totalPages} pages` 
                             : activeJob.status === 'done' && activeJob.images?.length 
                             ? `${activeJob.images.length} / ${activeJob.images.length} pages`
                             : activeJob.status === 'processing' 
                             ? 'Scanning pages...' 
                             : activeJob.status === 'retrying'
                             ? 'Retrying connection...'
                             : '--'}
                         </span>
                       </div>

                       {activeJob.status === 'processing' && (
                         <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-0.5">
                           <div 
                             className="bg-cyan-500 h-full transition-all duration-300 ease-out" 
                             style={{ width: `${activeJob.progress || 0}%` }}
                           />
                         </div>
                       )}
                     </div>
                   )}

                   <div className="space-y-4">
                     {[
                       { id: 'workbook_ingested', label: 'Workbook Ingested' },
                       { id: 'cabinet_pages_classified', label: 'Pages Classified' },
                       { id: 'cabinet_takeoff_draft', label: 'Takeoff Extracted' },
                       { id: 'cabinet_bid_safe_to_send', label: 'Bid Safe & Finalized' }
                     ].map((step, idx, arr) => {
                       // Compute active state index simple fallback:
                       const stateOrder = ['pending_workbook', 'workbook_ingested', 'cabinet_pages_classified', 'cabinet_takeoff_draft', 'unit_mix_required', 'pricing_mapping_required', 'cabinet_bid_review_required', 'cabinet_bid_safe_to_send'];
                       const currentIdx = activeJob && activeJob.workflowState ? stateOrder.indexOf(activeJob.workflowState) : -1;
                       const stepIdx = stateOrder.indexOf(step.id);
                       
                       const isCompleted = activeJob?.status === 'done' || (currentIdx >= stepIdx && activeJob?.status !== 'error');
                       const isActive = currentIdx === stepIdx && activeJob?.status === 'processing';
                       const isError = activeJob?.status === 'error' && currentIdx === stepIdx;
                       
                       return (
                         <div key={step.id} className="flex items-start gap-3 relative">
                           {idx < arr.length - 1 && (
                             <div className={`absolute left-2.5 top-6 bottom-[-16px] w-[2px] ${isCompleted ? 'bg-cyan-500/50' : 'bg-slate-800'}`}></div>
                           )}
                           <div className={`relative z-10 flex items-center justify-center w-5 h-5 rounded-full mt-0.5 shrink-0 transition-colors duration-300 ${isCompleted ? 'bg-cyan-500 text-slate-900' : isActive ? 'bg-cyan-500 shadow-[0_0_10px_rgba(34,211,238,0.5)] text-slate-900' : isError ? 'bg-red-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
                             {isCompleted ? <CheckCircle className="w-3 h-3" /> : isError ? <AlertCircle className="w-3 h-3" /> : <div className="w-1.5 h-1.5 rounded-full bg-current"></div>}
                           </div>
                           <div className="flex flex-col">
                             <span className={`text-sm font-medium ${isCompleted ? 'text-slate-200' : isActive ? 'text-cyan-400' : isError ? 'text-red-400' : 'text-slate-500'}`}>{step.label}</span>
                             {isActive && <span className="text-[10px] text-cyan-500 font-mono mt-1">Processing...</span>}
                           </div>
                         </div>
                       );
                     })}
                   </div>
                </div>

                {/* Data Visualization Block: Recharts Bar Chart of Completed Bids */}
                <CompletedJobsChart jobs={jobs} />

                {/* Mini Queue */}
                <div className="p-4 flex-1 overflow-y-auto custom-scrollbar bg-slate-950 min-h-[140px]">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Job Queue</h4>
                    <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400">{queueCount} IN QUEUE</span>
                  </div>
                  <div className="space-y-2">
                    {jobs.slice().reverse().map(job => (
                      <div key={job.id} className={`p-2.5 rounded-lg border flex flex-col gap-1.5 ${
                        job.status === 'processing' 
                          ? 'bg-cyan-950/20 border-cyan-800/60' 
                          : job.status === 'retrying'
                          ? 'bg-amber-950/25 border-amber-600/60 ring-1 ring-amber-500/20'
                          : job.status === 'done' 
                          ? 'bg-slate-900 border-emerald-900/40 opacity-70' 
                          : job.status === 'error' 
                          ? 'bg-red-950/30 border-red-900/50' 
                          : 'bg-slate-900 border-slate-800'
                      }`}>
                        <div className="flex justify-between text-[11px] items-center gap-2">
                          <span className={`truncate max-w-[120px] font-medium flex-1 ${
                            job.status === 'error' ? 'text-red-400' : job.status === 'retrying' ? 'text-amber-300 font-semibold' : 'text-slate-300'
                          }`} title={job.file.name}>
                            {job.file.name}
                          </span>
                          <div className="flex gap-2 items-center shrink-0">
                            <span className={`font-mono flex items-center gap-1 ${
                              job.status === 'processing' ? 'text-cyan-400' : job.status === 'retrying' ? 'text-amber-400' : job.status === 'done' ? 'text-emerald-500' : job.status === 'error' ? 'text-red-500' : 'text-slate-500'
                            }`}>
                              {job.status === 'processing' && `${job.progress || 0}%`}
                              {job.status === 'retrying' && (
                                <span className="flex items-center gap-1">
                                  <RotateCw className="w-2.5 h-2.5 animate-spin text-amber-400" />
                                  <span>Retry {job.retryCount || 1}/{job.maxRetries || 3}</span>
                                </span>
                              )}
                              {job.status === 'done' && 'Done'}
                              {job.status === 'error' && 'Failed'}
                              {job.status === 'waiting' && 'Wait'}
                            </span>
                            {job.status === 'error' && (
                              <button
                                onClick={(e) => retryJob(job.id, e)}
                                className="text-amber-400 hover:text-amber-300 transition-colors p-0.5 rounded-sm hover:bg-slate-800 flex items-center gap-0.5 text-[9px] font-mono"
                                title="Retry job"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                            )}
                            {job.status === 'retrying' && (
                              <button
                                onClick={(e) => retryJob(job.id, e)}
                                className="text-amber-300 hover:text-amber-200 transition-colors p-0.5 rounded-sm hover:bg-amber-900/40 text-[9px] font-mono"
                                title="Retry immediately"
                              >
                                <RotateCw className="w-3 h-3" />
                              </button>
                            )}
                            <button 
                              onClick={(e) => removeJob(job.id, e)}
                              className="text-slate-500 hover:text-red-400 transition-colors p-0.5 rounded-sm hover:bg-slate-800"
                              title={job.status === 'processing' ? 'Cancel and remove active job' : 'Remove job'}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        {job.status === 'processing' && (
                          <>
                            <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                              <div className="bg-cyan-500 h-full transition-all duration-300 ease-out" style={{ width: `${job.progress || 0}%` }}></div>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono mt-0.5">
                              <span>{job.currentPage !== undefined && job.totalPages ? `${job.currentPage}/${job.totalPages} pgs` : ''}</span>
                              <span className="text-cyan-400 flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5 shrink-0" />
                                {getEstimatedTimeRemaining(job, currentTime)}
                              </span>
                            </div>
                          </>
                        )}
                        {job.status === 'retrying' && (
                          <div className="flex items-center justify-between text-[10px] text-amber-300/90 font-mono mt-0.5 bg-amber-950/40 px-2 py-1 rounded border border-amber-700/30">
                            <span className="flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                              <span>In {Math.max(1, Math.ceil(((job.nextRetryTime || currentTime) - currentTime) / 1000))}s</span>
                            </span>
                            <button 
                              onClick={(e) => retryJob(job.id, e)}
                              className="underline text-amber-200 hover:text-white"
                            >
                              Retry now
                            </button>
                          </div>
                        )}
                        {job.finalTotal !== undefined && (
                          <span className={`text-[9px] font-mono tracking-wider ${job.workflowState === 'unit_mix_required' ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {job.workflowState === 'unit_mix_required' ? 'SAMPLE: ' : 'Total: '}
                            ${job.finalTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        )}
                        {job.error && (
                          <span className={`text-[9px] line-clamp-1 ${job.status === 'retrying' ? 'text-amber-400/90' : 'text-red-400'}`}>{job.error}</span>
                        )}
                      </div>
                    ))}
                    {jobs.length === 0 && (
                      <div className="py-6 flex flex-col items-center justify-center opacity-40">
                        <FileType className="w-5 h-5 text-slate-500 mb-2" />
                        <span className="text-[10px] uppercase tracking-widest text-slate-400">Empty</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          );
        })()}

        {/* Workspace Draft Viewer (Replaces Rendered Blueprints) */}
        <AnimatePresence>
          {jobs.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="col-span-1 md:col-span-12 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col overflow-hidden shadow-lg mt-2"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-950 p-5 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-cyan-900/40 text-cyan-400 rounded-lg flex items-center justify-center border border-cyan-800/50">
                    <CheckCircle className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-slate-100">Workspace Draft Viewer</h3>
                    <p className="text-xs text-slate-500">Agent outputs, data tabs, and extracted visuals ({allImages.length} pages)</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="group relative">
                    <button className="px-4 py-2 bg-cyan-900/30 text-cyan-300 border border-cyan-800/50 rounded-lg text-sm font-medium hover:bg-cyan-900/50 transition-colors focus:outline-none">
                      Export Output ▾
                    </button>
                    <div className="absolute right-0 mt-2 w-32 bg-slate-900 border border-slate-800 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                       <div className="p-1 flex flex-col">
                         <button onClick={() => handleExport('csv')} className="px-3 py-2 text-sm text-left text-slate-300 hover:bg-slate-800 hover:text-cyan-400 rounded-md transition-colors">CSV Format</button>
                         <button onClick={() => handleExport('json')} className="px-3 py-2 text-sm text-left text-slate-300 hover:bg-slate-800 hover:text-cyan-400 rounded-md transition-colors">JSON Format</button>
                       </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearJobs}
                    className="px-4 py-2 bg-slate-800 text-slate-200 rounded-lg text-sm font-medium hover:bg-red-950 hover:text-red-300 hover:border-red-900 transition-colors focus:outline-none border border-slate-700"
                  >
                    Clear Workspace
                  </button>
                </div>
              </div>

              {/* Data Tabs row */}
              <div className="flex items-center gap-4 px-6 pt-4 border-b border-slate-800 overflow-x-auto custom-scrollbar">
                 <button onClick={() => setActiveTab('blueprints')} className={`pb-3 text-sm font-medium whitespace-nowrap ${activeTab === 'blueprints' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-slate-500 hover:text-slate-300 transition-colors'}`}>Extracted Blueprints</button>
                 <button onClick={() => setActiveTab('takeoff')} className={`pb-3 text-sm font-medium whitespace-nowrap ${activeTab === 'takeoff' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-slate-500 hover:text-slate-300 transition-colors'}`}>Unit Mix & Takeoff</button>
                 <button onClick={() => setActiveTab('pricing')} className={`pb-3 text-sm font-medium whitespace-nowrap ${activeTab === 'pricing' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-slate-500 hover:text-slate-300 transition-colors'}`}>Pricing Mapping</button>
                 <button onClick={() => setActiveTab('qa')} className={`pb-3 text-sm font-medium whitespace-nowrap ${activeTab === 'qa' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-slate-500 hover:text-slate-300 transition-colors'}`}>Bid Review</button>
              </div>

              {/* Tab Content */}
              <div className="bg-slate-950 min-h-[300px]">
                {activeTab === 'blueprints' && (
                  <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {allImages.map((imgObj, idx) => (
                      <div key={`${imgObj.fileName}-${idx}`} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm flex flex-col hover:border-cyan-800/50 transition-colors group">
                        <div className="bg-slate-950 border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-2">
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-medium text-slate-300 truncate" title={imgObj.fileName}>{imgObj.fileName}</span>
                            <span className="text-[10px] font-medium text-slate-500 font-mono mt-0.5">PAGE {imgObj.pageIndex + 1}</span>
                          </div>
                          <a
                            href={imgObj.img}
                            download={`${imgObj.fileName.replace('.pdf', '')}_page_${imgObj.pageIndex + 1}.jpg`}
                            className="text-[10px] font-medium text-cyan-400 bg-cyan-900/20 px-3 py-1.5 rounded-md border border-cyan-800 hover:bg-cyan-900/40 transition-colors flex-shrink-0"
                          >
                            DL
                          </a>
                        </div>
                        <div 
                          className="p-4 flex items-center justify-center overflow-hidden bg-slate-800/20 cursor-zoom-in"
                          onClick={() => { setSelectedImage(imgObj); setZoomLevel(1); }}
                        >
                          <img
                            src={imgObj.img}
                            alt={`Extracted page ${imgObj.pageIndex + 1}`}
                            className="max-h-[200px] object-contain border border-slate-700/50 rounded bg-white/5 w-full shadow-sm group-hover:scale-[1.02] transition-transform duration-300"
                            loading="lazy"
                          />
                        </div>
                      </div>
                    ))}
                    {allImages.length === 0 && (
                       <div className="col-span-full py-12 flex flex-col items-center justify-center text-slate-500 gap-3 border border-dashed border-slate-800 rounded-xl">
                          <FileType className="w-8 h-8 text-slate-600" />
                          <p className="text-sm">No preview content generated yet.</p>
                       </div>
                    )}
                  </div>
                )}
                
                {activeTab === 'takeoff' && (
                  <div className="p-6">
                    {jobs.map(job => {
                      if (!job.unitMix && !job.takeoffData) return null;
                      
                      const needsApproval = job.workflowState === 'unit_mix_required';
                      
                      return (
                        <div key={job.id} className="mb-8 border border-slate-800 rounded-xl overflow-hidden bg-slate-900">
                           <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
                             <div className="flex flex-col">
                               <h4 className="text-sm font-semibold text-slate-200">Takeoff Data - {job.file.name}</h4>
                               {needsApproval ? (
                                 <p className="text-xs text-amber-500 flex items-center gap-1 mt-1"><AlertCircle className="w-3 h-3"/> Verification Required</p>
                               ) : (
                                 <p className="text-xs text-emerald-400 flex items-center gap-1 mt-1"><CheckCircle className="w-3 h-3"/> Verified</p>
                               )}
                             </div>
                             {needsApproval && (
                               <button 
                                 onClick={() => handleApproveUnitMix(job.id)}
                                 className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded shadow transition-colors"
                               >
                                 Approve Unit Mix
                               </button>
                             )}
                           </div>
                           
                           {job.finalTotal !== undefined && (
                             <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center gap-4">
                                <div className="text-xs font-bold text-red-400 uppercase tracking-widest px-3 py-1 bg-red-500/10 border border-red-500/20 rounded">
                                  SAMPLE EXTRACTION TOTAL - NOT PROJECT BID
                                </div>
                                <div className="text-lg font-mono text-white ml-auto">
                                  ${job.finalTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </div>
                             </div>
                           )}

                           <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                             {/* Unit Mix Block */}
                             <div>
                               <h5 className="text-xs font-bold text-cyan-400 uppercase tracking-widest mb-4">Unit Mix Draft</h5>
                               {job.unitMix && job.unitMix.length > 0 ? (
                                 <div className="space-y-2">
                                   {job.unitMix.map((um, i) => (
                                     <div key={i} className="flex justify-between items-center p-3 bg-slate-800/50 border border-slate-700 rounded-lg">
                                       <span className="text-sm font-medium text-slate-300">{um.plan}</span>
                                       <span className="text-sm font-mono text-cyan-300">{um.count} units</span>
                                     </div>
                                   ))}
                                 </div>
                               ) : (
                                 <p className="text-sm text-slate-500 italic">No unit mix data available.</p>
                               )}
                             </div>
                             
                             {/* Takeoff List Block */}
                             <div>
                               <h5 className="text-xs font-bold text-cyan-400 uppercase tracking-widest mb-4">Draft Takeoff (Per Unit)</h5>
                               {job.takeoffData && job.takeoffData.length > 0 ? (
                                 <div className="space-y-4">
                                   {job.takeoffData.map((to, i) => (
                                     <div key={i} className="border border-slate-700 rounded-lg overflow-hidden">
                                       <div className="bg-slate-800 px-3 py-2 text-xs font-bold text-slate-300 uppercase tracking-widest">{to.plan} Cabinets</div>
                                       <div className="divide-y divide-slate-800 bg-slate-800/30">
                                         {to.cabinets.map((cab, j) => (
                                           <div key={j} className="flex justify-between items-center px-3 py-2 text-sm">
                                             <span className="text-slate-400">{cab.code}</span>
                                             <span className="font-mono text-slate-300">x{cab.qty}</span>
                                           </div>
                                         ))}
                                       </div>
                                     </div>
                                   ))}
                                 </div>
                               ) : (
                                 <p className="text-sm text-slate-500 italic">No takeoff data available.</p>
                               )}
                             </div>
                           </div>
                        </div>
                      );
                    })}
                    {jobs.filter(j => j.unitMix || j.takeoffData).length === 0 && (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-3">
                         <FileType className="w-8 h-8 text-slate-600" />
                         <p className="text-sm">No takeoff data generated yet.</p>
                      </div>
                    )}
                  </div>
                )}
                
                {activeTab === 'pricing' && (
                  <div className="p-6">
                    {jobs.filter(j => j.mappedData).map(job => (
                      <div key={job.id} className="mb-8 border border-slate-800 rounded-xl overflow-hidden bg-slate-900">
                        <div className="p-4 bg-slate-950 border-b border-slate-800">
                           <h4 className="text-sm font-semibold text-slate-200">SKU Mapping - {job.file.name}</h4>
                        </div>
                        <div className="p-6">
                          {job.mappedData && job.mappedData.map((group, i) => (
                             <div key={i} className="mb-6 last:mb-0">
                               <div className="bg-slate-800 px-3 py-2 text-xs font-bold text-slate-300 uppercase tracking-widest rounded-t-lg">{group.plan} Cabinets</div>
                               <div className="border border-slate-800 border-top-0 rounded-b-lg overflow-x-auto">
                                 <table className="w-full text-sm text-left">
                                   <thead className="text-xs text-slate-500 bg-slate-950 uppercase border-b border-slate-800">
                                     <tr>
                                       <th className="px-4 py-3">Takeoff Code</th>
                                       <th className="px-4 py-3">Qty/Unit</th>
                                       <th className="px-4 py-3 text-center">Status</th>
                                       <th className="px-4 py-3">Mapped SKU</th>
                                       <th className="px-4 py-3 text-right">Unit Cost</th>
                                       <th className="px-4 py-3 text-right">Action</th>
                                     </tr>
                                   </thead>
                                   <tbody className="divide-y divide-slate-800 bg-slate-900/50">
                                      {group.cabinets.map((cab, j) => (
                                        <tr key={j} className="hover:bg-slate-800/50 transition-colors">
                                          <td className="px-4 py-3 font-medium text-slate-300">{cab.code}</td>
                                          <td className="px-4 py-3 font-mono text-slate-400">{cab.qty}</td>
                                          <td className="px-4 py-3 text-center">
                                            {cab.status === 'mapped' ? (
                                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">MAPPED</span>
                                            ) : (
                                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">UNRESOLVED</span>
                                            )}
                                          </td>
                                          <td className="px-4 py-3 font-mono text-cyan-400">{cab.mappedSku || '-'}</td>
                                          <td className="px-4 py-3 text-right font-mono text-slate-300">{cab.unitCost ? `$${cab.unitCost.toFixed(2)}` : '-'}</td>
                                          <td className="px-4 py-3 text-right">
                                             {cab.status === 'unresolved' ? (
                                                <button onClick={() => handleResolveItem(job.id, group.plan, cab.code)} className="text-[10px] px-2 py-1 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded hover:bg-amber-500/30 transition-colors">Resolve</button>
                                             ) : (
                                                <button onClick={() => handleResolveItem(job.id, group.plan, cab.code)} className="text-[10px] px-2 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded hover:text-slate-300 transition-colors">Edit</button>
                                             )}
                                          </td>
                                        </tr>
                                      ))}
                                   </tbody>
                                 </table>
                               </div>
                             </div>
                          ))}
                        </div>
                      </div>
                    ))}
                    {jobs.filter(j => j.mappedData).length === 0 && (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-3">
                         <FileType className="w-8 h-8 text-slate-600" />
                         <p className="text-sm">No pricing mapping generated yet.</p>
                      </div>
                    )}
                  </div>
                )}
                
                {activeTab === 'qa' && (
                  <div className="p-6">
                    {jobs.filter(j => j.qaResult).map(job => (
                      <div key={job.id} className="mb-8 border border-slate-800 rounded-xl overflow-hidden bg-slate-900">
                        <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
                           <h4 className="text-sm font-semibold text-slate-200">QA Review - {job.file.name}</h4>
                           {job.qaResult?.safeToSend ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 tracking-wider">
                                <CheckCircle className="w-3.5 h-3.5" /> SAFE TO SEND
                              </span>
                           ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-red-600 border border-red-500 text-white shadow-[0_0_15px_rgba(220,38,38,0.5)] tracking-wider">
                                <AlertCircle className="w-3.5 h-3.5" /> UNSAFE TO SEND
                              </span>
                           )}
                        </div>
                        <div className="p-6">
                           {!job.qaResult?.safeToSend && job.qaResult?.criticalIssues && job.qaResult.criticalIssues.length > 0 && (
                             <div className="mb-6 p-4 bg-red-500/5 text-red-400 border border-red-500/20 rounded-lg">
                               <h5 className="font-semibold text-sm mb-2 flex items-center gap-2"><AlertCircle className="w-4 h-4"/> Critical Issues Detected:</h5>
                               <ul className="list-disc pl-5 space-y-1 text-sm">
                                 {job.qaResult.criticalIssues.map((issue, idx) => (
                                   <li key={idx}>{issue}</li>
                                 ))}
                               </ul>
                             </div>
                           )}
                           
                           {job.finalTotal !== undefined && (
                             <div className="flex flex-col items-end">
                               <div className="text-sm font-medium text-slate-400 mb-1">Final Calculated Estimate:</div>
                               <div className="text-3xl font-mono tracking-tight text-white mb-6">${job.finalTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                               
                               <div className="flex gap-3">
                                 <button onClick={() => handleExport('json')} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-sm text-sm font-medium transition-colors">
                                   <Download className="w-4 h-4" /> Export JSON Package
                                 </button>
                                 <button onClick={() => handleExport('csv')} className="flex items-center gap-2 px-4 py-2 bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg shadow-sm text-sm font-medium transition-colors">
                                   <Download className="w-4 h-4" /> Export CSV Table
                                 </button>
                               </div>
                             </div>
                           )}
                        </div>
                      </div>
                    ))}
                    {jobs.filter(j => j.qaResult).length === 0 && (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-3">
                         <FileType className="w-8 h-8 text-slate-600" />
                         <p className="text-sm">No QA review generated yet.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Info Bar */}
      <footer className="px-8 py-3 bg-slate-950 border-t border-slate-900 flex flex-col sm:flex-row justify-between text-[10px] sm:text-[11px] text-slate-500 font-mono gap-2 sm:gap-0 mt-auto flex-shrink-0 z-10">
        <div>OUTPUT PATH: /var/lib/raster_engine/vision_training_set_04/</div>
        <div className="flex gap-2 sm:gap-4 flex-wrap">
          <span>POPLER_GFX_V10</span>
          <span className="text-slate-800 hidden sm:inline">|</span>
          <span>TIFF/PNG-64_READY</span>
          <span className="text-slate-800 hidden sm:inline">|</span>
          <span className="text-cyan-600">SECURE SOCKETS ENFORCED</span>
        </div>
      </footer>

      {/* Full-Screen Render Modal */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-sm flex flex-col"
          >
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-slate-900 border-b border-slate-800 shrink-0 gap-4">
              <div className="flex flex-col">
                <span className="text-sm font-medium text-slate-200">{selectedImage.fileName}</span>
                <span className="text-xs text-slate-500">PAGE {selectedImage.pageIndex + 1}</span>
              </div>
              <div className="flex items-center gap-4 self-end sm:self-auto">
                 <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-1 border border-slate-700">
                   <button onClick={() => setZoomLevel(z => Math.max(0.25, z - 0.25))} className="p-1 hover:bg-slate-700 rounded text-slate-300 transition-colors" title="Zoom Out">
                     <ZoomOut className="w-4 h-4" />
                   </button>
                   <span className="text-xs text-slate-300 font-mono w-10 text-center pointer-events-none">
                     {Math.round(zoomLevel * 100)}%
                   </span>
                   <button onClick={() => setZoomLevel(z => Math.min(5, z + 0.25))} className="p-1 hover:bg-slate-700 rounded text-slate-300 transition-colors" title="Zoom In">
                     <ZoomIn className="w-4 h-4" />
                   </button>
                 </div>
                 <button 
                   onClick={() => { setSelectedImage(null); setZoomLevel(1); }} 
                   className="p-2 bg-slate-800 hover:bg-red-950 hover:text-red-400 border border-slate-700 hover:border-red-900 rounded-lg text-slate-400 transition-colors"
                   title="Close viewer"
                 >
                   <X className="w-5 h-5" />
                 </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-auto custom-scrollbar flex items-center justify-center p-4">
              <img
                src={selectedImage.img}
                alt="Full screen extracted page"
                className="bg-white border border-slate-800 shadow-2xl transition-all duration-200"
                style={{
                  width: zoomLevel > 1 ? `${zoomLevel * 100}%` : 'auto',
                  height: zoomLevel > 1 ? 'auto' : `${zoomLevel * 100}%`,
                  maxWidth: 'max-content',
                  objectFit: 'contain'
                }}
                draggable={false}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notification Container */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, x: 20 }}
              className={`p-4 rounded-xl shadow-lg border flex items-center gap-3 backdrop-blur-md min-w-[300px] pointer-events-auto ${
                toast.type === 'success' 
                  ? 'bg-emerald-950/80 border-emerald-900/50 text-emerald-100'
                  : 'bg-red-950/80 border-red-900/50 text-red-100'
              }`}
            >
              {toast.type === 'success' ? (
                <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
              )}
              <p className="text-sm font-medium">{toast.message}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Repo Chatbot Widget */}
      <ChatWidget />
    </div>
  );
}

